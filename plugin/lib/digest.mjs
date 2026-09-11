// Digest: a session's events -> the compact text a model actually reads.
//
// This is where output quality is decided, so it has one job: fit a conversation
// into a budget without losing the parts a moment could come from.
//
// Scope: user and assistant messages, tool calls, failures, and session-level
// events. Not assistant thinking. Thinking is the agent's private reasoning — the
// user never read it, so it cannot be evidence of what they do not understand,
// and a moment grounded in it is unverifiable by the person it is for. It is still
// captured into events.jsonl; it is just not rendered here.
//
// Measured on a real 286-event session, the raw costs were:
//
//   tool_call args        158,411 chars   <- the dominant cost, not tool results
//   tool_result text      ~95,000
//   assistant_thinking     84,348         <- excluded entirely
//   user + assistant text  ~31,000
//
// A `write` call inlines a whole file and an `edit` call inlines old and new text,
// which is why arguments dwarf results. Hence: cap args, drop result bodies.
//
// STUB: no signals, no ranking, no total-budget truncation. Plain chronological
// digest with per-line caps. If a session is ever too big to read, that will show
// up in the reported size and get a mechanism then.

import { readJsonl } from "./store.mjs";

/** Tuning knobs, all in one place because they get tuned against real output. */
export const CAPS = {
  text: 600,
  /** Compaction and branch summaries: the agent's own words about lost context. */
  summary: 300,
  /**
   * Tool arguments. Args longer than this are only shown for the tools where what
   * was run is the point; everything else falls back to the bare tool name. Kept
   * low because exploratory `cmd && cmd && echo "===" && cmd` chains are the bulk
   * of the remaining bytes and carry little of the signal.
   */
  toolArgs: 120,
  failure: 300,
  /** Only print a timestamp when this many minutes passed. */
  gapMinutes: 5,
};

/**
 * Tools whose arguments always earn their space. Everything else only shows args
 * when they are already short enough to be cheap.
 */
const ALWAYS_SHOW_ARGS = new Set(["bash", "edit", "write", "read", "powershell"]);

const LABELS = {
  user_message: "USER",
  assistant_message: "ASSISTANT",
  tool_call: "TOOL",
  tool_result: "FAILED",
  error: "ERROR",
  model_change: "MODEL",
  compaction: "COMPACTION",
  branch_summary: "BRANCH",
  label: "LABEL",
  bash_execution: "BASH",
  raw: "UNMAPPED",
};

