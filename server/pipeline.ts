import axios from "axios";
import fs from "fs/promises";
import path from "path";

// ============================================================================
// Long-note pipeline (condensed, per-step)
//
// The note is split deterministically into chunks (no model call), facts are
// extracted per chunk, then a single synthesize call merges the facts and
// writes the final note, followed by an audit with one repair pass if needed.
//
// Each step runs in its OWN short HTTP request (see /api/ollama/pipeline-step
// in routes.ts) because the deployment edge proxy hard-caps a single request
// at ~5 minutes regardless of heartbeats. The client orchestrates the steps
// and carries the intermediate state, so no run state is kept on the server.
//
// PRIVACY: never log clinical text. Only run IDs, step names, statuses, model
// names, durations, character counts, and error classes may be logged.
// ============================================================================

// ---- Configuration (env-driven, with defaults) ----------------------------

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const LONG_NOTE_CHARACTER_THRESHOLD = numericEnv(
  "LONG_NOTE_CHARACTER_THRESHOLD",
  12000
);
const PIPELINE_TEMP_DIR =
  process.env.PIPELINE_TEMP_DIR || "/tmp/note-pipeline-runs";
const CONTEXT_LENGTH = numericEnv("PIPELINE_CONTEXT_LENGTH", 65536);
const FALLBACK_CONTEXT_LENGTH = numericEnv(
  "PIPELINE_FALLBACK_CONTEXT_LENGTH",
  32768
);
// Hard cap so a step's generation always terminates (mirrors the OCR guard).
const NUM_PREDICT_CAP = 16384;
// Overall wall-clock cap for one pipeline run, enforced by the client across
// its per-step requests. Override with PIPELINE_MAX_RUN_MINUTES.
export const MAX_RUN_MINUTES = numericEnv("PIPELINE_MAX_RUN_MINUTES", 45);
const MODEL_REFRESH_MS = 5 * 60 * 1000; // refresh model list every 5 minutes
const STALE_RUN_MAX_AGE_MS = 2 * 60 * 60 * 1000; // purge run folders older than 2h

// ---- Model discovery & auto-selection --------------------------------------

export type AvailableModel = {
  name: string;
  parameterSize?: string;
  parameterCountB?: number;
  family?: string;
  quantization?: string;
  sizeBytes?: number;
};

export type ModelSelection = {
  smallModel: string;
  largeModel: string;
  smallSource: "env" | "auto";
  largeSource: "env" | "auto";
};

let modelCache: { baseUrl: string; models: AvailableModel[]; fetchedAt: number } | null =
  null;

