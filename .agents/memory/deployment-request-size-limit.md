---
name: Deployment request-size limit (HTTP 413)
description: Why large file uploads fail in production but work in dev, and how to fix it.
---

# Autoscale deployments cap request bodies at the edge proxy

Replit **autoscale** deployments reject request bodies larger than ~32MB with
**HTTP 413** at the edge proxy — *before* the request ever reaches the Express
app. Raising the app/multer body limit does nothing because the app never sees
the request. This only shows up in the deployed app, not in dev.

**Why:** the deployment platform (autoscale, multi-instance) enforces a hard
request-size cap at its proxy. `deploymentTarget = "autoscale"` lives in `.replit`.

**How to apply:** never rely on a single large upload in production. Either
(a) render/split the payload in the browser and send small per-item requests, or
(b) chunk the upload. Per-request client-side approach is preferred on autoscale
because instances are stateless — server-side reassembly across requests is
unreliable (chunks can hit different instances).

## MuPDF runs in the browser too
The `mupdf` npm package ships a non-threaded **WebAssembly** build that works in
the browser (no SharedArrayBuffer / COOP-COEP headers needed). To use it under
Vite without editing `vite.config.ts`: copy `dist/{mupdf.js, mupdf-wasm.js,
mupdf-wasm.wasm}` into `client/public/mupdf/` and load at runtime with a
non-literal dynamic import + `/* @vite-ignore */` (`import('/mupdf/mupdf.js')`).
The wasm is located relative to `import.meta.url`, so serving all three from the
same `/mupdf/` path just works in dev and in the production build.

## Also watch for response-time timeouts (HTTP 524)
The same edge proxy kills a request that stays **silent too long** (~100s) with
**HTTP 524** — independent of body size. A slow per-item request (e.g. one OCR
page on a heavy vision model) can trip this even after smaller items succeeded.

**Fix:** stream the response so bytes flow continuously. Forward upstream tokens
as newline-delimited JSON and emit a periodic heartbeat (a bare `\n` the client
ignores) while waiting for the first token. Buffer upstream output and forward
only **complete** lines so heartbeats never split a JSON line. Send the first
byte immediately (status + a newline) so the proxy sees a live origin right away.
