---
name: Workflow auto-restart kills in-flight tests
description: Editing project files auto-restarts the dev workflow, aborting any long-running server request being tested.
---

**Rule:** Never edit project files while a long-running server request (e.g. a multi-minute streaming pipeline test) is in flight — the platform auto-restarts the workflow on edits, killing the request mid-run.

**Why:** An end-to-end pipeline test died with "TypeError: terminated" because a docs edit made during the run triggered a workflow restart. Also, hard restarts skip `finally` cleanup, so temp run folders can be left behind (startup stale-purge covers this).

**How to apply:** Do all edits first, then run long tests. For multi-minute streaming requests, drive them from the persistent code_execution notebook (background bash processes are killed when the shell exits) and poll the stored result between calls.
