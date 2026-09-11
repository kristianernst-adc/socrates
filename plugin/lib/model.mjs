// The capture data model.
//
// Two records, on purpose:
//
//   event  — one thing that happened in a session, normalized so that no harness
//            vocabulary leaks past `source`. Cheap to produce, expensive to read.
//   moment — one thing that happened which is worth understanding. The atomic
//            unit, and the only thing a human will ever look at.
//
// Same discipline as taste.mjs: these normalizers are the validation boundary, not
// the JSON Schemas in schemas/. Untrusted input (a model, a skill, stdin) is
// narrowed to known fields here, so a bad payload cannot inject anything.

import { eventId, makeId } from "./store.mjs";

export const SCHEMA_VERSION = 1;

export const EVENT_KINDS = [
  "session_start",
  "user_message",
  "assistant_message",
  "assistant_thinking",
  "tool_call",
  "tool_result",
  "bash_execution",
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "label",
  "annotation",
  "error",
  "raw",
];

export const ACTORS = ["user", "assistant", "tool", "system"];

export const MOMENT_KINDS = [
  "concept_encountered",
  "pattern_used",
  "tool_without_comprehension",
  "mistake_made",
  "user_correction",
  "repeated_question",
  "agent_explained",
  "unresolved_question",
];

export const MOMENT_STATUSES = ["new", "kept", "rejected", "superseded"];
export const CONCEPT_ROLES = ["central", "incidental"];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Optional string: absent or wrong type becomes "", never throws. */
const str = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const strList = (value, maxItems, maxEach) =>
  Array.isArray(value)
    ? [...new Set(value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim().slice(0, maxEach)))].slice(0, maxItems)
    : [];

const optionalObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

function normalizeSource(input) {
  const source = optionalObject(input) ?? {};
  const blockIndex = Number.isInteger(source.blockIndex) ? source.blockIndex : 0;
  return {
    adapter: str(source.adapter, 40) || "unknown",
    adapterVersion: Number.isFinite(source.adapterVersion) ? source.adapterVersion : 1,
    file: str(source.file, 400),
    line: Number.isFinite(source.line) ? source.line : null,
    entryId: str(source.entryId, 60),
    blockIndex,
    // Kept only so the session tree can be reconstructed. Not a model field.
    parentId: str(source.parentId, 60) || null,
  };
}

/**
 * Normalize one event. `kind` and `session` are the only hard requirements.
 * The id is derived from session + entry + block when we know them, so
 * re-ingesting a transcript produces the same ids rather than duplicates.
 */
export function normalizeEvent(input = {}) {
  const kind = EVENT_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) throw new Error(`event requires kind, one of: ${EVENT_KINDS.join(", ")}`);

  const session = str(input.session, 80);
  if (!session) throw new Error("event requires session");

  const source = normalizeSource(input.source);
  const tool = optionalObject(input.tool);
  const result = optionalObject(input.result);
  const model = optionalObject(input.model);
  const context = optionalObject(input.context);

  return {
    type: "event",
    schemaVersion: SCHEMA_VERSION,
    id: str(input.id, 160) || eventId(session, source.entryId || "x", source.blockIndex),
    seq: Number.isInteger(input.seq) ? input.seq : 0,
    session,
    ts: str(input.ts, 40) || new Date().toISOString(),
    kind,
    actor: ACTORS.includes(input.actor) ? input.actor : "system",
    text: str(input.text, 4000),
    tool: tool
      ? {
          name: str(tool.name, 60),
          callId: str(tool.callId, 80) || null,
          args: optionalObject(tool.args) ?? {},
        }
      : null,
    result: result
      ? {
          ok: result.ok !== false,
          exitCode: Number.isFinite(result.exitCode) ? result.exitCode : null,
          truncated: result.truncated === true,
        }
      : null,
    model: model ? { provider: str(model.provider, 40), id: str(model.id, 80) } : null,
    source,
    context: { cwd: str(context?.cwd, 400), repo: str(context?.repo, 200) || null },
  };
}

function normalizeEvidence(value) {
  const item = optionalObject(value);
  if (!item) return null;
  const events = strList(item.events, 8, 160);
  if (!events.length) return null; // evidence that points at nothing is not evidence
  return { events, quote: str(item.quote, 400), kind: str(item.kind, 40) };
}

/**
 * Normalize one moment. A moment without evidence is rejected outright: the whole
 * premise is that a learning is grounded in something that actually happened.
 */
export function normalizeMoment(input = {}) {
  const kind = MOMENT_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) throw new Error(`moment requires kind, one of: ${MOMENT_KINDS.join(", ")}`);

  const title = str(input.title, 160);
  if (!title) throw new Error("moment requires title");

  const summary = str(input.summary, 1200);
  if (!summary) throw new Error("moment requires summary");

  const evidence = (Array.isArray(input.evidence) ? input.evidence : [])
    .map(normalizeEvidence)
    .filter(Boolean)
    .slice(0, 8);
  if (!evidence.length) {
    throw new Error("moment requires evidence: at least one { events: [eventId] }");
  }

  const origin = optionalObject(input.origin) ?? {};
  const capturedBy = optionalObject(input.capturedBy) ?? {};
  const now = new Date().toISOString();

  return {
    type: "moment",
    schemaVersion: SCHEMA_VERSION,
    id: str(input.id, 80) || makeId("mo"),
    createdAt: str(input.createdAt, 40) || now,
    updatedAt: str(input.updatedAt, 40) || now,
    status: MOMENT_STATUSES.includes(input.status) ? input.status : "new",
    kind,
    title,
    summary,
    why: str(input.why, 600),
    confidence: clamp(Number(input.confidence) || 0.5, 0, 1),
    basis: strList(input.basis, 8, 60),
    evidence,
    topics: strList(input.topics, 8, 60),
    concepts: (Array.isArray(input.concepts) ? input.concepts : [])
      .map((value) => {
        const concept = optionalObject(value);
        const name = str(concept?.name, 80);
        if (!name) return null;
        return { name, role: CONCEPT_ROLES.includes(concept.role) ? concept.role : "incidental" };
      })
      .filter(Boolean)
      .slice(0, 8),
    origin: {
      sessionId: str(origin.sessionId, 80) || null,
      cwd: str(origin.cwd, 400),
      repo: str(origin.repo, 200) || null,
      harness: str(origin.harness, 40) || "unknown",
      // "degrade honestly": a moment from a compacted session says so rather than
      // looking like a moment from a complete one.
      fidelity: str(origin.fidelity, 40) || "full",
    },
    capturedBy: {
      by: str(capturedBy.by, 80),
      version: Number.isFinite(capturedBy.version) ? capturedBy.version : 1,
      packetId: str(capturedBy.packetId, 80) || null,
      harness: str(capturedBy.harness, 40),
      model: str(capturedBy.model, 120),
    },
  };
}
