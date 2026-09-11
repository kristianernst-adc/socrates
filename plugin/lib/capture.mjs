// Session capture.
//
// The only place in the plugin that knows a harness exists. Everything
// downstream sees events and never transcript records.
//
// Event shape and validation live in model.mjs; this file turns transcripts into
// that shape, incrementally:
//
//   1. A file whose size and mtime are unchanged is skipped entirely.
//   2. A file that grew is read from the last consumed byte offset, and only the
//      new events are appended. A 51MB rollout that gains one line costs one line.
//
// Transcripts are append-only, which is what makes (2) safe. A partial trailing
// line is left for next time, because the file is being written while we read it.
//
// A tool call and its result are separate events, so nothing has to be held back
// waiting for a result that may arrive in a later chunk.

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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { basename, join } from "node:path";
import { homedir } from "node:os";

import { normalizeEvent } from "./model.mjs";
import { eventId, paths } from "./store.mjs";

export const ADAPTER_VERSION = 1;
const BLOCK = 8 * 1024 * 1024;
// Only a sanity valve. Full reads stream, so cost scales with the number of
// events rather than the size of the file.
const MAX_FILE = Number(process.env.SOCRATES_MAX_SESSION_BYTES ?? 4 * 1024 * 1024 * 1024);

const clamp = (value, max = 4000) => {
  const s = typeof value === "string" ? value : "";
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s;
};

/** Text of a content value: a plain string, or an array of typed blocks. */
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

const blocksOf = (content) =>
  typeof content === "string"
    ? [{ type: "text", text: content }]
    : Array.isArray(content)
      ? content
      : [];

/** Where to put transcripts, and how to recognise one. */
export function defaultSources() {
  const home = homedir();
  return [
    { adapter: "pi", dir: process.env.PI_SESSION_DIR ?? join(home, ".pi", "agent", "sessions") },
    // subagents/ holds per-subagent transcripts: the same noise as isSidechain
    // records, just in their own files.
    { adapter: "claude-code", dir: join(home, ".claude", "projects"), skip: /[/\\]subagents[/\\]/ },
    {
      adapter: "codex",
      dirs: [join(home, ".codex", "sessions"), join(home, ".codex", "archived_sessions")],
    },
  ];
}

// ---------------------------------------------------------------------------
// adapters
//
// scan(rows, state) mutates state:
//   { context, fresh, seq, events }
// Each row is { line, entry }. context.id identifies the source file; context.session
// identifies the logical session, which Codex spreads across several files.
// ---------------------------------------------------------------------------

function makePush(state, adapter) {
  return function push(kind, fields = {}) {
    state.seq += 1;
    state.events.push(
      normalizeEvent({
        session: state.context.session,
        seq: state.seq,
        ts: fields.ts ?? state.context.ts,
        kind,
        actor: fields.actor ?? "system",
        text: fields.text ?? "",
        tool: fields.tool ?? null,
        result: fields.result ?? null,
        model: fields.model ?? null,
        source: {
          adapter,
          adapterVersion: ADAPTER_VERSION,
          file: state.file,
          line: fields.line ?? 0,
          entryId: fields.entryId ?? "x",
          blockIndex: fields.blockIndex ?? 0,
          parentId: fields.parentId ?? null,
        },
        context: { cwd: state.context.cwd ?? "", repo: null },
      }),
    );
  };
}

/** Pi and Claude Code share a message shape: role plus typed content blocks. */
function pushMessageBlocks(push, message, row, isAssistant) {
  const actor = isAssistant ? "assistant" : "user";
  blocksOf(message.content).forEach((block, blockIndex) => {
    // The line number is a last-resort identity: it is unique and stable within a
    // file, so a transcript with no usable entry id still produces distinct event
    // ids. Collapsing them silently would make evidence meaningless.
    const base = { line: row.line, entryId: row.entryId ?? `line${row.line}`, blockIndex };
    if (block?.type === "text") {
      push(isAssistant ? "assistant_message" : "user_message", {
        ...base,
        actor,
        text: clamp(block.text),
      });
    } else if (block?.type === "thinking") {
      push("assistant_thinking", { ...base, actor, text: clamp(block.thinking) });
    } else if (block?.type === "toolCall" && isAssistant) {
      push("tool_call", {
        ...base,
        actor,
        tool: { name: block.name, callId: block.id, args: block.arguments ?? {} },
      });
    }
  });
}

