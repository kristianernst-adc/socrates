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
// STUB: thinking blocks are dropped, tool output is truncated, and there is no
// incremental append. A changed session file is re-normalised wholesale.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { paths } from "./store.mjs";

const MAX_TEXT = 4_000;
const MAX_OUTPUT = 2_000;
// Node cannot materialise a single string beyond ~512MB. Some Codex rollouts get
// close, so skip them with a clear reason rather than dying mid-scan.
const MAX_FILE = Number(process.env.SOCRATES_MAX_SESSION_BYTES ?? 256 * 1024 * 1024);

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
    { harness: "claude-code", dir: join(home, ".claude", "projects") },
    { harness: "codex", dirs: [join(home, ".codex", "sessions"), join(home, ".codex", "archived_sessions")] },
  ];
}

// ---------------------------------------------------------------------------
// adapters
// ---------------------------------------------------------------------------

function readPi(file) {
  const events = [];
  let meta = null;
  let seq = 0;

  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "session") {
      meta = {
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
      seq: seq++,
    };

    if (message.role === "user") {
      const text = blockText(message.content);
      if (text.trim()) events.push({ ...base, kind: "message", role: "user", text: clamp(text, MAX_TEXT) });
      continue;
    }

    if (message.role === "assistant") {
      const text = blockText(message.content);
      if (text.trim()) {
        events.push({
          ...base,
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
          ...base,
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
        ...base,
        kind: "tool_result",
        tool: message.toolName,
        output: clamp(blockText(message.content), MAX_OUTPUT),
        isError: Boolean(message.isError),
        toolUseId: message.toolCallId,
      });
    }
  }

  return { meta: meta ?? { sessionId: file, harness: "pi" }, events };
}

function readClaudeCode(file) {
  const events = [];
  let meta = null;
  let seq = 0;

  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;

    // Sidechains are subagent transcripts interleaved into the same file.
    // Keep them out for now: they double the volume and rarely carry the
    // moment that matters.
    if (entry.isSidechain) continue;

    meta ??= {
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
      sessionId: entry.sessionId,
      seq: seq++,
    };

    if (entry.type === "user") {
      const text = blockText(message.content);
      if (text.trim()) events.push({ ...base, kind: "message", role: "user", text: clamp(text, MAX_TEXT) });
    } else {
      const text = blockText(message.content);
      if (text.trim()) {
        events.push({
          ...base,
          kind: "message",
          role: "assistant",
          text: clamp(text, MAX_TEXT),
          model: message.model,
        });
      }
    }

    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks) {
      if (block?.type === "tool_use") {
        events.push({
          ...base,
          kind: "tool",
          tool: block.name,
          input: block.input ?? {},
          toolUseId: block.id,
        });
      } else if (block?.type === "tool_result") {
        events.push({
          ...base,
          kind: "tool_result",
          output: clamp(blockText(block.content), MAX_OUTPUT),
          isError: Boolean(block.is_error),
          toolUseId: block.tool_use_id,
        });
      }
    }
  }

  return { meta: meta ?? { sessionId: file, harness: "claude-code" }, events };
}

