// Session capture.
//
// Deliberately small. Three adapters, one flat event shape, no cleverness.
//
// The rule from design.md: harness knowledge stops here. Nothing downstream
// should ever see a harness-native record. Transcript formats are internal to
// their tools and change without notice, so each adapter is disposable — if one
// breaks, rewrite it in an afternoon and nothing else moves.
//
// Capture is deterministic. No model is involved in getting a session onto
// disk; interpretation happens later, in the generate-learning skill.
//
// Loading is incremental in two steps:
//   1. A file whose size and mtime are unchanged is skipped entirely.
//   2. A file that grew is read from the last consumed byte offset, and only the
//      new events are appended to the output. A 50MB rollout that gains one line
//      costs one line.
//
// Session transcripts are append-only, which is what makes (2) safe.

import { StringDecoder } from "node:string_decoder";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { paths } from "./store.mjs";

const MAX_TEXT = 4_000;
const MAX_OUTPUT = 2_000;
// Only a sanity valve. The full read streams, so cost scales with the number of
// events rather than the size of the file.
const MAX_FILE = Number(process.env.SOCRATES_MAX_SESSION_BYTES ?? 4 * 1024 * 1024 * 1024);
const BLOCK = 8 * 1024 * 1024;
// An unresolved tool call is held back in case its result is still coming. If the
// session has been quiet this long, stop waiting and write it as-is.
const SETTLE_MS = Number(process.env.SOCRATES_SETTLE_MS ?? 60_000);

const clamp = (value, max) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
};

const blockText = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block?.type === "text" || block?.type === "input_text" || block?.type === "output_text") {
        return block.text ?? "";
      }
      if (block?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

// Where each harness keeps transcripts. Configurable, because people move
// these and because the EU/hosted variants differ.
export function defaultSources() {
  const home = homedir();
  return [
    { harness: "pi", dir: process.env.PI_SESSION_DIR ?? join(home, ".pi", "agent", "sessions") },
    // subagents/ holds per-subagent transcripts. They are the same noise as
    // isSidechain records, just in their own files.
    { harness: "claude-code", dir: join(home, ".claude", "projects"), skip: /[/\\]subagents[/\\]/ },
    {
      harness: "codex",
      dirs: [join(home, ".codex", "sessions"), join(home, ".codex", "archived_sessions")],
    },
  ];
}

// ---------------------------------------------------------------------------
// adapters
//
// Each takes already-split lines so the same code serves a full read and a
// delta read. `prior` carries the session meta and sequence position forward
// when the header line is not part of the delta.
// ---------------------------------------------------------------------------

function readPi(lines, prior = null, startSeq = 0) {
  const events = [];
  let meta = prior;
  let seq = startSeq;

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "session") {
      meta = {
        // id is the source-file identity; sessionId is the logical session. For
        // Pi they are the same, but Codex splits a session across rollout files.
        id: entry.id,
        sessionId: entry.id,
        ts: entry.timestamp,
        cwd: entry.cwd,
        harness: "pi",
        version: entry.version,
      };
      continue;
    }
    if (entry.type !== "message") continue;

    const message = entry.message ?? {};
    const base = {
      type: "event",
      ts: message.timestamp ? new Date(message.timestamp).toISOString() : entry.timestamp,
      harness: "pi",
    };

    if (message.role === "user") {
      const text = blockText(message.content);
      if (text.trim()) events.push({ ...base, seq: seq++, kind: "message", role: "user", text: clamp(text, MAX_TEXT) });
      continue;
    }

    if (message.role === "assistant") {
      const text = blockText(message.content);
      if (text.trim()) {
        events.push({
          ...base, seq: seq++,
          kind: "message",
          role: "assistant",
          text: clamp(text, MAX_TEXT),
          model: message.model,
          provider: message.provider,
        });
      }
      for (const block of message.content ?? []) {
        if (block?.type !== "toolCall") continue;
        events.push({
          ...base, seq: seq++,
          kind: "tool",
          tool: block.name,
          input: block.arguments ?? {},
          toolUseId: block.id,
        });
      }
      continue;
    }

    if (message.role === "toolResult") {
      events.push({
        ...base, seq: seq++,
        kind: "tool_result",
        tool: message.toolName,
        output: clamp(blockText(message.content), MAX_OUTPUT),
        isError: Boolean(message.isError),
        toolUseId: message.toolCallId,
      });
    }
  }

  return { meta, events };
}