const pi = {
  name: "pi",
  detect: (first) => first?.type === "session",
  scan(rows, state) {
    const push = makePush(state, "pi");
    for (const { line, entry } of rows) {
      const base = { line, entryId: entry.id ?? "x", parentId: entry.parentId ?? null };
      switch (entry.type) {
        case "session":
          state.context = {
            id: entry.id,
            session: entry.id,
            cwd: entry.cwd ?? "",
            ts: entry.timestamp,
          };
          push("session_start", { ...base, ts: entry.timestamp, text: entry.cwd ?? "" });
          break;
        case "model_change":
          push("model_change", {
            ...base,
            ts: entry.timestamp,
            model: { provider: entry.provider, id: entry.modelId },
          });
          break;
        case "thinking_level_change":
          push("thinking_level_change", {
            ...base,
            ts: entry.timestamp,
            text: entry.thinkingLevel ?? "",
          });
          break;
        case "session_info":
          push("label", { ...base, ts: entry.timestamp, text: entry.name ?? "" });
          break;
        case "custom_message":
          push("annotation", {
            ...base,
            ts: entry.timestamp,
            text: clamp(typeof entry.content === "string" ? entry.content : textOf(entry.content)),
          });
          break;
        case "message": {
          const message = entry.message ?? {};
          if (message.role === "user" || message.role === "assistant") {
            pushMessageBlocks(push, message, base, message.role === "assistant");
          } else if (message.role === "toolResult") {
            push("tool_result", {
              ...base,
              ts: entry.timestamp,
              actor: "tool",
              text: clamp(textOf(message.content)),
              tool: { name: message.toolName ?? "", callId: message.toolCallId ?? null },
              result: { ok: !message.isError },
            });
          }
          break;
        }
        default:
          break; // custom state blobs and unmodelled entries: skipped, not guessed
      }
    }
  },
};

const claudeCode = {
  name: "claude-code",
  detect: (first) => Boolean(first?.sessionId && (first.uuid || first.parentUuid)),
  scan(rows, state) {
    const push = makePush(state, "claude-code");
    for (const { line, entry } of rows) {
      if (entry.type !== "user" && entry.type !== "assistant") continue;
      // Subagent transcripts are interleaved into the same file. They double the
      // volume and rarely carry the moment that matters.
      if (entry.isSidechain) continue;

      // There is no header record, so the session starts at the first real entry
      // and only on a fresh read.
      if (state.fresh && state.context?.id !== entry.sessionId) {
        state.context = {
          id: entry.sessionId,
          session: entry.sessionId,
          cwd: entry.cwd ?? "",
          ts: entry.timestamp,
        };
        push("session_start", {
          line,
          entryId: entry.uuid ?? "x",
          ts: entry.timestamp,
          text: entry.cwd ?? "",
        });
      }

      const message = entry.message ?? {};
      const base = { line, entryId: entry.uuid ?? "x" };
      const isAssistant = entry.type === "assistant";
      pushMessageBlocks(push, message, base, isAssistant);

      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type === "tool_use" && isAssistant) {
          push("tool_call", {
            ...base,
            ts: entry.timestamp,
            actor: "assistant",
            tool: { name: block.name, callId: block.id, args: block.input ?? {} },
          });
        } else if (block?.type === "tool_result") {
          push("tool_result", {
            ...base,
            ts: entry.timestamp,
            actor: "tool",
            text: clamp(textOf(block.content)),
            tool: { name: "", callId: block.tool_use_id ?? null },
            result: { ok: !block.is_error },
          });
        }
      }
    }
  },
};

