/**
 * Privacy regression check (run with: npx tsx scripts/privacy-log-check.ts)
 *
 * This app processes clinical text (long-note pipeline input, OCR output, chat
 * prompts). None of that must ever reach the application logs. This script fails
 * (exit code 1) if:
 *   1. the API logging middleware emits anything beyond request metadata when a
 *      handler responds with synthetic clinical text, or
 *   2. any known body/prompt/generated-text logging pattern reappears in the
 *      server source (a regression guard).
 *
 * It uses only Node built-ins + the exported logging module, so it runs without
 * a test framework.
 */
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildApiLogLine, createApiLoggingMiddleware } from "../server/logging";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// A distinctive synthetic "PHI" marker. It is NOT real patient data.
const SYNTH_PHI = "SYNTH_PHI_MRN_00000_John_Doe_penicillin_allergy";

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`FAIL: ${msg}`);
};
const pass = (msg: string) => console.log(`PASS: ${msg}`);

// ---- 1. Behavioral: middleware logs metadata only ---------------------------
{
  const logs: string[] = [];
  const middleware = createApiLoggingMiddleware((line) => logs.push(line));

  // Minimal fake req/res. res is an EventEmitter so the middleware's
  // res.on("finish", ...) handler fires when we emit "finish".
  const req: any = { path: "/api/ollama/pipeline-step", method: "POST" };
  const res: any = new EventEmitter();
  res.statusCode = 200;
  // Simulate a handler that returns clinical text in its JSON body.
  res.json = (_body: unknown) => res;

  middleware(req, res, () => {});

  // A handler responds with synthetic clinical content, then the response ends.
  res.json({ result: { sections: [{ source_text: SYNTH_PHI }] } });
  res.emit("finish");

  const combined = logs.join("\n");
  if (logs.length !== 1) {
    fail(`expected exactly 1 log line, got ${logs.length}`);
  }
  if (combined.includes(SYNTH_PHI)) {
    fail("synthetic clinical text leaked into the API log line");
  } else {
    pass("API log line contains no clinical/body content");
  }
  if (
    combined.includes("POST") &&
    combined.includes("/api/ollama/pipeline-step") &&
    combined.includes("200")
  ) {
    pass("API log line still contains request metadata (method/path/status)");
  } else {
    fail(`API log line missing expected metadata: "${combined}"`);
  }
}

// ---- 2. buildApiLogLine is body-free by construction ------------------------
{
  const line = buildApiLogLine("POST", "/api/x", 200, 12);
  if (line === "POST /api/x 200 in 12ms") {
    pass("buildApiLogLine emits metadata only");
  } else {
    fail(`buildApiLogLine unexpected output: "${line}"`);
  }
}

// ---- 3. Regression guard: forbidden logging patterns must not return --------
{
  const files = ["server/index.ts", "server/routes.ts"];
  // Substrings that only ever appeared in code that logged bodies / prompts /
  // generated text / filenames. If any reappears, a leak has been reintroduced.
  const forbidden = [
    "capturedJsonResponse",
    "JSON.stringify(requestData, null, 2)",
    "chunkStr.substring(0, 200)",
    "Parsed JSON from line",
    "Sent data to client",
    "Skipped invalid JSON line",
    'file="${req.file.originalname}"',
  ];

  // Raw error dumps: `console.error("...", error)` / `console.log(..., err)`.
  // An axios error is enumerable and includes `config.data` (the request body =
  // prompt / clinical text / OCR payload), so a raw dump leaks PHI. Errors must
  // be logged via safeErrorMeta(...) instead.
  const rawErrorDump = /console\.(?:error|warn|log)\([^)]*,\s*(?:error|err)\)/g;

  const failuresBefore = failures;
  for (const rel of files) {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    for (const pattern of forbidden) {
      if (src.includes(pattern)) {
        fail(`${rel} contains forbidden logging pattern: ${pattern}`);
      }
    }
    const rawMatches = src.match(rawErrorDump);
    if (rawMatches) {
      for (const m of rawMatches) {
        fail(`${rel} logs a raw error object (leaks axios config.data): ${m} — use safeErrorMeta()`);
      }
    }
  }
  if (failures === failuresBefore) {
    pass("no forbidden body/prompt/generated-text/raw-error logging patterns in server source");
  }
}

if (failures > 0) {
  console.error(`\nPrivacy check FAILED with ${failures} problem(s).`);
  process.exit(1);
}
console.log("\nPrivacy check PASSED.");
