import type { Request, Response, NextFunction } from "express";

// Metadata-only API request logging.
//
// PRIVACY: this app processes clinical text (long-note pipeline input, OCR
// output, chat prompts). We must NEVER log request bodies, response bodies,
// prompts, generated text, or extracted facts — any of those can contain PHI.
// This logger records only the request method, path, status code, and duration.
//
// It is deliberately a small, pure, testable unit (see scripts/privacy-log-check.ts)
// so a future change can't quietly reintroduce body logging without failing the
// privacy regression check.

export function buildApiLogLine(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): string {
  return `${method} ${path} ${statusCode} in ${durationMs}ms`;
}

// Extract ONLY safe metadata from a thrown error for logging.
//
// PRIVACY: never log an error object directly. A raw axios error is enumerable
// and includes `config.data` — the JSON request body, which for this app holds
// the prompt / clinical text / OCR image payload. Logging the whole error (or
// error.response.data) would leak PHI. This returns message/name/code/HTTP
// status only, and deliberately omits config, request, response bodies, etc.
export function safeErrorMeta(error: unknown): {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
} {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const e = error as Record<string, any>;
  const meta: { name?: string; message?: string; code?: string; status?: number } = {};
  if (typeof e.name === "string") meta.name = e.name;
  if (typeof e.message === "string") meta.message = e.message;
  if (typeof e.code === "string") meta.code = e.code;
  // axios puts the upstream HTTP status on error.response.status
  if (e.response && typeof e.response.status === "number") meta.status = e.response.status;
  return meta;
}

export function createApiLoggingMiddleware(logFn: (line: string) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      logFn(buildApiLogLine(req.method, path, res.statusCode, Date.now() - start));
    });

    next();
  };
}