const codex = {
  name: "codex",
  detect: (first) => first?.type === "session_meta" || first?.type === "response_item",
  scan(rows, state) {
    const push = makePush(state, "codex");
    for (const { line, entry } of rows) {
      const base = { line, entryId: entry.ordinal ?? "x" };

      if (entry.type === "session_meta") {
        // Codex writes one rollout file per resume, all sharing session_id. The
        // rollout's own `id` is what makes a file unique, so that is the storage
        // key; session_id stays for grouping a resumed conversation.
        const p = entry.payload ?? {};
        state.context = {
          id: p.id ?? p.session_id,
          session: p.session_id,
          cwd: p.cwd ?? "",
          ts: entry.timestamp,
        };
        push("session_start", { ...base, ts: entry.timestamp, text: p.cwd ?? "" });
        continue;
      }
      if (entry.type === "compacted") {
        push("compaction", { ...base, ts: entry.timestamp });
        continue;
      }
      if (entry.type !== "response_item") continue;

      const p = entry.payload ?? {};
      const payload = { ...base, ts: entry.timestamp };

      switch (p.type) {
        case "message": {
          // "developer" carries sandbox and app boilerplate. Never useful.
          if (p.role !== "user" && p.role !== "assistant") continue;
          const body = textOf(p.content);
          if (!body.trim()) continue;
          push(p.role === "user" ? "user_message" : "assistant_message", {
            ...payload,
            actor: p.role,
            text: clamp(body),
          });
          break;
        }
        case "reasoning": {
          const body = Array.isArray(p.summary)
            ? p.summary.map((s) => s?.text ?? "").filter(Boolean).join("\n")
            : "";
          if (body.trim()) {
            push("assistant_thinking", { ...payload, actor: "assistant", text: clamp(body) });
          }
          break;
        }
        case "function_call":
        case "custom_tool_call": {
          let args = p.arguments ?? p.input ?? {};
          if (typeof args === "string") {
            try {
              args = JSON.parse(args);
            } catch {
              args = { raw: args };
            }
          }
          push("tool_call", {
            ...payload,
            actor: "assistant",
            tool: { name: p.name, callId: p.call_id, args },
          });
          break;
        }
        case "function_call_output":
        case "custom_tool_call_output": {
          push("tool_result", {
            ...payload,
            actor: "tool",
            text: clamp(typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? "")),
            tool: { name: "", callId: p.call_id ?? null },
            result: { ok: true },
          });
          break;
        }
        case "web_search_call": {
          push("tool_call", { ...payload, actor: "assistant", tool: { name: "web_search", args: p } });
          break;
        }
        default:
          break; // turn_context, event_msg: duplicates or plumbing
      }
    }
  },
};

export const ADAPTERS = { pi, "claude-code": claudeCode, codex };

export function detectAdapter(first, hint) {
  if (hint && ADAPTERS[hint]) return hint;
  for (const adapter of Object.values(ADAPTERS)) {
    if (adapter.detect(first)) return adapter.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// reading
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

export function firstLine(file) {
  return readChunk(file, 0, 8 * 1024).toString("utf8").split("\n")[0];
}

/** Read from `offset` to the last complete line, leaving any partial line. */
function readDelta(file, offset) {
  const { size } = statSync(file);
  if (size <= offset) return null; // truncated or rewritten → caller does a full read
  const chunk = readChunk(file, offset, size - offset);
  const newline = chunk.lastIndexOf(0x0a);
  if (newline === -1) return { text: "", consumed: offset, lines: 0 };
  const text = chunk.subarray(0, newline).toString("utf8");
  return { text, consumed: offset + newline + 1, lines: text.split("\n").length };
}

/** Stream a whole file as line batches, never as one string. */
function readLines(file) {
  const rows = [];
  const { size } = statSync(file);
  const decoder = new StringDecoder("utf8");
  const fd = openSync(file, "r");
  let line = 0;
  try {
    let offset = 0;
    let carry = "";
    let pending = [];
    while (offset < size) {
      const length = Math.min(BLOCK, size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const read = readSync(fd, buffer, 0, length, offset);
      if (read <= 0) break;
      offset += read;
      const chunk = carry + decoder.write(buffer.subarray(0, read));
      pending = chunk.split("\n");
      carry = pending.pop() ?? "";
      for (const text of pending) pushRow(rows, text, (line += 1));
    }
    const tail = carry + decoder.end();
    if (tail) pushRow(rows, tail, (line += 1));
  } finally {
    closeSync(fd);
  }
  return { rows, lines: line };
}

function pushRow(rows, text, line) {
  if (!text.trim()) return;
  try {
    rows.push({ line, entry: JSON.parse(text) });
  } catch {
    // a torn or unknown line is skipped, never fatal
  }
}

const rowsFromText = (text, firstLineNumber) =>
  text.split("\n").flatMap((raw, i) => {
    if (!raw.trim()) return [];
    try {
      return [{ line: firstLineNumber + i, entry: JSON.parse(raw) }];
    } catch {
      return [];
    }
  });

function safeName(id) {
  const base = String(id ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 120);
  return base || "unknown";
}

export function sessionPath(home, adapter, id) {
  return join(home, "events", adapter, `${safeName(id)}.jsonl`);
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
        .map((file) => ({ adapter: source.adapter, file })),
    ),
  );
}

function readCursor(home) {
  const file = paths(home).cursor;
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    // Bump the schema when the meaning of an entry changes, so a stale cursor is
    // ignored rather than silently pointing at the wrong output file.
    if (!parsed || parsed.schema !== 3 || typeof parsed.files !== "object") return {};
    return parsed.files;
  } catch {
    return {};
  }
}

