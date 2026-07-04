import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, RefreshCw, Send, BrainCircuit, ChevronDown, Settings, ChevronUp, X, Upload, FileText, ScanText, Layers } from "lucide-react";
import type { Model } from "@/types/ollama";
import { SystemPrompt } from "./system-prompt";
import { ModelSelector } from "./model-selector";
import { useOllama } from "@/hooks/use-ollama";
import { useHybridStreaming } from "@/hooks/use-hybrid-streaming";
import { ServerConfig } from "./server-config";
import { Connector } from "./connector";
import { LLMProviderSelector, type LLMConfig } from "@/components/llm-provider-selector";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { copyToClipboard } from "@/utils/text-utils";
import { openDocument, type RenderedDocument } from "@/utils/ocr-render";
import { Separator } from "@/components/ui/separator";
import ReactMarkdown from "react-markdown";

interface OllamaResponse {
  response: string;
}

// Cycling loader for the long-note pipeline: each phrase shows for 1.5s and
// fades out/in between phrases, looping until the note is delivered.
const PIPELINE_PHRASES = [
  "Reading background knowledge",
  "Organizing my thoughts",
  "Assembling facts",
  "Adding style",
  "Checking errors",
];

function PipelineCyclingLoader() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let swap: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setVisible(false);
      swap = setTimeout(() => {
        setIdx((i) => (i + 1) % PIPELINE_PHRASES.length);
        setVisible(true);
      }, 300);
    }, 1500);
    return () => {
      clearInterval(interval);
      if (swap) clearTimeout(swap);
    };
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-2 rounded">
      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
      <span
        className={`transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
      >
        {PIPELINE_PHRASES[idx]}
      </span>
    </div>
  );
}

export function OllamaChat() {
  const { toast } = useToast();
  const ollama = useOllama();
  const { startStream } = useHybridStreaming();
  const [inputText, setInputText] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamedOutput, setStreamedOutput] = useState<string>("");
  const [thoughtProcess, setThoughtProcess] = useState<string>("");
  const [streamingError, setStreamingError] = useState<string>("");
  const [loadingStage, setLoadingStage] = useState<string>("");
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [cleanupStream, setCleanupStream] = useState<(() => void) | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: 'ollama',
    model: '',
    temperature: 0.7,
    maxTokens: 2048,
    openaiModel: 'gpt-4o'
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ocrPrompt, setOcrPrompt] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [usePipelineToggle, setUsePipelineToggle] = useState(false);
  // Increments per pipeline run so a background audit from an older run can
  // never overwrite the output of a newer one; the abort ref lets a new run
  // (or stop) cancel an in-flight background audit from the previous run.
  const pipelineRunTokenRef = useRef(0);
  const pipelineAbortRef = useRef<AbortController | null>(null);

  // Long-note pipeline config: routing threshold + which models the server
  // selected (env override or auto-selection from the Ollama model list).
  const { data: pipelineConfig } = useQuery<{
    threshold: number;
    maxRunMinutes?: number;
    smallModel?: string;
    largeModel?: string;
  }>({
    queryKey: ["/api/ollama/pipeline-config"],
    staleTime: 1000 * 60 * 5,
  });
  const pipelineThreshold = pipelineConfig?.threshold ?? 12000;
  const pipelineMaxRunMinutes = pipelineConfig?.maxRunMinutes ?? 45;

  const willUsePipeline =
    llmConfig.provider === "ollama" &&
    !selectedFile &&
    (usePipelineToggle || inputText.trim().length >= pipelineThreshold);

  // Find the best matching DeepSeek OCR model from the installed Ollama models.
  const findOcrModel = useCallback((models: Model[]): string | null => {
    const lower = (n: string) => n.toLowerCase();
    let m = models.find(x => lower(x.name).includes('deepseek') && lower(x.name).includes('ocr'));
    if (!m) m = models.find(x => lower(x.name).includes('ocr'));
    return m?.name || null;
  }, []);

  // Validate the uploaded file and auto-select an OCR model.
  const handleFileSelect = useCallback((file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const name = file.name.toLowerCase();
    const isValid = ['.pdf', '.xps', '.oxps'].some(ext => name.endsWith(ext));
    if (!isValid) {
      toast({
        title: "Unsupported file",
        description: "Please upload a PDF, XPS, or OXPS file.",
        variant: "destructive"
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSelectedFile(file);

    const ocrModel = findOcrModel(ollama.models);
    if (ocrModel) {
      ollama.setCurrentModel(ocrModel);
      toast({
        title: "OCR model selected",
        description: `Using "${ocrModel}" to read this document.`,
      });
    } else {
      toast({
        title: "No OCR model found",
        description: "No DeepSeek OCR model is installed on your Ollama server. Pull one first, e.g. 'ollama pull deepseek-ocr'.",
        variant: "destructive"
      });
    }
  }, [ollama, findOcrModel, toast]);

  // Render the document in the browser and OCR it one page at a time.
  // Each page image is uploaded on its own so we never send a large request
  // (large whole-file uploads can fail with HTTP 413 at the deployment proxy).
  const handleOcrSubmit = useCallback(async () => {
    if (!selectedFile) return;

    if (!ollama.isConnected) {
      toast({
        title: "Ollama Not Connected",
        description: "Please connect to your Ollama server first.",
        variant: "destructive"
      });
      return;
    }
    if (!ollama.currentModel) {
      toast({
        title: "No OCR Model",
        description: "Select a DeepSeek OCR model before running OCR.",
        variant: "destructive"
      });
      return;
    }

    if (cleanupStream) {
      cleanupStream();
      setCleanupStream(null);
    }

    setIsStreaming(true);
    setOutput("");
    setStreamedOutput("");
    setResponseTime(null);
    setThoughtProcess("");
    setStreamingError("");
    setLoadingStage("Loading document...");

    const startTime = Date.now();
    const state: { cancelled: boolean; controller: AbortController | null } = {
      cancelled: false,
      controller: null,
    };
    setCleanupStream(() => () => {
      state.cancelled = true;
      state.controller?.abort();
    });

    let fullResponse = "";
    let doc: RenderedDocument | null = null;

    try {
      doc = await openDocument(selectedFile);
      const totalPages = doc.totalPages;
      setLoadingStage(
        `Document loaded — ${totalPages} page(s) found. Starting OCR...`
      );

      for (let i = 0; i < totalPages; i++) {
        if (state.cancelled) break;
        const pageNum = i + 1;
        setLoadingStage(`Processing page ${pageNum} of ${totalPages}...`);

        const pageImage = await doc.renderPage(i);
        if (state.cancelled) break;

        const formData = new FormData();
        formData.append("image", pageImage, `page-${pageNum}.png`);
        formData.append("model", ollama.currentModel);
        if (ocrPrompt.trim()) formData.append("prompt", ocrPrompt.trim());

        const controller = new AbortController();
        state.controller = controller;

        const response = await fetch("/api/ollama/ocr-page", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const err = await response.json();
            if (err?.error) message = err.error;
          } catch {
            // keep the default message
          }
          throw new Error(message);
        }

        // The page is streamed back as newline-delimited JSON (one chunk per
        // line). We accumulate tokens as they arrive so the proxy never times
        // out on a slow page and the user sees live progress within the page.
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let pageText = "";
        let buf = "";
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (state.cancelled) {
              controller.abort();
              break;
            }
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue; // heartbeat / blank line
              let obj: any;
              try {
                obj = JSON.parse(trimmed);
              } catch {
                continue;
              }
              if (obj.error) throw new Error(obj.error);
              if (typeof obj.response === "string") {
                pageText += obj.response;
                setStreamedOutput(
                  `${fullResponse}\n\n## Page ${pageNum}\n\n${pageText}`.trim()
                );
              }
            }
          }
          // Flush any trailing buffered line after the stream ends.
          const tail = (buf + decoder.decode()).trim();
          if (tail) {
            try {
              const obj: any = JSON.parse(tail);
              if (obj.error) throw new Error(obj.error);
              if (typeof obj.response === "string") pageText += obj.response;
            } catch {
              // ignore a partial/non-JSON trailing fragment
            }
          }
        }

        fullResponse += `\n\n## Page ${pageNum}\n\n${pageText.trim()}`;
        setStreamedOutput(fullResponse.trim());
      }

      setOutput(fullResponse.trim());
      setResponseTime((Date.now() - startTime) / 1000);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // User cancelled — keep whatever was extracted so far
        setOutput(fullResponse.trim());
      } else {
        const message = error instanceof Error ? error.message : "OCR failed";
        setStreamingError(message);
        toast({
          title: "OCR Error",
          description: message,
          variant: "destructive"
        });
      }
    } finally {
      try {
        doc?.close();
      } catch {
        // ignore cleanup errors
      }
      setIsStreaming(false);
      setLoadingStage("");
      setCleanupStream(null);
    }
  }, [selectedFile, ollama, ocrPrompt, cleanupStream, toast]);

  // Run one pipeline step on the server. The "split" step answers with plain
  // JSON immediately; model steps stream NDJSON (blank heartbeat lines, then
  // {result, done:true} or {error}). Returns the step's result object.
  const runPipelineStep = useCallback(
    async (
      body: Record<string, unknown>,
      signal: AbortSignal,
      onToken?: (text: string, kind: "response" | "thinking" | "reset") => void
    ): Promise<any> => {
      const stepLabel =
        body.step === "extract" && (body.section as any)?.section_id
          ? `extract ${(body.section as any).section_id}`
          : String(body.step);
      const stepStart = performance.now();
      const logTiming = (status: string) =>
        console.log(
          `[pipeline] ${stepLabel}: ${((performance.now() - stepStart) / 1000).toFixed(1)}s (${status})`
        );

      const response = await fetch("/api/ollama/pipeline-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const err = await response.json();
          if (err?.error) message = err.error;
        } catch {
          // keep the default message
        }
        logTiming("failed");
        throw new Error(message);
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        if (data?.error) {
          logTiming("failed");
          throw new Error(data.error);
        }
        logTiming("ok");
        return data?.result;
      }

      // NDJSON stream: skip heartbeats, find {result, done} or {error}.
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The pipeline step returned no data.");
      const decoder = new TextDecoder();
      let buf = "";
      let result: any = undefined;

      const handleLine = (trimmed: string) => {
        let obj: any;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (obj.error) {
          logTiming("failed");
          throw new Error(obj.error);
        }
        if (typeof obj.token === "string") {
          onToken?.(obj.token, "response");
          return;
        }
        if (typeof obj.thinking === "string") {
          onToken?.(obj.thinking, "thinking");
          return;
        }
        if (obj.reset === true) {
          onToken?.("", "reset");
          return;
        }
        if (obj.done && obj.result !== undefined) result = obj.result;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue; // heartbeat / blank line
          handleLine(trimmed);
        }
      }
      const tail = (buf + decoder.decode()).trim();
      if (tail) handleLine(tail);

      if (result === undefined) {
        logTiming("connection dropped");
        throw new Error(
          "The connection dropped before the step finished. Please try again."
        );
      }
      logTiming("ok");
      return result;
    },
    []
  );

  // Orchestrate the condensed pipeline client-side, one request per step:
  // split (instant) -> extract facts per section -> synthesize note -> audit.
  // Each request is short, so the deployed app's ~5-minute per-request cap is
  // never hit no matter how long the whole run takes.
  const handlePipelineSubmit = useCallback(async () => {
    if (cleanupStream) {
      cleanupStream();
      setCleanupStream(null);
    }
    // Invalidate and cancel any leftover background audit from a prior run.
    const runToken = ++pipelineRunTokenRef.current;
    pipelineAbortRef.current?.abort();

    setIsStreaming(true);
    setOutput("");
    setStreamedOutput("");
    setResponseTime(null);
    setThoughtProcess("");
    setStreamingError("");
    setIsPipelineRunning(true);

    const startTime = Date.now();
    const controller = new AbortController();
    pipelineAbortRef.current = controller;
    setCleanupStream(() => () => controller.abort());

    const checkTimeBudget = () => {
      if (Date.now() - startTime > pipelineMaxRunMinutes * 60 * 1000) {
        throw new Error(
          `The long-note pipeline hit its ${pipelineMaxRunMinutes}-minute time limit and was stopped. Try a shorter note, or split the note dump into parts and run them separately.`
        );
      }
    };

    try {
      // Step 1: deterministic split (no model call — instant).
      const splitResult = await runPipelineStep(
        { step: "split", text: inputText.trim() },
        controller.signal
      );
      const sections: { section_id: string; title: string; source_text: string }[] =
        Array.isArray(splitResult?.sections) ? splitResult.sections : [];
      if (sections.length === 0) {
        throw new Error("The note could not be divided into sections.");
      }

      // Warm up the large synthesize model in parallel with extraction. In
      // production the large model is often not loaded when synthesize starts,
      // and loading it plus reading a long prompt can exceed the ~100s silent
      // window the Ollama-side proxy allows, killing the call (HTTP 524).
      // Warming is best-effort: a failure here never fails the run.
      const warmPromise = runPipelineStep(
        { step: "warm" },
        controller.signal
      ).catch(() => null);

      // Step 2: extract facts, one request per section, up to 3 sections at a
      // time. The small extraction model makes parallel calls cheap; if the
      // Ollama server processes them one at a time the total is no worse than
      // running them sequentially.
      const EXTRACT_CONCURRENCY = 3;
      const sectionFacts: { section_id: string; facts: any[] }[] = new Array(
        sections.length
      );
      let nextSection = 0;
      const extractWorker = async () => {
        while (nextSection < sections.length) {
          const i = nextSection++;
          checkTimeBudget();
          const extractResult = await runPipelineStep(
            // Pass the user's system prompt so extraction keeps whatever detail
            // the requested output format will need (lossless inventory).
            { step: "extract", section: sections[i], systemPrompt },
            controller.signal
          );
          sectionFacts[i] = {
            section_id: sections[i].section_id,
            facts: Array.isArray(extractResult?.facts) ? extractResult.facts : [],
          };
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(EXTRACT_CONCURRENCY, sections.length) },
          () => extractWorker()
        )
      );

      // Make sure the warm-up finished (usually it did long ago) so the big
      // model is loaded before the synthesize prompt is sent.
      await warmPromise;

      // Step 3: merge the facts and write the note in one model call. The
      // note streams into the Output window as it's written; while a thinking
      // model is still reasoning, its live thinking stream is shown instead.
      // If a synthesize attempt is cut off (e.g. the Ollama-side proxy killed
      // a long-silent call while the model was still loading), retry the whole
      // step in a fresh request — by then the model is warm, so a retry is
      // much faster and usually succeeds.
      let liveNote = "";
      let liveThinking = "";
      const onSynthToken = (tokenText: string, kind: string) => {
        if (kind === "reset") {
          liveNote = "";
          liveThinking = "";
        } else if (kind === "thinking") {
          liveThinking += tokenText;
        } else {
          liveNote += tokenText;
        }
        setStreamedOutput(liveNote || liveThinking);
      };
      const SYNTH_ATTEMPTS = 3;
      let synthResult: any = null;
      for (let attempt = 1; attempt <= SYNTH_ATTEMPTS; attempt++) {
        checkTimeBudget();
        try {
          liveNote = "";
          liveThinking = "";
          synthResult = await runPipelineStep(
            { step: "synthesize", sectionFacts, systemPrompt },
            controller.signal,
            onSynthToken
          );
          break;
        } catch (err) {
          if (controller.signal.aborted || attempt === SYNTH_ATTEMPTS) throw err;
          console.log(
            `[pipeline] synthesize attempt ${attempt} failed, retrying in a fresh request...`
          );
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      const finalNote = typeof synthResult?.note === "string" ? synthResult.note : "";
      if (!finalNote) {
        throw new Error("The long-note pipeline finished without producing a note.");
      }

      // The note is ready — deliver it and finish the run NOW (the timer and
      // progress bar stop here). The audit runs quietly in the background and
      // only swaps the note in if it actually repaired something.
      setOutput(finalNote);
      setStreamedOutput(finalNote);
      setResponseTime((Date.now() - startTime) / 1000);
      console.log(
        `[pipeline] TOTAL: ${(((Date.now() - startTime)) / 1000).toFixed(1)}s ` +
          `(${sections.length} section${sections.length === 1 ? "" : "s"} extracted + 1 synthesize; ` +
          `background quality check still running)`
      );

      void (async () => {
        try {
          const auditResult = await runPipelineStep(
            { step: "audit", note: finalNote, sectionFacts, systemPrompt },
            controller.signal
          );
          if (
            pipelineRunTokenRef.current === runToken &&
            auditResult?.repaired === true &&
            typeof auditResult?.note === "string" &&
            auditResult.note.trim()
          ) {
            setOutput(auditResult.note);
            setStreamedOutput(auditResult.note);
            toast({
              title: "Note updated",
              description:
                "A background quality check fixed some details in the note.",
            });
          }
        } catch {
          // Background check only — the delivered note stays as-is.
        }
      })();
    } catch (error) {
      // Cancel any sibling requests still in flight (e.g. parallel extracts).
      controller.abort();
      if (error instanceof Error && error.name === "AbortError") {
        // User cancelled — nothing else to do.
      } else {
        const message =
          error instanceof Error ? error.message : "Long-note pipeline failed";
        setStreamingError(message);
        toast({
          title: "Long-Note Pipeline Error",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setIsStreaming(false);
      setIsPipelineRunning(false);
      setCleanupStream(null);
    }
  }, [inputText, systemPrompt, cleanupStream, toast, runPipelineStep, pipelineMaxRunMinutes]);

  const handleSubmit = useCallback(async () => {
    // Document OCR mode takes over when a file is attached (Ollama provider only).
    if (selectedFile && llmConfig.provider === 'ollama') {
      await handleOcrSubmit();
      return;
    }

    if (!inputText.trim()) {
      toast({
        title: "Empty Input",
        description: "Please enter some text to process",
        variant: "destructive"
      });
      return;
    }

    // Validation based on selected provider
    if (llmConfig.provider === 'ollama' && (!ollama.isConnected || !ollama.currentModel)) {
      toast({
        title: "Ollama Not Ready",
        description: "Please connect to Ollama and select a model first",
        variant: "destructive"
      });
      return;
    }

    // Long-note routing: when the toggle is on or the input crosses the
    // threshold, use the multi-step pipeline instead of the one-shot path.
    // The one-shot path below is unchanged.
    if (willUsePipeline) {
      await handlePipelineSubmit();
      return;
    }

    if (llmConfig.provider === 'openai' && !llmConfig.openaiModel) {
      toast({
        title: "OpenAI Model Required",
        description: "Please select an OpenAI model",
        variant: "destructive"
      });
      return;
    }

    // Cleanup any existing stream
    if (cleanupStream) {
      cleanupStream();
      setCleanupStream(null);
    }

    setIsStreaming(true);
    setOutput("");
    setStreamedOutput("");
    setResponseTime(null);
    setThoughtProcess("");
    setStreamingError("");
    setLoadingStage("Preparing request...");

    const prompt_text = inputText.trim();
    
    // Calculate input size for routing decision
    const totalInputSize = prompt_text.length + (systemPrompt?.length || 0);
    const isLargeInput = totalInputSize > 4000;
    
    let streamUrl = '';
    let requestMethod: 'GET' | 'POST' = 'GET';
    let requestBody: any = null;
    
    // Build URL and request data based on provider and input size
    switch (llmConfig.provider) {
      case 'ollama':
        if (isLargeInput) {
          // Use POST for large inputs to avoid header size limits
          streamUrl = `/api/ollama/generate-stream`;
          requestMethod = 'POST';
          requestBody = {
            model: ollama.currentModel,
            prompt: prompt_text,
            system: systemPrompt,
            temperature: ollama.temperature,
            top_p: ollama.topP
          };
        } else {
          // Use GET for normal inputs (existing behavior)
          streamUrl = `/api/ollama/generate-stream?model=${encodeURIComponent(ollama.currentModel)}&prompt=${encodeURIComponent(prompt_text)}&system=${encodeURIComponent(systemPrompt || '')}&temperature=${ollama.temperature}&top_p=${ollama.topP}`;
        }
        break;
      case 'openai':
        streamUrl = `/api/openai/generate-stream?model=${encodeURIComponent(llmConfig.openaiModel || 'gpt-4o')}&prompt=${encodeURIComponent(prompt_text)}&system=${encodeURIComponent(systemPrompt || '')}&temperature=${llmConfig.temperature}&max_tokens=${llmConfig.maxTokens}`;
        break;
      default:
        throw new Error('Invalid LLM provider selected');
    }
    
    console.log(`Provider: ${llmConfig.provider}, Input size: ${totalInputSize} chars, using ${requestMethod}, URL: ${streamUrl}`);

    try {
      let fullResponse = "";
      let currentThought = "";
      let inThinkMode = false;
      const startTime = Date.now();
      
      // Set loading stage based on model size
      const selectedModel = ollama.models.find(m => m.name === ollama.currentModel);
      const isLargeModel = selectedModel && selectedModel.size > 15 * 1024 * 1024 * 1024; // 15GB+
      
      if (isLargeModel) {
        setLoadingStage("Loading large model (this may take 2-5 minutes)...");
      } else {
        setLoadingStage("Connecting to model...");
      }
      
      const cleanup = await startStream({
        url: streamUrl,
        method: requestMethod,
        body: requestBody,
        onMessage: (data: any) => {
          if (data.response) {
            // First response means model is loaded and working
            if (fullResponse === "") {
              setLoadingStage("Model loaded, generating response...");
            }
            
            fullResponse += data.response;
            
            // Real-time think tag processing
            if (data.response.includes('<think>')) {
              inThinkMode = true;
            }
            
            if (inThinkMode) {
              currentThought += data.response;
              if (data.response.includes('</think>')) {
                inThinkMode = false;
                const thinkMatch = currentThought.match(/<think>([\s\S]*?)<\/think>/);
                if (thinkMatch && thinkMatch[1]) {
                  setThoughtProcess(thinkMatch[1].trim());
                }
              }
            }
            
            // Update streamed output (excluding think tags for display)
            const displayText = fullResponse.replace(/<think>[\s\S]*?<\/think>/, '').trim();
            setStreamedOutput(displayText);
          }
        },
        onError: (error: Error) => {
          console.error("Streaming error:", error);
          setIsStreaming(false);
          setCleanupStream(null);
          
          toast({
            title: "Streaming Error", 
            description: `Connection failed: ${error.message}`,
            variant: "destructive"
          });
        },
        onComplete: () => {
          // Final processing for think tags - preserve any thought process already extracted
          const finalThinkMatch = fullResponse.match(/<think>([\s\S]*?)<\/think>/);
          if (finalThinkMatch && finalThinkMatch[1]) {
            // Only update if we have a complete thought process or if current one is empty
            const finalThought = finalThinkMatch[1].trim();
            setThoughtProcess(prevThought => prevThought || finalThought);
          }
          
          // Set final output without think tags
          setOutput(fullResponse.replace(/<think>[\s\S]*?<\/think>/, '').trim());
          
          const timeTaken = (Date.now() - startTime) / 1000;
          setResponseTime(timeTaken);
          setIsStreaming(false);
          setStreamingError("");
          setCleanupStream(null);
          setLoadingStage("");
        }
      });

      setCleanupStream(() => cleanup);
      
    } catch (error) {
      console.error("Submit error:", error);
      setIsStreaming(false);
      setStreamingError("Failed to start streaming");
      toast({
        title: "Error",
        description: `Failed to process request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive"
      });
    }
  }, [inputText, systemPrompt, ollama, startStream, cleanupStream, toast, selectedFile, llmConfig.provider, handleOcrSubmit, willUsePipeline, handlePipelineSubmit]);

  const handleStop = useCallback(() => {
    if (cleanupStream) {
      cleanupStream();
      setCleanupStream(null);
    }
    setIsStreaming(false);
    setStreamingError("");
  }, [cleanupStream]);

  const handleClear = useCallback(() => {
    setInputText("");
    setOutput("");
    setStreamedOutput("");
    setResponseTime(null);
    setThoughtProcess("");
    setStreamingError("");
    if (cleanupStream) {
      cleanupStream();
      setCleanupStream(null);
    }
  }, [cleanupStream]);

  const displayOutput = isStreaming ? streamedOutput : output;

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Connector isConnected={ollama.isConnected} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
            {showAdvanced ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
          </Button>
        </div>
      </div>

      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleContent className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ServerConfig
                serverUrl={ollama.serverUrl}
                isConnected={ollama.isConnected}
                onUpdateServerUrl={ollama.updateServerUrl}
                onReconnect={ollama.reconnectToServer}
              />
              
              <Separator />
              
              <ModelSelector
                models={ollama.models}
                currentModel={ollama.currentModel}
                setCurrentModel={ollama.setCurrentModel}
                temperature={ollama.temperature}
                setTemperature={ollama.setTemperature}
                topP={ollama.topP}
                setTopP={ollama.setTopP}
                onRefreshModels={ollama.refreshModels}
              />

              <Separator />

              <LLMProviderSelector
                config={llmConfig}
                onConfigChange={setLlmConfig}
                ollamaModels={ollama.models}
                currentOllamaModel={ollama.currentModel}
                setCurrentOllamaModel={ollama.setCurrentModel}
                ollamaTemperature={ollama.temperature}
                setOllamaTemperature={ollama.setTemperature}
                ollamaTopP={ollama.topP}
                setOllamaTopP={ollama.setTopP}
              />
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Input</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Document OCR upload (PDF / XPS / OXPS) */}
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xps,.oxps,application/pdf"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              />
              {!selectedFile ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload PDF / XPS / OXPS for OCR
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 p-2 border rounded-md bg-blue-50 dark:bg-blue-900/20">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="text-sm truncate">{selectedFile.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isStreaming}
                      onClick={() => {
                        setSelectedFile(null);
                        setOcrPrompt("");
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    placeholder={'Optional OCR prompt (leave blank for "Free OCR."). Try "<image>\\n<|grounding|>Convert the document to markdown." for layout-aware markdown.'}
                    value={ocrPrompt}
                    onChange={(e) => setOcrPrompt(e.target.value)}
                    className="min-h-[60px] resize-none text-sm"
                    disabled={isStreaming}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    The document will be read page by page with the selected OCR model. Large files may take a few minutes.
                  </p>
                </div>
              )}
            </div>

            <SystemPrompt 
              systemPrompt={systemPrompt}
              setSystemPrompt={setSystemPrompt}
            />

            {llmConfig.provider === 'ollama' && !selectedFile && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 p-2 border rounded-md">
                  <div className="flex items-center gap-2 min-w-0">
                    <Layers className="h-4 w-4 text-blue-500 shrink-0" />
                    <Label htmlFor="pipeline-toggle" className="text-sm cursor-pointer">
                      Use long-note pipeline
                    </Label>
                  </div>
                  <Switch
                    id="pipeline-toggle"
                    checked={usePipelineToggle}
                    onCheckedChange={setUsePipelineToggle}
                    disabled={isStreaming}
                  />
                </div>
                {willUsePipeline && (
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    {usePipelineToggle
                      ? "Long-note pipeline is on: the note will be split, analyzed, and rewritten in stages."
                      : `Long note detected (${inputText.trim().length.toLocaleString()} characters) — the long-note pipeline will be used automatically.`}
                    {pipelineConfig?.smallModel && pipelineConfig?.largeModel && (
                      <> Models: {pipelineConfig.smallModel} + {pipelineConfig.largeModel}.</>
                    )}
                  </p>
                )}
              </div>
            )}

            <Textarea
              placeholder={selectedFile ? "Document OCR mode is active — text input is ignored." : "Enter your prompt here..."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="min-h-[200px] resize-none"
              disabled={!!selectedFile}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            
            <div className="flex gap-2">
              <Button 
                onClick={handleSubmit} 
                disabled={isStreaming || (llmConfig.provider === 'ollama' && !ollama.isConnected)}
                className="flex-1"
              >
                {isStreaming ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {selectedFile ? "Reading document..." : "Streaming..."}
                  </>
                ) : selectedFile ? (
                  <>
                    <ScanText className="mr-2 h-4 w-4" />
                    Run OCR (Ctrl+Enter)
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send (Ctrl+Enter)
                  </>
                )}
              </Button>
              {isStreaming && (
                <Button variant="destructive" onClick={handleStop}>
                  <X className="h-4 w-4" />
                </Button>
              )}
              <Button variant="outline" onClick={handleClear}>
                Clear
              </Button>
            </div>
            
            {streamingError && (
              <div className="text-sm text-orange-600 bg-orange-50 p-2 rounded">
                {streamingError}
              </div>
            )}
            
            {isPipelineRunning ? (
              <PipelineCyclingLoader />
            ) : (
              loadingStage && (
                <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-2 rounded">
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <span className="flex-1">{loadingStage}</span>
                </div>
              )
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col space-y-2">
            <div className="flex flex-row items-center justify-between">
              <CardTitle>Output</CardTitle>
              <div className="flex items-center gap-2">
                {thoughtProcess && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowThinking(!showThinking)}
                  >
                    <BrainCircuit className="h-4 w-4 mr-2" />
                    Chain of Reasoning
                    {showThinking ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
                  </Button>
                )}
                {responseTime && (
                  <Badge variant="secondary">
                    {responseTime.toFixed(2)}s
                  </Badge>
                )}
                {displayOutput && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(displayOutput, toast)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            {thoughtProcess && showThinking && (
              <div className="p-3 bg-blue-50 rounded border text-sm max-h-[200px] overflow-auto">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-blue-700">Chain of Reasoning</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(thoughtProcess, toast)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="whitespace-pre-wrap text-blue-800">
                  {thoughtProcess}
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col flex-1">
            <div className="min-h-[200px] p-3 bg-gray-50 rounded border text-sm overflow-auto flex-1">
              {displayOutput ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown>{displayOutput}</ReactMarkdown>
                </div>
              ) : (
                <div className="text-gray-500">Response will appear here...</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}