function parseParamCountB(model: {
  name: string;
  details?: { parameter_size?: string };
}): number | undefined {
  const ps = model.details?.parameter_size;
  if (ps) {
    const m = ps.trim().match(/^([\d.]+)\s*([MB])$/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (!Number.isNaN(n)) return m[2].toUpperCase() === "M" ? n / 1000 : n;
    }
  }
  // Fall back to name patterns like "4b", "12b", "27b" (also "e4b" style).
  const nm = model.name.toLowerCase().match(/(?:^|[^a-z\d])e?(\d+(?:\.\d+)?)b(?![a-z\d])/);
  if (nm) {
    const n = parseFloat(nm[1]);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function isExcludedModel(m: AvailableModel): boolean {
  const n = m.name.toLowerCase();
  // Embedding / reranker models can't generate text.
  if (/(embed|embedding|bge|rerank)/.test(n)) return true;
  // OCR-specific vision models are not general text generators.
  if (/ocr/.test(n)) return true;
  return false;
}

export async function discoverModels(
  baseUrl: string,
  forceRefresh = false
): Promise<AvailableModel[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    modelCache &&
    modelCache.baseUrl === baseUrl &&
    now - modelCache.fetchedAt < MODEL_REFRESH_MS
  ) {
    return modelCache.models;
  }
  const res = await axios.get(`${baseUrl}/api/tags`, { timeout: 30000 });
  const raw: any[] = res.data?.models || [];
  const models: AvailableModel[] = raw.map((m) => ({
    name: m.name,
    parameterSize: m.details?.parameter_size,
    parameterCountB: parseParamCountB(m),
    family: m.details?.family,
    quantization: m.details?.quantization_level,
    sizeBytes: m.size,
  }));
  modelCache = { baseUrl, models, fetchedAt: now };
  return models;
}

export async function selectModels(baseUrl: string): Promise<ModelSelection> {
  const envSmall = (process.env.OLLAMA_SMALL_MODEL || "").trim();
  const envLarge = (process.env.OLLAMA_LARGE_MODEL || "").trim();

  let candidates: AvailableModel[] = [];
  if (!envSmall || !envLarge) {
    const all = await discoverModels(baseUrl);
    candidates = all.filter((m) => !isExcludedModel(m));
    if (candidates.length === 0) candidates = all; // last resort
  }

  const bySmallest = (a: AvailableModel, b: AvailableModel) => {
    const ap = a.parameterCountB ?? Infinity;
    const bp = b.parameterCountB ?? Infinity;
    if (ap !== bp) return ap - bp;
    return (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity);
  };

  const pickSmall = (): string => {
    if (candidates.length === 0) throw new PipelineError("no_models", "No text-generation models are available on the Ollama server.");
    const known = candidates.filter((m) => m.parameterCountB !== undefined);
    const inRange = known.filter(
      (m) => m.parameterCountB! >= 2 && m.parameterCountB! <= 8
    );
    if (inRange.length > 0) return inRange.sort(bySmallest)[0].name;
    if (known.length > 0) return known.sort(bySmallest)[0].name;
    return [...candidates].sort(
      (a, b) => (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity)
    )[0].name;
  };

  const pickLarge = (): string => {
    if (candidates.length === 0) throw new PipelineError("no_models", "No text-generation models are available on the Ollama server.");
    const known = candidates.filter((m) => m.parameterCountB !== undefined);
    const inRange = known.filter(
      (m) => m.parameterCountB! >= 10 && m.parameterCountB! <= 16
    );
    if (inRange.length > 0)
      return inRange.sort((a, b) => bySmallest(b, a))[0].name;
    const upTo32 = known.filter((m) => m.parameterCountB! <= 32);
    if (upTo32.length > 0)
      return upTo32.sort((a, b) => bySmallest(b, a))[0].name;
    return [...candidates].sort(
      (a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)
    )[0].name;
  };

  return {
    smallModel: envSmall || pickSmall(),
    largeModel: envLarge || pickLarge(),
    smallSource: envSmall ? "env" : "auto",
    largeSource: envLarge ? "env" : "auto",
  };
}

// ---- Errors ----------------------------------------------------------------

export class PipelineError extends Error {
  errorClass: string;
  constructor(errorClass: string, message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

// ---- Metadata-only logging --------------------------------------------------

function logStep(
  runId: string,
  step: string,
  status: string,
  extra: Record<string, string | number | undefined> = {}
) {
  const parts = Object.entries(extra)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  console.log(
    `[pipeline ${runId}] step=${step} status=${status}${parts.length ? " " + parts.join(" ") : ""}`
  );
}

// ---- Ollama call helper -----------------------------------------------------

// Streams the generation from Ollama (stream: true). This is required because
// the Ollama server sits behind a proxy that kills silent connections after
// ~100s (HTTP 524) — a non-streaming call on a long generation goes silent for
// the whole generation time and gets killed. Streaming keeps bytes flowing the
// entire time. The optional onToken callback receives each text chunk as it
// arrives so callers can forward live output to the user.
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

async function ollamaGenerate(
  baseUrl: string,
  model: string,
  prompt: string,
  opts: { temperature: number; top_p: number; num_ctx: number; num_predict?: number },
  signal?: AbortSignal,
  onToken?: (text: string, kind: "response" | "thinking") => void
): Promise<string> {
  if (signal?.aborted) throw new PipelineError("cancelled", "Run cancelled.");
  // IMPORTANT: do NOT pass `signal` to axios here. With responseType "stream",
  // giving axios an AbortSignal makes it delay the response headers and stall
  // the stream entirely (observed: 2s -> 29s headers, then no data at all).
  // Instead we honor the signal manually by destroying the stream on abort.
  const res = await axios.post(
    `${baseUrl}/api/generate`,
    {
      model,
      prompt,
      stream: true,
      // Disable the model's "thinking" phase. Thinking-capable models (e.g.
      // gemma4:12B) fed our task prompts (which say things like "silently merge
      // and deduplicate ... before writing") enter a hidden reasoning phase that
      // emits ZERO bytes for 125s+ before the first token — that silent window
      // trips the proxy's ~100-125s 524 cut and was the real cause of the
      // synthesize stalls/524s. With think:false the same prompt first-tokens in
      // ~2-3s and completes in seconds. The pipeline never needs streamed
      // reasoning; every step wants the final answer only.
      think: false,
      // Keep the model in memory well past a single run, so the next pipeline
      // run (or a retry) doesn't pay the model-load time again. That load time
      // is part of the silent window that can trip the proxy's ~100s 524 cut.
      keep_alive: "30m",
      options: {
        temperature: opts.temperature,
        top_p: opts.top_p,
        num_ctx: opts.num_ctx,
        num_predict: opts.num_predict ?? NUM_PREDICT_CAP,
      },
    },
    {
      timeout: 900000,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: "stream",
    }
  );
  console.log(`[pipeline] ollama stream_open model=${model} status=${res.status}`);
  if (signal?.aborted) {
    try {
      res.data.destroy();
    } catch {
      // ignore
    }
    throw new PipelineError("cancelled", "Run cancelled.");
  }

  if (res.status >= 400) {
    // Read a small slice of the error body for detail, then classify.
    // IMPORTANT: cap this read with a timeout — the proxy in front of Ollama
    // can return an error status (e.g. 524) but keep the connection open
    // without ever ending the body, which previously hung this await forever
    // and froze the whole step (no retry, endless spinner for the user).
    let detail = `HTTP ${res.status}`;
    try {
      const bodyText: string = await new Promise((resolve) => {
        let acc = "";
        const timer = setTimeout(() => {
          try {
            res.data.destroy();
          } catch {
            // ignore
          }
          resolve(acc);
        }, 5000);
        const done = () => {
          clearTimeout(timer);
          resolve(acc);
        };
        res.data.on("data", (c: Buffer) => {
          if (acc.length < 4096) acc += c.toString();
        });
        res.data.on("end", done);
        res.data.on("error", done);
        res.data.on("close", done);
      });
      const parsed = JSON.parse(bodyText);
      if (typeof parsed?.error === "string") detail = parsed.error;
    } catch {
      // keep the default detail
    } finally {
      try {
        res.data.destroy();
      } catch {
        // ignore
      }
    }
    if (TRANSIENT_HTTP_STATUSES.has(res.status)) {
      throw new PipelineError(
        "ollama_unavailable",
        `The Ollama server is temporarily unavailable (${detail}). It may be restarting or overloaded.`
      );
    }
    throw new PipelineError("ollama_error", `Ollama call failed: ${detail}`);
  }

  // Parse Ollama's NDJSON stream, accumulating the response text.
  return await new Promise<string>((resolve, reject) => {
    const stream = res.data;
    let out = "";
    let buf = "";
    let settled = false;
    const onAbort = () => {
      finish(() => {
        try {
          stream.destroy();
        } catch {
          // ignore
        }
        reject(new PipelineError("cancelled", "Run cancelled."));
      });
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    signal?.addEventListener("abort", onAbort);
    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (typeof obj?.error === "string" && obj.error) {
        finish(() => {
          stream.destroy();
          reject(new PipelineError("ollama_error", `Ollama call failed: ${obj.error}`));
        });
        return;
      }
      if (typeof obj?.response === "string" && obj.response) {
        out += obj.response;
        try {
          onToken?.(obj.response, "response");
        } catch {
          // never let a bad token sink kill the model call
        }
      }
      // Thinking models (e.g. gemma4:12B) emit their reasoning as separate
      // "thinking" chunks before any response text. Forward those too so the
      // user sees live activity during the (possibly long) thinking phase.
      if (typeof obj?.thinking === "string" && obj.thinking) {
        try {
          onToken?.(obj.thinking, "thinking");
        } catch {
          // ignore
        }
      }
    };
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) handleLine(line);
    });
    stream.on("end", () => {
      if (buf.trim()) handleLine(buf);
      finish(() => resolve(out));
    });
    stream.on("error", (err: Error) => {
      finish(() => reject(err));
    });
  });
}

