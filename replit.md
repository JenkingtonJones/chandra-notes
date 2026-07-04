# REST Express Application

## Overview

A full-stack TypeScript app (React + Express) that provides a chat interface for multiple AI providers (Ollama, OpenAI), a reusable prompt library, document OCR (PDF/XPS/OXPS), and a long-note pipeline that turns long raw clinical text into a formatted clinical note.

## System Architecture

- **Frontend**: React + TypeScript, built with Vite; Wouter for routing; TanStack Query for server state; React Hook Form + Zod for forms; Tailwind CSS + shadcn/ui (Radix primitives) for UI; Axios for HTTP.
- **Backend**: Express.js + TypeScript; RESTful endpoints; request logging, JSON parsing, error handling.
- **Database**: PostgreSQL via Drizzle ORM (schema in `shared/schema.ts`, access in `server/storage.ts`).
- **Serving**: One Express server serves both the API and the frontend (Vite dev server in development, static assets in production).

## Key Components

### Database Schema (`shared/schema.ts`)
- **llm_requests**: LLM interaction history with metadata.
- **users**: user records (prepared for future auth).
- **prompts**: reusable prompt library.
- **settings**: key-value app config (e.g. the Ollama server URL, so it survives restarts).

### AI Providers
- **Ollama** (local/self-hosted LLMs, default `http://localhost:11434`; the real server is set via the `OLLAMA_API_URL` env var / settings table), **OpenAI** (GPT models). Both support real-time response streaming.

