# AI Clinical Note Assistant

A full-stack TypeScript application that provides a streaming chat interface for multiple AI providers, a reusable prompt library, document OCR, and a purpose-built **long-note pipeline** that turns long, messy clinical text into a clean, formatted clinical note — all while staying robust against strict proxy/gateway timeouts.

> Built with React + Vite on the frontend and Express on the backend, sharing a single server and a PostgreSQL database.

---

## Features

### Multi-provider AI chat
- Chat with **Ollama** (self-hosted / local LLMs), **OpenAI** (GPT models), and **Azure OpenAI** (enterprise endpoints).
- Real-time **token streaming** for responses.
- Configurable model, temperature, and system prompt.
- The Ollama server URL is editable in the UI, persisted to the database, and survives restarts, with a one-click reconnect button.

### Prompt library
- Save, browse, and reuse prompts so common instructions don't have to be retyped.

### Document OCR (PDF / XPS / OXPS)
- Upload a document and extract its text with a vision OCR model via Ollama.
- Pages are rendered to images **in the browser** with MuPDF (WebAssembly), then uploaded **one page at a time** — this avoids large whole-file uploads that would be rejected by the deployment's request-size limit.
- Live per-page progress and streamed text, an auto-selected DeepSeek OCR model, and a guard that stops runaway model repetition loops.

### Long-note pipeline
- Converts long clinical input into a formatted note in coordinated short steps: **split → extract → synthesize → audit/repair**.
- Runs one short HTTP request per step, orchestrated by the client, so no single request can hit the platform's per-request time limit — long notes can take minutes without timing out.
- The final note follows the user's own formatting instructions, or a default six-section clinical layout.
- Uses a small model for fast parallel fact extraction and a larger model to write and audit the final note (both auto-selected or pinned via env vars).
- Designed around a strict upstream proxy that returns **HTTP 524** if the origin is silent for ~100 seconds — see [Reliability notes](#reliability-notes).

### Privacy
- No clinical text is ever written to logs. Logs contain only run IDs, step names, statuses, model names, durations, character counts, and error classes.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Wouter (routing), TanStack Query, React Hook Form + Zod |
| UI | Tailwind CSS, shadcn/ui (Radix primitives), lucide-react icons |
| Backend | Express.js, TypeScript |
| Database | PostgreSQL with Drizzle ORM |
| AI | Ollama (HTTP), OpenAI SDK, Azure OpenAI (HTTP) |
| OCR | MuPDF (WebAssembly) |

---

## Getting started

### Prerequisites
- Node.js 20+
- A PostgreSQL database (a connection string)
- Access to at least one AI provider (an Ollama server, and/or OpenAI / Azure OpenAI credentials)

### Install
```bash
npm install
```

### Configure environment
Create the environment variables listed in [Environment variables](#environment-variables). At minimum, `DATABASE_URL` is required.

### Set up the database
```bash
npm run db:push
```
This applies the Drizzle schema (`shared/schema.ts`) to your database. If it reports possible data loss, review the change and re-run with `--force` if it is expected.

### Run in development
```bash
npm run dev
```
Starts the Express server together with the Vite dev server (with hot reload) on a single port.

### Build and run in production
```bash
npm run build
npm run start
```

---

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `OPENAI_API_KEY` | For OpenAI | OpenAI API key. |
| `OLLAMA_API_URL` | No | Ollama server endpoint. Defaults to `http://localhost:11434` and is also persisted in the database. |
| `AZURE_LLM_API_URL` | For Azure VM | Endpoint of an Azure-hosted chat model, if used. Defaults to `http://localhost:5000/chat`. |
| `OLLAMA_SMALL_MODEL` | No | Pin the extraction model (blank = auto-select). |
| `OLLAMA_LARGE_MODEL` | No | Pin the synthesize/audit model (blank = auto-select). |
| `LONG_NOTE_CHARACTER_THRESHOLD` | No | Input length (chars) that auto-triggers the long-note pipeline. Default `12000`. |
| `PIPELINE_MAX_RUN_MINUTES` | No | Overall wall-clock cap for a pipeline run. Default `45`. |

Azure OpenAI, when used, is configured through its own endpoint/credentials in the app.

---

## Project structure

```
client/          React + Vite frontend
  public/mupdf/  MuPDF WebAssembly assets (browser-side OCR rendering)
  src/           Components, pages, hooks
server/          Express backend
  index.ts       Server entry
  routes.ts      API endpoints (chat, OCR, pipeline, prompts, config)
  pipeline.ts    Long-note pipeline (model selection, generate calls, retries)
  storage.ts     Database access layer (Drizzle)
shared/
  schema.ts      Drizzle schema + Zod types (source of truth for data models)
```

---

## Key API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/ollama/generate` | One-shot / streaming Ollama chat completion. |
| `POST` | `/api/ollama/ocr-page` | OCR a single rendered page image (streamed). |
| `POST` | `/api/ollama/pipeline-step` | Run one long-note pipeline step (`split` / `warm` / `extract` / `synthesize` / `audit`). |
| `GET` | `/api/ollama/pipeline-config` | Effective pipeline config (threshold, cap, selected models). |
| `GET` | `/api/ollama/models` | List installed Ollama models. |
| `GET`/`POST` | `/api/ollama/config` | Read / update the Ollama server URL. |

---

## Reliability notes

The Ollama server is fronted by a Cloudflare-style proxy that returns **HTTP 524 whenever the origin is silent for ~100–125 seconds**, and the deployment platform kills any single request at ~300 seconds. The app is engineered around both limits:

- **Thinking disabled** (`think: false`) on every generate call. Thinking-capable models entered a hidden reasoning phase that emitted no output for 125s+, tripping the 524 — disabling it makes note synthesis first-token in ~1s.
- **Per-step requests** so no single call approaches the 300s kill.
- **Keep-alive + a warm step** to keep the large model loaded off the critical path.
- **Streaming with heartbeats** so the connection is never silent long enough to 524.
- **Prompt slimming** before synthesis to shorten the model's silent prompt-evaluation window.
- **Automatic retries** for transient upstream outages and killed steps.

---

## License

No license specified. All rights reserved by the repository owner unless a license file is added.