// Network-level failures that usually mean the Ollama server (or the proxy in
// front of it) is briefly down — worth waiting and retrying.
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
]);

function isTransientOllamaError(err: any): boolean {
  if (err instanceof PipelineError) return err.errorClass === "ollama_unavailable";
  return typeof err?.code === "string" && TRANSIENT_NETWORK_CODES.has(err.code);
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new PipelineError("cancelled", "Run cancelled."));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new PipelineError("cancelled", "Run cancelled."));
        return;
      }
      signal.addEventListener("abort", onAbort);
    }
  });
}

// One model call with two retry ladders:
// - Model/context errors: retry once at the fallback num_ctx (immediate).
// - Transient server outages (HTTP 502/503/504, connection drops): wait and
//   retry the same call up to 3 times (3s → 10s → 20s), bounded by a total
//   time budget so the whole request stays well under the deployed edge
//   proxy's ~300s per-request kill.
const TRANSIENT_RETRY_DELAYS_MS = [3000, 10000, 20000];
const RETRY_TOTAL_BUDGET_MS = 210000;

// Right-size num_ctx to what the call actually needs instead of always
// reserving the full 65536-token window. A smaller KV cache is much faster to
// set up and keeps the model fully on the GPU. Tiers avoid a model reload on
// every call (Ollama reloads when num_ctx changes).
const CTX_TIERS = [16384, 32768, 65536];

