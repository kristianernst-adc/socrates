---
name: capture-sessions
description: Capture coding agent sessions from disk into a normalised event log so they can be reviewed or turned into learning material. Use when the user says to capture or record this session, asks to learn from work already done, wants to review what happened in a past session, or before generating learning cards. Keywords - capture, record, session, transcript, ingest, history, "learn from this", "what did we do", review session.
license: MIT
metadata:
  version: "0.1.0"
  component: capture
---

# Capture sessions

Puts a session on disk in a shape the rest of the plugin can read. Three steps,
no decisions.

Capture is deterministic. No model is involved, so it is cheap, repeatable, and
safe to run on a schedule. Deciding what is *interesting* happens later, in
`generate-learning`.

## Steps

1. **Capture.**

   ```bash
   socrates capture --current     # the session you are in right now
   socrates capture               # sync everything found on disk
   socrates capture --file ~/.claude/projects/<slug>/<id>.jsonl
   ```

   Bare `capture` scans the known locations for Pi, Claude Code and Codex, and
   skips any file whose size and mtime have not changed. It is cheap to re-run.

   Every event file is rewritten wholesale when its source changes, because
   session transcripts are append-only.

2. **Find the session.**

   ```bash
   socrates capture list
   ```

   Prints each captured session with its harness, timestamp, working directory
   and event count.

3. **Read it.**

   ```bash
   socrates capture show <session-id>          # readable digest
   socrates capture show <session-id> --format json   # every event
   ```

   The digest shows user turns verbatim, assistant turns trimmed, and tool calls
   as one line each with their command. That is usually enough to spot what the
   user did not understand.

4. **Hand off.** If the user wants to learn from it, pass the digest to the
   `generate-learning` skill. Capture only records; it does not decide.

## What gets captured

Normalised, harness-agnostic, one event per line:

| Field | Meaning |
| --- | --- |
| `kind` | `message` or `tool` |
| `role` | `user` or `assistant` (messages) |
| `text` | message text |
| `tool`, `input`, `output`, `isError` | tool calls, with their result folded in |
| `ts`, `seq`, `harness`, `sessionId`, `cwd` | provenance |

Stored at `<data root>/events/<harness>/<session-id>.jsonl`.

Deliberately dropped: thinking blocks, Codex `developer` boilerplate, Claude Code
sidechains, image payloads, and tool output past ~2000 characters. They add bulk
without carrying the moment that matters.

## Guardrails

- **Capture is not a background habit by default.** Do not sync a user's whole
  history because it seemed useful. Do it when asked, or when a schedule has
  been explicitly set up.
- **Sessions contain secrets, client names and credentials.** They are stored in
  plain text on the user's own machine and must never leave it. Nothing in this
  plugin sends a session anywhere.
- **Never put session content into a card verbatim without reading it.** Redact
  credentials as `REDACTED` rather than dropping the surrounding code.
- **A broken adapter is expected, not an emergency.** These transcript formats
  are internal to their tools and change without notice. `capture` reports the
  files it failed on; fix the adapter in `lib/capture.mjs`.
