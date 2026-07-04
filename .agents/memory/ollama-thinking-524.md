---
name: Ollama thinking-phase silent 524
description: Why thinking-capable Ollama models silently stall behind a proxy, and to disable thinking on non-interactive pipeline calls.
---

# Thinking-capable Ollama models cause silent 524s behind a proxy

**Rule:** For any non-interactive / batch Ollama `/api/generate` call that runs behind a
silence-timeout proxy (Cloudflare-style ~100-125s), send `think: false`. Do not rely on
"the model streams thinking chunks so the connection stays alive" — it may not.

**Why:** A thinking-capable model (observed with `gemma4:12B`) fed a prompt that invites
reasoning ("Before writing, *silently* merge and deduplicate… before writing") can enter a
hidden reasoning phase that emits **zero bytes for 125s+** before the first token — not
streamed as thinking chunks, just silence. That silent window trips the proxy's silent-response
524 limit. This masqueraded as many other bugs (model load time, num_ctx reload, prompt size,
HTTP keep-alive/stale-socket reuse, the axios library) — all of which were ruled out.

**How to diagnose (the trick that isolated it):** the same-*size* generic prompt was always
fast (2-8s) in standalone curl/node, so the bug only reproduced through the real app with the
real prompt. The decisive test: send the **exact** production prompt raw to Ollama twice —
once with thinking default/on, once with `think:false`. Thinking on = silent 125s / 0 tokens;
`think:false` = first token ~2.7s, done ~7s. Also: firing a raw curl to the same model *while*
the app's request is stalled returns HTTP 000 (queued/blocked) — proof the model slot is
occupied by a silent generation, not a client/socket problem.

**How to apply:** disable thinking at the single shared generate call site so every step
(extract/warm/synthesize/audit/repair) is covered, rather than per-step.