const writeCursor = (home, files) =>
  writeFileSync(paths(home).cursor, `${JSON.stringify({ schema: 3, files }, null, 2)}\n`, "utf8");

function captureOne(home, file, hint, cursor, claimed, result, force, dryRun) {
  const stat = statSync(file);
  const prev = typeof cursor[file] === "object" ? cursor[file] : null;

  if (!force && prev && prev.size === stat.size && prev.mtime === stat.mtimeMs) {
    result.skipped += 1;
    return;
  }
  if (stat.size > MAX_FILE) {
    result.failed.push({
      file,
      error: `too large to read (${Math.round(stat.size / 1024 / 1024)}MB > ${Math.round(
        MAX_FILE / 1024 / 1024,
      )}MB); raise SOCRATES_MAX_SESSION_BYTES`,
    });
    return;
  }

  const canDelta =
    !force &&
    prev?.adapter &&
    prev.out &&
    existsSync(prev.out) &&
    stat.size > prev.offset &&
    prev.offset > 0;

  let adapterName = prev?.adapter ?? hint;
  let delta = null;
  let rows;
  let lines;
  let consumed = stat.size;
  let fresh = true;

  if (canDelta) {
    delta = readDelta(file, prev.offset);
    if (delta) {
      adapterName = prev.adapter;
      rows = rowsFromText(delta.text, (prev.nextLine ?? 0) + 1);
      lines = (prev.nextLine ?? 0) + delta.lines;
      consumed = delta.consumed;
      fresh = false;
    }
  }

  if (fresh) {
    const head = rowsFromText(firstLine(file), 1);
    adapterName = detectAdapter(head[0]?.entry, hint);
    if (!adapterName) {
      cursor[file] = { size: stat.size, mtime: stat.mtimeMs, failed: "unrecognised format" };
      result.failed.push({ file, error: "unrecognised session format" });
      return;
    }
    const full = readLines(file);
    rows = full.rows;
    lines = full.lines;
    consumed = stat.size;
  }

  const adapter = ADAPTERS[adapterName];
  const state = {
    file,
    fresh,
    seq: fresh ? 0 : (prev.nextSeq ?? 0),
    events: [],
    context: fresh ? null : prev.context,
  };
  adapter.scan(rows, state);
  const context = state.context ?? { id: basename(file, ".jsonl"), session: basename(file, ".jsonl"), cwd: "" };

  // Two source files can claim the same identity — Codex resumes a session into a
  // new rollout that reuses it. Storage is per source file, so the loser of the
  // tie gets a suffix instead of truncating the winner.
  let out;
  if (!fresh) {
    out = prev.out;
  } else {
    const base = sessionPath(home, adapterName, context.id ?? context.session);
    const owner = claimed.get(base);
    out = !owner || owner === file ? base : base.replace(/\.jsonl$/, `-${eventId("p", file).slice(4, 10)}.jsonl`);
  }
  claimed.set(out, file);

  if (state.events.length && !dryRun) {
    mkdirSync(join(home, "events", adapterName), { recursive: true });
    const body = `${state.events.map((e) => JSON.stringify(e)).join("\n")}\n`;
    if (fresh) writeFileSync(out, body, "utf8");
    else appendFileSync(out, body, "utf8");
  }

  if (dryRun) {
    // A dry run must not move the cursor either, or the next real run would
    // think the work was already done.
    delete cursor[file];
  } else {
    cursor[file] = {
      size: stat.size,
      mtime: stat.mtimeMs,
      offset: consumed,
      adapter: adapterName,
      out,
      nextSeq: state.seq,
      nextLine: lines,
      context,
    };
  }

  result.captured.push({
    adapter: adapterName,
    session: context.session,
    id: context.id,
    cwd: context.cwd,
    events: state.events.length,
    total: state.seq,
    mode: fresh ? "full" : "delta",
    file: out,
  });
  result.events += state.events.length;
}