const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Collapse to one line and cap, marking that something was cut. */
function cut(value, cap) {
  const text = oneLine(value);
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

function minutesBetween(from, to) {
  if (!from || !to) return 0;
  return Math.round((Date.parse(to) - Date.parse(from)) / 60000);
}

/**
 * A short human preview of tool arguments. A bare JSON blob is noise; the command
 * or the file path is the signal.
 */
export function previewArgs(args) {
  if (!args || typeof args !== "object") return "";
  if (typeof args.command === "string") return args.command;

  const path = args.path ?? args.file_path;
  if (typeof path === "string") {
    if (Array.isArray(args.edits)) {
      return `${path}  (${args.edits.length} edit${args.edits.length === 1 ? "" : "s"})`;
    }
    if (typeof args.content === "string") return `${path}  (${args.content.length} chars)`;
    return path;
  }
  return JSON.stringify(args);
}

function renderBody(event) {
  const { kind } = event;

  if (kind === "tool_call") {
    const name = event.tool?.name ?? "?";
    const preview = previewArgs(event.tool?.args);
    if (!preview) return name;
    // Short args are cheap and self-explanatory, so any tool gets them. Long args
    // only earn their space when what was run is the point of the tool.
    const worthShowing = preview.length <= CAPS.toolArgs || ALWAYS_SHOW_ARGS.has(name);
    return worthShowing ? `${name}  ${cut(preview, CAPS.toolArgs)}` : name;
  }

  if (kind === "tool_result") {
    // Only failures reach here; bodies are dropped as noise.
    const exit = event.result?.exitCode;
    const prefix = Number.isFinite(exit) ? `exit ${exit}: ` : "";
    return `${prefix}${cut(event.text, CAPS.failure)}`;
  }

  if (kind === "user_message" || kind === "assistant_message") return cut(event.text, CAPS.text);
  if (kind === "error") return cut(event.text, CAPS.failure);
  if (kind === "model_change") return `${event.model?.provider}/${event.model?.id}`;
  if (kind === "compaction") return `context lost — ${cut(event.text, CAPS.summary)}`;
  if (kind === "branch_summary") return cut(event.text, CAPS.summary);
  if (kind === "bash_execution") {
    const exit = event.result?.exitCode;
    return `${cut(event.tool?.args?.command, CAPS.toolArgs)}  [exit ${exit ?? "?"}]`;
  }
  return cut(event.text, CAPS.text);
}

/** Whether a session contains a conversation at all, or only errors and greetings. */
export function substance(events) {
  const count = (kind) => events.filter((event) => event.kind === kind).length;
  const assistant = count("assistant_message");
  const tools = count("tool_call");
  const user = count("user_message");
  return { user, assistant, tools, hasConversation: assistant + tools > 0 };
}

/**
 * Render one session as text. Pure, so it is testable without a model.
 *
 * Event ids are printed on every line because they are the citation key: a moment's
 * evidence must point at one of these, so the model has to be able to see them.
 */
export function renderDigest(events) {
  const list = [...events].sort((a, b) => a.seq - b.seq);
  const times = list.map((event) => event.ts).sort();
  const models = [
    ...new Set(
      list
        .filter((event) => event.kind === "model_change" && event.model?.id)
        .map((event) => `${event.model.provider}/${event.model.id}`),
    ),
  ];

  const lines = [
    `# session ${list[0]?.session ?? "?"} · ${list[0]?.context?.cwd ?? ""}`,
    `# ${times[0] ?? ""} -> ${times.at(-1) ?? ""} (${minutesBetween(times[0], times.at(-1))} min) · ${list.length} events`,
  ];
  if (models.length) lines.push(`# models: ${models.join(", ")}`);
  lines.push("# cite events in evidence.events using the ids shown at the left");

  let previous = null;
  for (const event of list) {
    const label = LABELS[event.kind];
    if (!label) continue; // thinking, session_start, thinking_level_change, annotation
    if (event.kind === "tool_result" && event.result?.ok !== false) continue;

    const gap = minutesBetween(previous, event.ts);
    if (gap >= CAPS.gapMinutes) lines.push("", `--- ${event.ts.slice(11, 16)}  (+${gap} min)`);
    previous = event.ts;

    lines.push(`${event.id}  ${label.padEnd(10)}  ${renderBody(event)}`);
  }

  return `${lines.join("\n")}\n`;
}

/** Group events by session, with the bits needed to choose between them. */
export function listSessions(events) {
  const byId = new Map();
  for (const event of events) {
    if (!byId.has(event.session)) byId.set(event.session, []);
    byId.get(event.session).push(event);
  }
  return [...byId]
    .map(([session, list]) => {
      const times = list.map((event) => event.ts).sort();
      return {
        session,
        events: list,
        eventCount: list.length,
        cwd: list[0]?.context?.cwd ?? "",
        startedAt: times[0] ?? null,
        endedAt: times.at(-1) ?? null,
        ...substance(list),
      };
    })
    .sort((a, b) => String(a.endedAt).localeCompare(String(b.endedAt)));
}

/** Pick one session by id prefix, or the most recently active one. */
export function pickSession(events, selector) {
  const sessions = listSessions(events);
  if (!selector || selector === "latest") return sessions.at(-1) ?? null;
  return sessions.find((entry) => entry.session.startsWith(selector)) ?? null;
}

/** Convenience for the CLI: read the store and render the chosen session. */
export function digestFor(eventsFile, selector) {
  const picked = pickSession(readJsonl(eventsFile), selector);
  if (!picked) return null;
  return { ...picked, digest: renderDigest(picked.events) };
}