function readClaudeCode(lines, prior = null, startSeq = 0) {
  const events = [];
  let meta = prior;
  let seq = startSeq;

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;

    // Sidechains are subagent transcripts interleaved into the same file.
    // Keep them out: they double the volume and rarely carry the moment.
    if (entry.isSidechain) continue;

    meta ??= {
      id: entry.sessionId,
      sessionId: entry.sessionId,
      ts: entry.timestamp,
      cwd: entry.cwd,
      gitBranch: entry.gitBranch,
      harness: "claude-code",
      version: entry.version,
    };

    const message = entry.message ?? {};
    const base = {
      type: "event",
      ts: entry.timestamp,
      harness: "claude-code",
      sessionId: meta.sessionId,
    };

    const text = blockText(message.content);
    if (text.trim()) {
      events.push({
        ...base, seq: seq++,
        kind: "message",
        role: entry.type === "user" ? "user" : "assistant",
        text: clamp(text, MAX_TEXT),
        model: message.model,
      });
    }

    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === "tool_use") {
        events.push({
          ...base, seq: seq++,
          kind: "tool",
          tool: block.name,
          input: block.input ?? {},
          toolUseId: block.id,
        });
      } else if (block?.type === "tool_result") {
        events.push({
          ...base, seq: seq++,
          kind: "tool_result",
          output: clamp(blockText(block.content), MAX_OUTPUT),
          isError: Boolean(block.is_error),
          toolUseId: block.tool_use_id,
        });
      }
    }
  }

  return { meta, events };
}

function readCodex(lines, prior = null, startSeq = 0) {
  const events = [];
  let meta = prior;
  let seq = startSeq;

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "session_meta") {
      // Codex writes one rollout file per resume, all sharing session_id. The
      // rollout's own `id` is what makes a file unique, so that is the storage
      // key; session_id stays for grouping a resumed conversation.
      meta = {
        id: entry.payload?.id ?? entry.payload?.session_id,
        sessionId: entry.payload?.session_id,
        ts: entry.payload?.timestamp ?? entry.timestamp,
        cwd: entry.payload?.cwd,
        harness: "codex",
        model: entry.payload?.model,
        version: entry.payload?.cli_version,
      };
      continue;
    }
    if (entry.type !== "response_item") continue;

    const payload = entry.payload ?? {};
    const base = {
      type: "event",
      ts: entry.timestamp,
      harness: "codex",
      sessionId: meta?.sessionId,
    };

    switch (payload.type) {
      case "message": {
        // "developer" carries sandbox and app boilerplate. Never useful.
        if (payload.role !== "user" && payload.role !== "assistant") continue;
        const text = blockText(payload.content);
        if (!text.trim()) continue;
        events.push({ ...base, seq: seq++, kind: "message", role: payload.role, text: clamp(text, MAX_TEXT) });
        break;
      }
      case "function_call":
      case "custom_tool_call": {
        let input = payload.arguments ?? payload.input ?? {};
        if (typeof input === "string") {
          try {
            input = JSON.parse(input);
          } catch {
            input = { raw: input };
          }
        }
        events.push({ ...base, seq: seq++, kind: "tool", tool: payload.name, input, toolUseId: payload.call_id });
        break;
      }
      case "function_call_output":
      case "custom_tool_call_output": {
        events.push({
          ...base, seq: seq++,
          kind: "tool_result",
          output: clamp(payload.output, MAX_OUTPUT),
          toolUseId: payload.call_id,
        });
        break;
      }
      default:
        break; // reasoning, web_search, etc. — not needed for learning
    }
  }

  return { meta, events };
}

const ADAPTERS = { pi: readPi, "claude-code": readClaudeCode, codex: readCodex };

