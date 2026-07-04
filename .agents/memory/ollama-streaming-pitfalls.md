---
name: Ollama streaming pitfalls
description: axios AbortSignal breaks responseType:"stream"; aborted requests leave zombie generations queued behind the Cloudflare-style proxy, causing misleading 524s.
---

# Ollama streaming pitfalls

## Rule 1: never pass `signal` to axios with `responseType: "stream"`
**Why:** With axios 1.x, combining an AbortSignal with a streaming response delayed response headers (2s → 29s) and then stalled the stream with no data at all. Verified with side-by-side standalone tests against the same Ollama endpoint.
**How to apply:** For streaming axios calls, omit `signal` from the request config. Honor cancellation manually: check `signal.aborted` before/after the call and add an `abort` listener that destroys the response stream.

## Rule 2: proxy error responses (524) can keep the body stream open forever
**Why:** When the Cloudflare-style proxy in front of Ollama returns an error status like 524, it may never end the response body. An error-body read that awaits stream `end` with no timeout hangs the whole call permanently — no retry fires, and the user sees an endless spinner. Observed directly in dev: `stream_open status=524` logged, then total silence for minutes.
**How to apply:** Any read of an error-response body from a proxied streaming endpoint must be bounded by a short timeout (a few seconds) that destroys the stream and proceeds with whatever detail was collected. Also listen for `close`, not just `end`/`error`.

## Rule 3: Ollama sends ZERO bytes until model load + prompt eval finish
**Why:** Even with `stream: true`, the first byte from `/api/generate` arrives only after the model is loaded AND the whole prompt is evaluated. Behind a ~100s-silence proxy, a cold large model plus a long prompt reliably 524s (production runs died at ~125s twice). Streaming heartbeats can't help — they only start after the first token. CRITICAL corollary: pre-warming the model only removes the LOAD time; a long-enough prompt still 524s on prompt-EVAL time alone, especially on a slow/loaded shared server (measured ~20-30s time-to-first-byte for even a 3-token generate). The heartbeat we write to the CLIENT keeps client↔server alive but does nothing for the server↔Ollama hop, which is where the 524 happens.
**How to apply:** Three levers, use together: (1) pre-warm the model with a tiny generate (`num_predict: 1`) at the SAME `num_ctx` the real call will use (a ctx change reloads the runner) and send `keep_alive` (e.g. "30m") on every call — kills LOAD time; (2) shrink the PROMPT so eval fits the window — e.g. drop fields the target step doesn't need (for the note-pipeline synthesize we strip the audit-only `source_quote`, ~47% smaller); (3) retry the call in a fresh HTTP request — after a cut attempt the model is loaded and Ollama's prompt-prefix KV cache may make the retry's eval fast. Levers 1+3 alone are NOT enough for long prompts; lever 2 (prompt size) is the one that scales with note length.

## Rule 4: killed clients leave zombie generations at Ollama behind a proxy
**Why:** The Ollama server sits behind a Cloudflare-style proxy. When a client (curl test, browser, or the Express server) disconnects, the origin generation keeps running to completion. Tests aborted mid-run with `num_predict` 16384 on a thinking model each grind for many minutes; new requests queue behind them and the proxy returns HTTP 524 for anything silent >~100s. During one debugging session this produced hours of misleading "stalls" that looked like code bugs but were purely queue backlog — identical requests failed or succeeded depending only on queue state.
**How to apply:** When pipeline/OCR calls suddenly stall or 524 in dev, first probe the queue: send a tiny generate (`num_predict: 3`) and check time-to-first-byte. If TTFB is many seconds, the queue is backed up — wait for it to drain instead of chasing code bugs. Keep test `num_predict` small. Also note server-side automatic retries on 524 can amplify the backlog.
