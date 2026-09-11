// Capture: Pi session files -> events.jsonl.
//
// STUB: this is a full rebuild, not an incremental append. Every run re-reads
// every session and rewrites the file from scratch. That is what makes it
// idempotent by construction — no cursors, no byte offsets, no torn-final-line
// handling, nothing to go stale while Pi is still writing.
//
// Ceiling: this stops being reasonable somewhere in the hundreds of MB. That is
// when cursors come back.

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ADAPTER, sessionToEvents } from "./pi.mjs";
import { writeAtomic } from "./store.mjs";

/** Where Pi keeps transcripts, unless something overrides it. */
export function piSessionsDir() {
  return (
    process.env.SOCRATES_PI_SESSIONS?.trim() ||
    join(homedir(), ".pi", "agent", "sessions")
  );
}

/** Every .jsonl under a directory, recursively. Missing directory is not an error. */
export function findSessions(dir) {
  try {
    return readdirSync(dir, { recursive: true })
      .filter((name) => String(name).endsWith(".jsonl"))
      .map((name) => join(dir, String(name)))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Rebuild the event store from every session under `dir`.
 *
 * Sessions are processed in path order and events in transcript order, so the
 * output is deterministic: same input, byte-identical file. Nothing is globally
 * sorted by timestamp — conversation order is the thing worth preserving.
 */
export function capture({ dir = piSessionsDir(), eventsFile, dryRun = false } = {}) {
  const files = findSessions(dir);
  const sessions = files.map((file) => sessionToEvents(file));
  const events = sessions.flatMap((session) => session.events);

  if (!dryRun && eventsFile) {
    const body = events.map((event) => JSON.stringify(event)).join("\n");
    writeAtomic(eventsFile, events.length ? `${body}\n` : "");
  }

  return {
    adapter: `${ADAPTER.name}@${ADAPTER.version}`,
    dir,
    eventsFile: eventsFile ?? null,
    sessions: sessions.length,
    events: events.length,
    // Per-session counts, so a session that produced nothing is visible rather
    // than silently absent.
    files: sessions.map((session) => ({
      file: session.file,
      sessionId: session.sessionId,
      cwd: session.cwd,
      events: session.events.length,
    })),
  };
}