/**
 * Capture sessions.
 *
 *   only     — explicit file list; otherwise every known location is scanned
 *   adapter  — hint for --file when the format is not obvious
 *   force    — ignore cursors and re-read from scratch
 *   dryRun   — report what would be captured without writing anything
 */
export function capture({ home, only, adapter, force = false, dryRun = false, sources } = {}) {
  mkdirSync(paths(home).state, { recursive: true });

  const cursor = readCursor(home);
  const candidates = only?.length ? only.map((file) => ({ adapter, file })) : discover(sources);

  const claimed = new Map();
  for (const [source, entry] of Object.entries(cursor)) {
    if (entry?.out) claimed.set(entry.out, source);
  }

  const result = { captured: [], skipped: 0, failed: [], events: 0 };

  for (const { file, adapter: hint } of candidates) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    try {
      captureOne(home, file, hint, cursor, claimed, result, force, dryRun);
    } catch (error) {
      result.failed.push({ file, error: error.message });
    }
  }

  // Output files can outlive the source naming that produced them — Codex alone
  // moved from session_id to rollout id — so a full scan sweeps anything no
  // source currently claims. Never on a partial scan: `--file X` would then
  // delete every other session.
  if (!only?.length && !dryRun) {
    result.removed = sweepOrphans(home, claimed);
  }

  writeCursor(home, cursor);
  return result;
}

function sweepOrphans(home, claimed) {
  const root = paths(home).eventsDir;
  if (!existsSync(root) || !claimed.size) return [];
  const live = new Set(claimed.keys());
  const removed = [];
  for (const adapter of readdirSync(root, { withFileTypes: true })) {
    if (!adapter.isDirectory()) continue;
    for (const name of readdirSync(join(root, adapter.name))) {
      if (!name.endsWith(".jsonl")) continue;
      const full = join(root, adapter.name, name);
      if (live.has(full)) continue;
      try {
        unlinkSync(full);
        removed.push(full);
      } catch {
        /* an orphan is not worth failing a scan over */
      }
    }
  }
  return removed;
}

export function listSessions(home) {
  const root = paths(home).eventsDir;
  if (!existsSync(root)) return [];
  const out = [];
  for (const adapter of readdirSync(root, { withFileTypes: true })) {
    if (!adapter.isDirectory()) continue;
    for (const file of readdirSync(join(root, adapter.name))) {
      if (!file.endsWith(".jsonl")) continue;
      const full = join(root, adapter.name, file);
      const events = readFileSync(full, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      const first = events[0] ?? {};
      out.push({
        adapter: adapter.name,
        session: first.session,
        cwd: first.context?.cwd ?? "",
        ts: first.ts,
        events: events.length,
        file: full,
        path: events,
      });
    }
  }
  return out.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1));
}

export function readSession(home, selector) {
  for (const session of listSessions(home)) {
    if (
      session.session === selector ||
      session.file.endsWith(`${selector}.jsonl`) ||
      String(session.session ?? "").startsWith(selector)
    ) {
      return session.path;
    }
  }
  return null;
}

export function allEvents(home) {
  return listSessions(home).flatMap((s) => s.path);
}