/** Read just enough of a file to identify the harness. */
export function detectHarness(file, hint) {
  if (hint && ADAPTERS[hint]) return hint;
  const head = readChunk(file, 0, 64 * 1024).toString("utf8").split("\n").find((l) => l.trim());
  if (!head) return null;
  try {
    const entry = JSON.parse(head);
    if (entry.type === "session") return "pi";
    if (entry.type === "session_meta" || entry.type === "response_item") return "codex";
    if (entry.sessionId && (entry.uuid || entry.parentUuid)) return "claude-code";
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// normalise
// ---------------------------------------------------------------------------

/** Fold tool_result events into the tool event that produced them. */
function joinToolResults(events) {
  const byId = new Map();
  for (const event of events) {
    if (event.kind === "tool" && event.toolUseId && !byId.has(event.toolUseId)) {
      byId.set(event.toolUseId, event);
    }
  }
  const out = [];
  for (const event of events) {
    if (event.kind === "tool_result") {
      const tool = event.toolUseId ? byId.get(event.toolUseId) : undefined;
      if (tool) {
        tool.output = event.output;
        tool.isError = event.isError;
        continue;
      }
      // Orphan result (usually a subagent call). Keep it as its own event.
      out.push({ ...event, kind: "tool", tool: event.tool ?? "unknown" });
      continue;
    }
    out.push(event);
  }
  return out;
}

/**
 * A trailing tool call with no result yet is held back rather than written, so
 * that its result can still be folded in when the next chunk arrives. Without
 * this, appending would produce a tool event and a separate orphan result.
 */
function splitTrailingUnresolved(events) {
  let cut = events.length;
  while (cut > 0 && events[cut - 1].kind === "tool" && events[cut - 1].output === undefined) {
    cut -= 1;
  }
  return [events.slice(0, cut), events.slice(cut)];
}

// ---------------------------------------------------------------------------
// byte-level reads
// ---------------------------------------------------------------------------

function readChunk(file, offset, length) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const read = readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/**
 * Stream a whole file as line batches. Never materialises the file as one
 * string, which is what used to cap us at the V8 string limit (~512MB) and made
 * the largest Codex rollouts uncapturable.
 */
function* readLineBlocks(file) {
  const { size } = statSync(file);
  const decoder = new StringDecoder("utf8");
  const fd = openSync(file, "r");
  try {
    let offset = 0;
    let carry = "";
    while (offset < size) {
      const length = Math.min(BLOCK, size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const read = readSync(fd, buffer, 0, length, offset);
      if (read <= 0) break;
      offset += read;
      // StringDecoder holds back a partial multi-byte character at the seam.
      const text = carry + decoder.write(buffer.subarray(0, read));
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      yield lines;
    }
    const tail = carry + decoder.end();
    if (tail) yield [tail];
  } finally {
    closeSync(fd);
  }
}

/**
 * Read from `offset` to the last complete line. A partial trailing line is left
 * for next time — a session file is being written while we read it.
 */
function readDelta(file, offset) {
  const { size } = statSync(file);
  if (size <= offset) return null; // truncated or rewritten → caller does a full read
  const chunk = readChunk(file, offset, size - offset);
  const newline = chunk.lastIndexOf(0x0a);
  if (newline === -1) return { lines: [], consumed: offset };
  return {
    lines: chunk.subarray(0, newline).toString("utf8").split("\n"),
    consumed: offset + newline + 1,
  };
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

function walk(dir, out = [], depth = 0) {
  if (depth > 4 || !existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, depth + 1);
    else if (entry.name.endsWith(".jsonl") && !entry.name.endsWith(".tmp")) out.push(full);
  }
  return out;
}

export function discover(sources = defaultSources()) {
  return sources.flatMap((source) =>
    (source.dirs ?? [source.dir]).flatMap((dir) =>
      walk(dir)
        .filter((file) => !source.skip?.test(file))
        .map((file) => ({ harness: source.harness, file })),
    ),
  );
}

const cursorFile = (home) => join(home, "state", "captured.json");
// Bump when the meaning of a cursor entry changes, so stale cursors are ignored
// rather than silently pointing at the wrong output file.
const CURSOR_SCHEMA = 2;

function readCursor(home) {
  const file = cursorFile(home);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || parsed.schema !== CURSOR_SCHEMA || typeof parsed.files !== "object") return {};
    return parsed.files;
  } catch {
    return {};
  }
}

const writeCursor = (home, files) =>
  writeFileSync(cursorFile(home), `${JSON.stringify({ schema: CURSOR_SCHEMA, files }, null, 2)}\n`, "utf8");

export function sessionPath(home, harness, id) {
  return join(home, "events", harness, `${safeName(id)}.jsonl`);
}

/** A session id is not guaranteed to be a filename. Never trust it as one. */
function safeName(id) {
  const base = String(id ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 120);
  return base || "unknown";
}

/** Small stable hash of a path, used only to break a tie between two sources. */
function pathTag(file) {
  let h = 0x811c9dc5;
  for (let i = 0; i < file.length; i += 1) {
    h ^= file.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).slice(0, 6);
}

function writeSessionHeader(file, meta) {
  writeFileSync(file, `${JSON.stringify({ ...meta, type: "session" })}\n`, "utf8");
}

function appendEvents(file, events) {
  if (!events.length) return;
  appendFileSync(file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
}

function captureOne(home, file, hint, cursor, claimed, result, force) {
  const stat = statSync(file);
  const prev = typeof cursor[file] === "object" ? cursor[file] : null;

  if (!force && prev && prev.size === stat.size && prev.mtime === stat.mtimeMs) {
    result.skipped += 1;
    // Once a session has gone quiet, stop holding back its unresolved tail.
    if (prev.pending?.length && Date.now() - stat.mtimeMs > SETTLE_MS) {
      appendEvents(prev.out, prev.pending);
      cursor[file] = { ...prev, pending: [] };
    }
    return;
  }

  if (stat.size > MAX_FILE) {
    result.failed.push({
      file,
      error: `too large to read (${Math.round(stat.size / 1024 / 1024)}MB > ${Math.round(
        MAX_FILE / 1024 / 1024,
      )}MB limit); raise SOCRATES_MAX_SESSION_BYTES or split the session`,
    });
    return;
  }

  const canDelta =
    !force &&
    prev?.harness &&
    prev.out &&
    existsSync(prev.out) &&
    stat.size > prev.offset &&
    prev.offset > 0;

  let harness = prev?.harness ?? hint;
  let deltaMode = false;
  let parsed = null;
  let offset = stat.size;

  if (canDelta) {
    const delta = readDelta(file, prev.offset);
    if (delta) {
      harness = prev.harness;
      deltaMode = true;
      offset = delta.consumed;
      parsed = ADAPTERS[harness](delta.lines, prev.meta, prev.nextSeq ?? 0);
    }
  }

  if (!deltaMode) {
    harness = detectHarness(file, hint);
    if (!harness) {
      cursor[file] = { size: stat.size, mtime: stat.mtimeMs, failed: "unrecognised format" };
      result.failed.push({ file, error: "unrecognised session format" });
      return;
    }
    // Stream in blocks so a very large rollout never becomes one big string.
    const adapter = ADAPTERS[harness];
    const events = [];
    let meta = null;
    let seq = 0;
    for (const lines of readLineBlocks(file)) {
      const chunk = adapter(lines, meta, seq);
      if (chunk.meta) meta = chunk.meta;
      seq += chunk.events.length;
      for (const event of chunk.events) events.push(event);
    }
    parsed = { meta, events };
    offset = stat.size;
  }

  const startSeq = deltaMode ? (prev.nextSeq ?? 0) : 0;
  const meta =
    parsed.meta ?? (deltaMode ? prev.meta : null) ?? { id: file, sessionId: undefined, harness };

  // Carry the unresolved tail forward so a result arriving in a later chunk can
  // still be folded onto its call.
  const carried = deltaMode ? (prev.pending ?? []) : [];
  const [settled, pending] = splitTrailingUnresolved(
    joinToolResults([...carried, ...parsed.events]),
  );

  // Two source files can legitimately claim the same session id — Codex resumes
  // a session into a new rollout that reuses it. Storage is per source file, so
  // the loser of the tie gets a suffix instead of truncating the winner.
  let out;
  if (deltaMode) {
    out = prev.out;
  } else {
    const base = sessionPath(home, harness, meta.id ?? meta.sessionId);
    const owner = claimed.get(base);
    out = !owner || owner === file ? base : base.replace(/\.jsonl$/, `-${pathTag(file)}.jsonl`);
  }
  claimed.set(out, file);
  mkdirSync(join(home, "events", harness), { recursive: true });
  if (deltaMode) {
    appendEvents(out, settled);
  } else if (settled.length) {
    // A file that yields nothing is still cursor-recorded, so it is never read
    // twice, but it does not get an empty stub on disk.
    writeSessionHeader(out, meta);
    appendEvents(out, settled);
  }

  cursor[file] = {
    size: stat.size,
    mtime: stat.mtimeMs,
    offset,
    harness,
    out,
    nextSeq: startSeq + parsed.events.length,
    meta,
    pending,
  };

  result.captured.push({
    harness,
    id: meta.id,
    sessionId: meta.sessionId,
    cwd: meta.cwd,
    events: settled.length,
    total: startSeq + parsed.events.length,
    mode: deltaMode ? "delta" : "full",
    file: out,
  });
  result.events += settled.length;
}

/**
 * Capture sessions.
 *
 *   only     — explicit file list; otherwise every known location is scanned
 *   harness  — hint for --file when the format is not obvious
 *   force    — ignore cursors and re-read from scratch
 */
export function capture({ home, only, harness, force = false, sources } = {}) {
  mkdirSync(join(home, "state"), { recursive: true });

  const cursor = readCursor(home);
  const candidates = only?.length ? only.map((file) => ({ harness, file })) : discover(sources);

  // Which source file currently owns which output file.
  const claimed = new Map();
  for (const [source, entry] of Object.entries(cursor)) {
    if (entry?.out) claimed.set(entry.out, source);
  }

  const result = { captured: [], skipped: 0, failed: [], events: 0 };

  for (const { file, harness: hint } of candidates) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    try {
      captureOne(home, file, hint, cursor, claimed, result, force);
    } catch (error) {
      result.failed.push({ file, error: error.message });
    }
  }

  writeCursor(home, cursor);
  return result;
}

function firstLine(file) {
  return readChunk(file, 0, 8 * 1024).toString("utf8").split("\n")[0];
}

/** Count newlines without materialising the file as a string. */
function countNewlines(file) {
  const { size } = statSync(file);
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(BLOCK);
    let offset = 0;
    let count = 0;
    while (offset < size) {
      const read = readSync(fd, buffer, 0, Math.min(BLOCK, size - offset), offset);
      if (read <= 0) break;
      for (let i = 0; i < read; i += 1) if (buffer[i] === 0x0a) count += 1;
      offset += read;
    }
    return count;
  } finally {
    closeSync(fd);
  }
}