function readCodex(file) {
  const events = [];
  let meta = null;
  let seq = 0;

  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "session_meta") {
      meta = {
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
      seq: seq++,
    };

    switch (payload.type) {
      case "message": {
        // "developer" carries sandbox and app boilerplate. Never useful.
        if (payload.role !== "user" && payload.role !== "assistant") continue;
        const text = blockText(payload.content);
        if (!text.trim()) continue;
        events.push({ ...base, kind: "message", role: payload.role, text: clamp(text, MAX_TEXT) });
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
        events.push({
          ...base,
          kind: "tool",
          tool: payload.name,
          input,
          toolUseId: payload.call_id,
        });
        break;
      }
      case "function_call_output":
      case "custom_tool_call_output": {
        events.push({
          ...base,
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

  return { meta: meta ?? { sessionId: file, harness: "codex" }, events };
}

const ADAPTERS = { pi: readPi, "claude-code": readClaudeCode, codex: readCodex };

export function detectHarness(file, hint) {
  if (hint && ADAPTERS[hint]) return hint;
  const first = readFileSync(file, "utf8").split("\n").find((l) => l.trim());
  if (!first) return null;
  try {
    const entry = JSON.parse(first);
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
    if (event.kind === "tool" && event.toolUseId) byId.set(event.toolUseId, event);
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

export function captureFile(file, hint) {
  const harness = detectHarness(file, hint);
  if (!harness) return null;
  const { meta, events } = ADAPTERS[harness](file);

  return {
    harness,
    source: file,
    meta: { ...meta, harness, source: file },
    events: joinToolResults(events).map((event) => ({
      ...event,
      harness,
      sessionId: meta.sessionId,
    })),
  };
}

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
    (source.dirs ?? [source.dir]).flatMap((dir) => walk(dir).map((file) => ({ harness: source.harness, file }))),
  );
}

const cursorFile = (home) => join(home, "state", "captured.json");

function readCursor(home) {
  const file = cursorFile(home);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function sessionPath(home, harness, sessionId) {
  return join(home, "events", harness, `${sessionId}.jsonl`);
}

/**
 * Capture one or more sessions. Skips files whose size and mtime are unchanged,
 * which is the whole incremental strategy — sessions are append-only, so a
 * changed file is simply re-normalised.
 */
export function capture({ home, only, harness, force = false, sources } = {}) {
  const target = paths(home);
  mkdirSync(join(home, "state"), { recursive: true });

  const cursor = readCursor(home);
  const candidates = only?.length
    ? only.map((file) => ({ harness, file }))
    : discover(sources);

  const result = { captured: [], skipped: 0, failed: [], events: 0 };

  for (const { file, harness: hint } of candidates) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    const key = `${stat.size}:${stat.mtimeMs}`;
    if (!force && cursor[file] === key) {
      result.skipped += 1;
      continue;
    }
    if (stat.size > MAX_FILE) {
      result.failed.push({
        file,
        error: `too large to read (${Math.round(stat.size / 1024 / 1024)}MB > ${Math.round(
          MAX_FILE / 1024 / 1024,
        )}MB limit); raise SOCRATES_MAX_SESSION_BYTES or split the session`,
      });
      continue;
    }

    let parsed;
    try {
      parsed = captureFile(file, hint);
    } catch (error) {
      result.failed.push({ file, error: error.message });
      continue;
    }
    if (!parsed || !parsed.events.length) {
      cursor[file] = key;
      continue;
    }

    const file_out = sessionPath(home, parsed.harness, parsed.meta.sessionId);
    mkdirSync(join(home, "events", parsed.harness), { recursive: true });
    writeFileSync(
      file_out,
      [JSON.stringify({ ...parsed.meta, type: "session" }), ...parsed.events.map((e) => JSON.stringify(e))]
        .join("\n") + "\n",
      "utf8",
    );

    cursor[file] = key;
    result.captured.push({
      harness: parsed.harness,
      sessionId: parsed.meta.sessionId,
      cwd: parsed.meta.cwd,
      events: parsed.events.length,
      file: file_out,
    });
    result.events += parsed.events.length;
  }

  writeFileSync(cursorFile(home), `${JSON.stringify(cursor, null, 2)}\n`, "utf8");
  return result;
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
      const first = readFileSync(full, "utf8").split("\n")[0];
      let meta = {};
      try {
        meta = JSON.parse(first);
      } catch {
        /* keep the empty meta */
      }
      const lines = readFileSync(full, "utf8").split("\n").filter((l) => l.trim()).length - 1;
      out.push({ ...meta, harness: harness.name, events: lines, file: full });
    }
  }
  return out.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1));
}

export function readSession(home, sessionId) {
  for (const session of listSessions(home)) {
    if (session.sessionId === sessionId || session.file.endsWith(`${sessionId}.jsonl`)) {
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
      lines.push(`${tag} TOOL ${event.tool ?? "?"}${input ? `: ${input}` : ""}${event.isError ? "  [ERROR]" : ""}`);
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
