---
name: Deployment request-duration limit (~300s)
description: The autoscale deployment edge proxy hard-kills any single HTTP request at ~5 minutes, even if the response is actively streaming heartbeats.
---

# Deployment request-duration limit

**Rule:** On this app's autoscale deployment, the edge proxy terminates any single HTTP request at ~300 seconds (5 minutes) of total duration. Streaming output or heartbeat bytes do NOT extend this — heartbeats only prevent the separate ~100s silent-response 524 timeout.

**Why:** A production long-note pipeline run was cancelled at exactly 299,996ms despite streaming NDJSON heartbeats every 15s, finishing "successfully" from the client's view but without producing a note.

**How to apply:** Any server work that can exceed ~4–5 minutes must be split into multiple short requests, with the client orchestrating steps and carrying intermediate state (see the long-note pipeline's `/api/ollama/pipeline-step` design). Heartbeats are still needed within each request to avoid the ~100s 524 cutoff. This is the duration counterpart of the request-size limit (see deployment-request-size-limit.md).