export function listSessions(home) {
  const root = join(home, "events");
  if (!existsSync(root)) return [];
  const out = [];
  for (const harness of readdirSync(root, { withFileTypes: true })) {
    if (!harness.isDirectory()) continue;
    for (const file of readdirSync(join(root, harness.name))) {
      if (!file.endsWith(".jsonl")) continue;
      const full = join(root, harness.name, file);
      let meta = {};
      try {
        meta = JSON.parse(firstLine(full));
      } catch {
        /* keep the empty meta */
      }
      out.push({
        ...meta,
        harness: harness.name,
        events: Math.max(0, countNewlines(full) - 1),
        file: full,
      });
    }
  }
  return out.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1));
}

export function readSession(home, id) {
  for (const session of listSessions(home)) {
    if (
      session.id === id ||
      session.sessionId === id ||
      session.file.endsWith(`${id}.jsonl`)
    ) {
      return readFileSync(session.file, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    }
  }
  return null;
}

/** A compact, readable transcript. This is what an agent reads to find gaps. */
export function digest(events, { maxChars = 24_000 } = {}) {
  const lines = [];
  for (const event of events) {
    if (event.type === "session") {
      lines.push(
        `# ${event.harness} session ${event.sessionId ?? "?"}  ${event.ts ?? ""}  ${event.cwd ?? ""}`,
        "",
      );
      continue;
    }
    const tag = `[${String(event.seq).padStart(3, "0")}]`;
    if (event.kind === "message") {
      lines.push(`${tag} ${event.role === "user" ? "USER" : "ASSISTANT"}: ${clip(event.text, 700)}`);
    } else if (event.kind === "tool") {
      const input = summarizeInput(event.input);
      lines.push(
        `${tag} TOOL ${event.tool ?? "?"}${input ? `: ${input}` : ""}${event.isError ? "  [ERROR]" : ""}`,
      );
      if (event.isError && event.output) lines.push(`${tag}   ↳ ${clip(event.output, 300)}`);
    }
  }
  const text = lines.join("\n");
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n\n…[digest truncated; read the jsonl for the rest]`
    : text;
}

const clip = (text, max) => {
  const value = String(text ?? "").replace(/\s*\n\s*/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

function summarizeInput(input) {
  if (!input || typeof input !== "object") return "";
  for (const key of ["command", "file_path", "path", "pattern", "query", "url", "prompt"]) {
    if (typeof input[key] === "string") return clip(input[key], 160);
  }
  return clip(JSON.stringify(input), 120);
}