function pickContextLength(promptChars: number, maxCtx: number): number {
  // ~3.5 chars/token is conservative for clinical text + JSON escaping.
  const promptTokens = Math.ceil(promptChars / 3.5);
  // Headroom for the generated output (extractions can run a few thousand tokens).
  const needed = Math.ceil(promptTokens * 1.2) + 8192;
  for (const tier of CTX_TIERS) {
    if (tier >= maxCtx) break;
    if (needed <= tier) return tier;
  }
  return maxCtx;
}

async function callWithRetry(
  runId: string,
  step: string,
  baseUrl: string,
  model: string,
  prompt: string,
  temperature: number,
  primaryCtx: number,
  signal?: AbortSignal,
  onToken?: (text: string, kind: "response" | "thinking") => void,
  onAttemptStart?: () => void
): Promise<string> {
  const overallStart = Date.now();
  const sizedCtx = Math.min(primaryCtx, pickContextLength(prompt.length, primaryCtx));
  let ctx = sizedCtx;
  let ctxDropped = sizedCtx <= FALLBACK_CONTEXT_LENGTH;
  let transientRetries = 0;
  let lastErr: unknown;
  while (true) {
    if (signal?.aborted) throw new PipelineError("cancelled", "Run cancelled.");
    const started = Date.now();
    try {
      // Tell the caller a fresh attempt is starting so any live-forwarded
      // partial output from a failed attempt can be reset.
      try {
        onAttemptStart?.();
      } catch {
        // never let a bad callback kill the model call
      }
      const out = await ollamaGenerate(
        baseUrl,
        model,
        prompt,
        { temperature, top_p: 0.9, num_ctx: ctx },
        signal,
        onToken
      );
      logStep(runId, step, "call_ok", {
        model,
        num_ctx: ctx,
        duration_ms: Date.now() - started,
        prompt_chars: prompt.length,
        out_chars: out.length,
      });
      return out;
    } catch (err: any) {
      lastErr = err;
      if (signal?.aborted || axios.isCancel(err)) {
        throw new PipelineError("cancelled", "Run cancelled.");
      }
      logStep(runId, step, "call_failed", {
        model,
        num_ctx: ctx,
        duration_ms: Date.now() - started,
        error_class: err instanceof PipelineError ? err.errorClass : err?.code || err?.name || "unknown",
      });
      const withinBudget = Date.now() - overallStart < RETRY_TOTAL_BUDGET_MS;
      if (
        isTransientOllamaError(err) &&
        transientRetries < TRANSIENT_RETRY_DELAYS_MS.length &&
        withinBudget
      ) {
        const delayMs = TRANSIENT_RETRY_DELAYS_MS[transientRetries++];
        logStep(runId, step, "retry_wait", {
          delay_ms: delayMs,
          reason: "server_unavailable",
        });
        await sleepAbortable(delayMs, signal);
        continue;
      }
      if (!isTransientOllamaError(err) && !ctxDropped && withinBudget) {
        ctxDropped = true;
        ctx = FALLBACK_CONTEXT_LENGTH;
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new PipelineError("ollama_error", "Model call failed after retry.");
}

// ---- JSON handling ----------------------------------------------------------

function extractJson(text: string): any {
  let t = text.trim();
  // Strip <think>...</think> blocks and markdown fences.
  t = t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.search(/[{[]/);
  if (start === -1) throw new PipelineError("json_parse", "No JSON found in model output.");
  // Try progressively from the first bracket to the last closing bracket.
  const lastClose = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (lastClose === -1) throw new PipelineError("json_parse", "No JSON found in model output.");
  return JSON.parse(t.slice(start, lastClose + 1));
}

const STRICT_JSON_SUFFIX =
  "\n\nIMPORTANT: Respond with VALID JSON ONLY. No prose, no markdown fences, no explanations — just the JSON object.";

async function jsonCall(
  runId: string,
  step: string,
  baseUrl: string,
  model: string,
  prompt: string,
  temperature: number,
  primaryCtx: number,
  signal?: AbortSignal
): Promise<any> {
  const raw = await callWithRetry(
    runId, step, baseUrl, model, prompt, temperature, primaryCtx, signal
  );
  try {
    return extractJson(raw);
  } catch {
    logStep(runId, step, "json_retry");
    const raw2 = await callWithRetry(
      runId, step + "_json_retry", baseUrl, model,
      prompt + STRICT_JSON_SUFFIX, temperature, primaryCtx, signal
    );
    try {
      return extractJson(raw2);
    } catch {
      throw new PipelineError(
        "json_parse",
        "The pipeline failed during structured extraction, merge, or audit (the model did not return valid JSON)."
      );
    }
  }
}

// ---- Deterministic chunking fallback ----------------------------------------

export function chunkText(
  text: string,
  chunkSize = 10000,
  overlap = 1000
): { section_id: string; title: string; source_text: string }[] {
  const sections: { section_id: string; title: string; source_text: string }[] = [];
  let pos = 0;
  let i = 0;
  while (pos < text.length) {
    let end = Math.min(pos + chunkSize, text.length);
    if (end < text.length) {
      // Prefer to split on a paragraph boundary in the last 20% of the chunk.
      const windowStart = pos + Math.floor(chunkSize * 0.8);
      const para = text.lastIndexOf("\n\n", end);
      if (para > windowStart) end = para;
    }
    i++;
    sections.push({
      section_id: `section_${String(i).padStart(3, "0")}`,
      title: `Chunk ${i}`,
      source_text: text.slice(pos, end),
    });
    if (end >= text.length) break;
    pos = Math.max(end - overlap, pos + 1);
  }
  return sections;
}

// ---- Prompts -----------------------------------------------------------------

// Extraction is a LOSSLESS clinical detail inventory, not a summary. The old
// prompt told the model to "keep each fact concise", which made it drop detail,
// so the pipeline read as lossy compression next to the single-call path. This
// version insists that every discrete detail is preserved. When the user gave
// their own output-style instructions, they are included so extraction keeps
// whatever the final format will need.
function buildExtractPrompt(styleInstructions?: string): string {
  const header = `Extract a lossless clinical detail inventory from this source section.
This is an inventory, not a summary — preserve ALL clinically relevant details.

Rules:
- Do not summarize across dates, problems, medications, labs, imaging, consults, or events.
- Do not collapse trends into a single statement when individual values or dates are present — record each value or date as its own fact.
- Do not omit details because they seem repetitive or minor.
- Preserve dates, times, lab values with units, medication names/doses/routes/frequencies, imaging findings, procedures, microbiology results, consultant opinions, uncertainty, conflicts, and important negatives.
- Use one discrete fact per item. Keep each fact clear but complete — never shorten at the cost of losing detail.
- Do not infer. Do not resolve ambiguity. Do not add anything not stated in the source.
- Include a SHORT source_quote (a few words, for traceability only — never full sentences or paragraphs).
- Return JSON only. Do not write prose.
`;

  const styleBlock = styleInstructions?.trim()
    ? `
The final note will be written using these user instructions:
${styleInstructions.trim()}
Extract all facts needed to satisfy this structure and style. Do not omit details that may be required by the requested format.
`
    : "";

  const jsonSpec = `
Expected JSON:
{
  "section_id": "section_001",
  "facts": [
    {
      "category": "reason_for_admission | past_history | baseline_status | presentation | exam | labs | imaging | microbiology | procedure | consult | treatment | hospital_event | complication | disposition | medication | follow_up | uncertainty",
      "date_or_time": "string or null",
      "fact": "string",
      "source_quote": "string",
      "certainty": "explicit | uncertain | conflicting"
    }
  ]
}

Section:
`;

  return header + styleBlock + jsonSpec;
}

// The user's own system prompt (their output-style instructions) takes
// precedence over the default section layout when provided.
function buildSynthesizePrompt(styleInstructions?: string): string {
  const header = `Write the final formatted clinical note from the extracted clinical facts below.

Organize the hospital course chronologically where timing is available (problem-based where chronology is unclear). Output only the final note — no working, no JSON, no commentary.

Rules:
- Be comprehensive, not brief. Use ALL clinically relevant facts provided.
- Do not omit details solely to improve readability or shorten the note.
- Do not collapse multiple dated events, lab values, imaging findings, medication changes, or consultant recommendations into one vague summary — keep them distinct.
- Merge only true duplicates (the same fact stated more than once).
- Use only the provided facts. Do not add unsupported claims.
- Do not invent dates, diagnoses, causality, or outcomes.
- Preserve uncertainty and conflicts where present.
- The source_quote field is provided only for traceability/context. Do not include quotes in the final note unless the user's instructions explicitly ask for quoted material.
- Do not mention the extraction process.
`;

  const format = styleInstructions?.trim()
    ? `
Formatting and style instructions from the user — follow these exactly for the structure, headings, tone, and style of the note (they override any default layout):
${styleInstructions.trim()}

Formatting fidelity rules (strict):
- Reproduce the section headings exactly as the instructions write them (e.g. a heading written as "HPI:" stays "HPI:" — do NOT renumber, rename, or bullet it).
- Do NOT turn the note or its sections into a numbered or bulleted list unless the instructions themselves show numbering or bullets for that part.
- Where the instructions DO show numbering or bullets (e.g. a numbered problem list with sub-items), use that exact numbering/bullet style there.
- Match the instructions' spacing/layout pattern (e.g. blank lines between sections) as shown.
`
    : `
Output sections:
Reason for admission
Relevant background
History of presenting illness / presentation
Hospital course
Current status / disposition
Outstanding issues / follow-up
`;

  return header + format + `
Extracted facts:
`;
}

const AUDIT_PROMPT = `Audit the final note against the extracted facts.
Return JSON only.
Check for:
- unsupported claims
- omitted clinically important facts
- chronology errors
- overconfident wording
- invented causality
- missing uncertainty

Expected JSON:
{
  "needs_repair": true,
  "unsupported_claims": ["string"],
  "omitted_important_facts": ["string"],
  "chronology_errors": ["string"],
  "overconfident_or_unsafe_phrasing": ["string"],
  "repair_instructions": ["string"]
}
`;

const REPAIR_PROMPT = `Revise the final note using the audit findings.
Rules:
- Only fix the listed problems.
- Do not add new unsupported content.
- Preserve the original note structure.
- Return the revised final note only.
`;

// ---- Temp artifacts (legacy cleanup only) -----------------------------------
//
// The per-step pipeline keeps no state on the server, so no artifacts are
// written anymore. This purge remains so run folders left behind by older
// versions (or by hard restarts) are still cleaned up at startup.

export async function cleanupStaleRuns(): Promise<void> {
  try {
    const entries = await fs.readdir(PIPELINE_TEMP_DIR, { withFileTypes: true });
    const now = Date.now();
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(PIPELINE_TEMP_DIR, e.name);
      try {
        const st = await fs.stat(dir);
        if (now - st.mtimeMs > STALE_RUN_MAX_AGE_MS) {
          await fs.rm(dir, { recursive: true, force: true });
          console.log(`[pipeline] purged stale run folder age_h=${((now - st.mtimeMs) / 3600000).toFixed(1)}`);
        }
      } catch {
        // ignore individual folder errors
      }
    }
  } catch {
    // temp dir doesn't exist yet — nothing to clean
  }
}

// ---- Per-step pipeline functions ---------------------------------------------
//
// Each function is one short unit of work, run inside its own HTTP request by
// /api/ollama/pipeline-step. The client carries the state between steps.

export type PipelineSection = {
  section_id: string;
  title: string;
  source_text: string;
};

export type SectionFacts = { section_id: string; facts: any[] };

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// Step: extract structured facts from one section. Runs on the SMALL model —
// extraction is a simpler task than writing the final note, and the small
// model is faster, which also makes parallel section extraction cheaper.
export async function extractSectionFacts(args: {
  baseUrl: string;
  section: PipelineSection;
  runId: string;
  styleInstructions?: string;
  signal?: AbortSignal;
}): Promise<any[]> {
  const { baseUrl, section, runId, styleInstructions, signal } = args;
  const selection = await selectModels(baseUrl);
  const factsJson = await jsonCall(
    runId,
    `extract_${section.section_id}`,
    baseUrl,
    selection.smallModel,
    buildExtractPrompt(styleInstructions) +
      JSON.stringify({
        section_id: section.section_id,
        title: section.title,
        source_text: section.source_text,
      }),
    0.1,
    CONTEXT_LENGTH,
    signal
  );
  return Array.isArray(factsJson?.facts) ? factsJson.facts : [];
}

// Step: pre-load ("warm") the large synthesize model while extraction is
// still running. In production the large model is often not in memory when
// synthesize starts (the small extract model displaced it or it timed out),
// and Ollama sends NO bytes until model load + prompt eval finish — if that
// silent window passes ~100s the proxy in front of Ollama returns 524.
// Warming moves the load time off the critical path. Failures are harmless:
// even if this request itself gets cut by the proxy, the model load it
// triggered continues server-side.
export async function warmLargeModel(args: {
  baseUrl: string;
  runId: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  const { baseUrl, runId, signal } = args;
  const startedAt = Date.now();
  try {
    const selection = await selectModels(baseUrl);
    await ollamaGenerate(
      baseUrl,
      selection.largeModel,
      "OK",
      // Warm at the lowest ctx tier — the tier the synthesize call almost
      // always sizes itself to. Matching it avoids a second load for a
      // different context size.
      { temperature: 0, top_p: 1, num_ctx: CTX_TIERS[0], num_predict: 1 },
      signal
    );
    logStep(runId, "warm", "call_ok", {
      model: selection.largeModel,
      duration_ms: Date.now() - startedAt,
    });
    return true;
  } catch (err: any) {
    logStep(runId, "warm", "call_failed", {
      duration_ms: Date.now() - startedAt,
      error_class: err?.errorClass ?? err?.code ?? "unknown",
    });
    return false;
  }
}

// Trim facts to the fields synthesis needs before sending them to the model.
// We deliberately keep category, date_or_time, fact, certainty, and a SHORT
// source_quote — richer facts produce a more faithful note. The quote is
// bounded (extraction is told to keep it to a few words, and we hard-cap it
// here) so this stays cheap: it does not meaningfully widen the model's silent
// prompt-evaluation window that can trip the ~100s proxy 524 on long notes.
function slimFactsForSynthesis(sectionFacts: SectionFacts[]): any[] {
  return (sectionFacts || [])
    .map((sf: any) => ({
      section_id: sf?.section_id,
      facts: (Array.isArray(sf?.facts) ? sf.facts : [])
        .map((f: any) => {
          const slim: Record<string, unknown> = {};
          if (f?.category) slim.category = f.category;
          if (f?.date_or_time) slim.date_or_time = f.date_or_time;
          if (f?.fact) slim.fact = f.fact;
          if (f?.certainty) slim.certainty = f.certainty;
          // Keep a short traceability quote, defensively capped so a model that
          // ignores the "a few words" instruction can't balloon the prompt.
          if (f?.source_quote) slim.source_quote = String(f.source_quote).slice(0, 160);
          return slim;
        })
        // Drop malformed/empty facts so they don't add noise to the prompt.
        .filter((slim: Record<string, unknown>) => slim.fact),
    }))
    // Drop sections that have no usable facts left.
    .filter((sf) => sf.facts.length > 0);
}

// Step: merge the facts and write the final note in ONE model call.
export async function synthesizeNote(args: {
  baseUrl: string;
  sectionFacts: SectionFacts[];
  runId: string;
  styleInstructions?: string;
  signal?: AbortSignal;
  onToken?: (text: string, kind: "response" | "thinking") => void;
  onAttemptStart?: () => void;
}): Promise<string> {
  const { baseUrl, sectionFacts, runId, styleInstructions, signal, onToken, onAttemptStart } = args;
  const selection = await selectModels(baseUrl);
  // Trim the facts to the fields synthesis needs (category, date_or_time, fact,
  // certainty, and a short traceability quote) and drop empty keys. Synthesize
  // is told the quote is context-only and must not appear in the note. The full
  // facts still go to audit.
  const slimFacts = slimFactsForSynthesis(sectionFacts);
  const note = stripThink(
    await callWithRetry(
      runId,
      "synthesize",
      baseUrl,
      selection.largeModel,
      buildSynthesizePrompt(styleInstructions) + JSON.stringify(slimFacts),
      0.1,
      CONTEXT_LENGTH,
      signal,
      onToken,
      onAttemptStart
    )
  );
  if (!note) {
    throw new PipelineError("empty_note", "The model returned an empty final note.");
  }
  return note;
}

// Step: audit the note against the facts; run one repair pass if needed.
// Audit is a quality gate, not a hard dependency — on failure the original
// note is returned rather than losing the run.
export async function auditAndRepairNote(args: {
  baseUrl: string;
  note: string;
  sectionFacts: SectionFacts[];
  runId: string;
  styleInstructions?: string;
  signal?: AbortSignal;
}): Promise<{ note: string; repaired: boolean }> {
  const { baseUrl, note, sectionFacts, runId, styleInstructions, signal } = args;
  const selection = await selectModels(baseUrl);

  let audit: any = null;
  try {
    audit = await jsonCall(
      runId,
      "audit",
      baseUrl,
      selection.largeModel,
      AUDIT_PROMPT +
        "\nExtracted facts:\n" + JSON.stringify(sectionFacts) +
        "\n\nFinal note:\n" + note,
      0.1,
      CONTEXT_LENGTH,
      signal
    );
    logStep(runId, "audit", "ok", { needs_repair: String(!!audit?.needs_repair) });
  } catch (err) {
    if (err instanceof PipelineError && err.errorClass === "cancelled") throw err;
    logStep(runId, "audit", "failed_continuing", {
      error_class: err instanceof PipelineError ? err.errorClass : "unknown",
    });
    return { note, repaired: false };
  }

  if (audit?.needs_repair !== true) {
    return { note, repaired: false };
  }

  try {
    const repaired = stripThink(
      await callWithRetry(
        runId,
        "repair",
        baseUrl,
        selection.largeModel,
        REPAIR_PROMPT +
          (styleInstructions?.trim()
            ? "\nThe note follows these user formatting/style instructions — preserve them exactly:\n" +
              styleInstructions.trim() + "\n"
            : "") +
          "\nAudit findings:\n" + JSON.stringify(audit, null, 2) +
          "\n\nFinal note to revise:\n" + note,
        0.1,
        CONTEXT_LENGTH,
        signal
      )
    );
    if (repaired) {
      logStep(runId, "repair", "ok", { note_chars: repaired.length });
      return { note: repaired, repaired: true };
    }
  } catch (err) {
    if (err instanceof PipelineError && err.errorClass === "cancelled") throw err;
    logStep(runId, "repair", "failed_keeping_original");
  }
  return { note, repaired: false };
}