### Document OCR
- Homepage accepts PDF/XPS/OXPS uploads (Ollama provider). Pages are rendered to PNG **in the browser** with MuPDF's WebAssembly build (`client/public/mupdf/`) to avoid large whole-file uploads (which hit the deploy proxy's request-size limit / HTTP 413).
- Each page image is posted individually to `POST /api/ollama/ocr-page`; the server runs a vision OCR model (auto-selected DeepSeek OCR model) and **streams** results back as NDJSON with heartbeats (keeps the connection under the proxy's ~100s silent-response 524 limit).
- Default OCR prompt is `"Free OCR."` (verbose prompts can yield empty output); a custom prompt is supported. Output shows per-page progress and live text. A server-side guard stops pages that fall into a model repetition loop.

### Long-Note Pipeline (Ollama)
Turns long clinical text into a formatted note without hitting proxy timeouts. Key design points:
- **Per-step requests**: the deployed edge proxy hard-kills any single request at ~300s, so the pipeline runs one short HTTP request per step (`POST /api/ollama/pipeline-step`). The **client** (`client/src/components/ollama/ollama-chat-working.tsx`) orchestrates and carries state; no run state is kept on the server.
- **Routing**: used when the "Use long-note pipeline" toggle is on OR input length ≥ threshold (`LONG_NOTE_CHARACTER_THRESHOLD`, default 12,000). Otherwise the normal one-shot path runs. Ollama only; OCR unaffected.
- **Steps**: `split` (instant deterministic char-chunking, no model call) → per-section `extract` (small model, up to 3 concurrent requests) → `synthesize` (large model writes the final note in one call) → `audit` + one repair pass (runs in the **background** after the note is shown; non-fatal — a failed audit still delivers the note).
- **Output style**: the user's "Instructions" box overrides the default six-section clinical layout for the synthesize step.
- **Model selection**: `server/pipeline.ts` discovers models via `GET {ollama}/api/tags` (cached 5 min), excludes embedding/rerank/OCR models, picks a large model (synthesize/audit) and a small model (extract). Override with `OLLAMA_SMALL_MODEL` / `OLLAMA_LARGE_MODEL` (currently pinned to `gemma4:e4b` / `gemma4:12B`).
- **Progress UI**: a looping loader cycles five fixed phrases; no step counts/progress bar/timer (per user preference). Detailed timings go to the browser console and server logs.
- **Overall cap**: `PIPELINE_MAX_RUN_MINUTES` (default 45), enforced client-side between steps.
- **Privacy**: no clinical text is ever logged — only run ID, step, status, model names, durations, character counts, and error classes.

#### Avoiding proxy 524s (the hard-won lessons)
The Ollama server sits behind a Cloudflare-style proxy that returns **HTTP 524 when the origin is silent for ~100-125s**. Multiple fixes keep every step under that limit:
- **`think: false`** on every generate call — *the real fix*. `gemma4:12B` is thinking-capable, and our task prompts ("silently merge and deduplicate… before writing") pushed it into a hidden reasoning phase that emitted **zero bytes for 125s+** before the first token, tripping the 524. Disabling thinking makes synthesize first-token in ~1s and finish in ~6s. (This was the true cause — not model load, context reload, prompt size, socket reuse, or the HTTP library, all of which were ruled out by isolating the exact prompt with thinking on vs off.)
- **`keep_alive: "30m"`** on every call so the model stays loaded between steps/runs.
- **`warm` step**: a tiny generate fired right after `split` (in parallel with extracts) to pre-load the large model off the critical path. Warm failures never fail the run.
- **`slimFactsForSynthesis()`**: strips audit-only/empty fields before synthesize to shrink the prompt-eval window (audit still gets the full facts).
- **Streaming (`stream: true`)** with an immediate first byte + heartbeats on model steps; `{reset:true}` clears stale partial text on retry.
- **Transient retries**: HTTP 502/503/504 and connection drops retry 3× (3s/10s/20s) within a 210s per-request budget; the client also retries synthesize up to 3× in fresh requests.
- **axios gotcha**: never pass an `AbortSignal` via axios's `signal` option together with `responseType: "stream"` — it delays/stalls the stream. Cancellation is done manually by destroying the response stream.
- **Dev gotcha**: killing a client request does NOT stop the in-flight Ollama generation (the proxy keeps the origin running); "zombie" generations can queue new requests behind them and cause 524s until they drain.

## External Dependencies

- **Data**: `@neondatabase/serverless` (Postgres), `drizzle-orm`.
- **Frontend**: `@tanstack/react-query`, `wouter`, `axios`, `@radix-ui/*`, `tailwindcss`, `class-variance-authority`, `lucide-react`.
- **AI**: `openai` SDK; Ollama via HTTP.
- **OCR**: `mupdf` (WebAssembly).

## Deployment

- **Dev**: `npm run dev` (Express + Vite with hot reload).
- **Build**: `npm run build` (Vite client build + esbuild server bundle).
- **Start**: `npm run start` (production server).
- **DB**: `npm run db:push` applies schema changes (never hand-write SQL migrations; use `--force` if a data-loss warning appears).
- **Key env vars**: `DATABASE_URL` (required), `OPENAI_API_KEY`, `OLLAMA_API_URL` (Ollama server; defaults to `http://localhost:11434`, also persisted in the DB), plus the optional pipeline tuning vars above.
- Fixes deployed here only take effect after re-publishing.

## Changelog

```
- Jun 29, 2025: Initial setup; added Ollama server reconnect button.
- Oct 15, 2025: Persistent server config in DB (settings table); Ollama URL survives restarts; server URL configured via env / settings table.
- Jun 22, 2026: Document OCR (PDF/XPS/OXPS). Reworked to browser-side MuPDF rendering + per-page upload to fix HTTP 413 on large files.
- Jun 23, 2026: OCR per-page streaming with heartbeats to fix HTTP 524 on slow pages; added a repetition-loop guard.
- Jul 3, 2026: Long-note pipeline redesigned around per-step requests (edge proxy kills any single request at ~300s); condensed steps; audit made non-fatal; client-side overall time cap.
- Jul 4, 2026: Found and fixed the real cause of synthesize 524s — disabled model "thinking" (`think: false`), so synthesize first-tokens in ~1s and completes in ~6s.
- Jul 4, 2026: Removed the deprecated Azure providers (Azure OpenAI + legacy Azure VM chat) and the `AZURE_LLM_API_URL` env var — the feature was unused.
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```
