---
name: OCR vision model repetition loops
description: Why DeepSeek-OCR (and similar vision models) spew repeated/incrementing garbage, and how it's mitigated.
---

# Vision/OCR models can degenerate into repetition loops

On dense pages, DeepSeek-OCR (run via Ollama `/api/generate`) can fall into a
repetition loop: it emits the same phrase thousands of times, sometimes with an
incrementing number ("copy as an original 217 / 218 / 219 ...") or drifting into
another language. This is a **model generation** issue, not a network/proxy one —
the streaming pipeline is faithfully relaying the model's runaway output.

**Why:** greedy decoding with no repetition penalty and no length cap lets the
model loop forever. The incrementing number makes each line look "new" so the
model thinks it is making progress.

**How to mitigate (both layers, belt-and-suspenders):**
- Ollama request `options`: `repeat_penalty` (~1.2) + `repeat_last_n` to discourage
  loops, and `num_predict` (hard token cap, e.g. 8192) so generation ALWAYS
  terminates even if a loop starts.
- Server-side guard on the streamed text: normalize each line (strip digits/
  whitespace) and stop the page early when the same normalized line repeats past a
  threshold (~60). This catches incrementing-number loops that a plain repeat
  penalty may not break, and stops fast instead of waiting for the token cap.
