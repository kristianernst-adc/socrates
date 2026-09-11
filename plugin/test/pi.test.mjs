// Stage 1 tests: Pi transcript -> events, and the capture rebuild.
//
//   node --test plugin/test/*.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { capture, findSessions } from "../lib/capture.mjs";
import { sessionToEvents } from "../lib/pi.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "bin", "socrates");

/** A minimal but complete session: header, both sides, a tool call and result. */
const SESSION = [
  { type: "session", version: 3, id: "01a08fc5-88cc-74f8-971d-edebe7df0b43", timestamp: "2026-09-11T09:21:22.637Z", cwd: "/Users/ema/src/socrates" },
  { type: "model_change", id: "0716ab16", parentId: null, timestamp: "2026-09-11T09:21:33.760Z", provider: "anthropic", modelId: "claude-opus-4-8" },
  { type: "message", id: "aaa11111", parentId: "0716ab16", timestamp: "2026-09-11T09:21:40.000Z", message: { role: "user", content: [{ type: "text", text: "why does the tree walk matter?" }] } },
  {
    type: "message", id: "bbb22222", parentId: "aaa11111", timestamp: "2026-09-11T09:21:41.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "they are asking about ancestry" },
        { type: "text", text: "Because abandoned branches also live in the file." },
        { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls -la" } },
      ],
      stopReason: "toolUse",
    },
  },
  {
    type: "message", id: "ccc33333", parentId: "bbb22222", timestamp: "2026-09-11T09:21:42.000Z",
    message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: "total 24" }], isError: false },
  },
  { type: "label", id: "ddd44444", parentId: "ccc33333", timestamp: "2026-09-11T09:21:43.000Z", targetId: "aaa11111", label: "the good bit" },
  { type: "totally_unknown_entry", id: "eee55555", parentId: "ddd44444", timestamp: "2026-09-11T09:21:44.000Z" },
];

function writeSession(dir, name, rows) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  return file;
}

// 7 entries in, 9 events out: the assistant turn holds three content blocks.
const EXPECTED_EVENTS = 9;

const sessionFile = (rows = SESSION) => writeSession(mkdtempSync(join(tmpdir(), "pi-")), "s.jsonl", rows);

// --- adapter -----------------------------------------------------------------

test("adapter splits one message into one event per content block", () => {
  const { events } = sessionToEvents(sessionFile());

  // The assistant turn carries thinking + text + toolCall: three events sharing
  // one entryId, distinguished by blockIndex.
  const assistant = events.filter((e) => e.source.entryId === "bbb22222");
  assert.deepEqual(assistant.map((e) => [e.kind, e.source.blockIndex]), [
    ["assistant_thinking", 0],
    ["assistant_message", 1],
    ["tool_call", 2],
  ]);
  assert.equal(assistant[2].tool.name, "bash");
  assert.equal(assistant[2].tool.args.command, "ls -la");
});

test("adapter reads the conversation in order and keeps provenance", () => {
  const { events, sessionId, cwd } = sessionToEvents(sessionFile());

  assert.equal(sessionId, "01a08fc5-88cc-74f8-971d-edebe7df0b43");
  assert.equal(cwd, "/Users/ema/src/socrates");
  assert.deepEqual(events.map((e) => e.kind), [
    "session_start", "model_change", "user_message",
    "assistant_thinking", "assistant_message", "tool_call",
    "tool_result", "label", "raw",
  ]);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(events[6].result.ok, true);
  assert.equal(events[6].tool.callId, "call_1");
  assert.equal(events[6].actor, "tool");
  assert.equal(events[2].actor, "user");
  assert.equal(events[0].context.cwd, "/Users/ema/src/socrates");
});

test("adapter gives stable ids, so re-ingesting cannot duplicate", () => {
  const first = sessionToEvents(sessionFile()).events.map((e) => e.id);
  const second = sessionToEvents(sessionFile()).events.map((e) => e.id);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
});

test("adapter never silently drops an entry type it does not know", () => {
  const { events } = sessionToEvents(sessionFile());
  const unknown = events.at(-1);
  assert.equal(unknown.kind, "raw");
  assert.equal(unknown.text, "totally_unknown_entry");
});

test("adapter tolerates a torn final line and an unreadable file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-"));
  const file = join(dir, "torn.jsonl");
  writeFileSync(file, `${SESSION.map((r) => JSON.stringify(r)).join("\n")}\n{"type":"mess`, "utf8");

  assert.equal(sessionToEvents(file).events.length, EXPECTED_EVENTS);
  assert.deepEqual(sessionToEvents(join(dir, "nope.jsonl")).events, []);
});

// --- capture -----------------------------------------------------------------

test("capture rebuilds events.jsonl deterministically", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-"));
  writeSession(join(dir, "--a--"), "one.jsonl", SESSION);
  writeSession(join(dir, "--b--"), "two.jsonl", SESSION.map((r) => ({ ...r, id: `${r.id}x`.slice(0, 8) })));
  const eventsFile = join(mkdtempSync(join(tmpdir(), "out-")), "events.jsonl");

  const first = capture({ dir, eventsFile });
  const afterFirst = readFileSync(eventsFile, "utf8");
  const second = capture({ dir, eventsFile });

  assert.equal(first.sessions, 2);
  assert.equal(first.events, second.events);
  assert.equal(readFileSync(eventsFile, "utf8"), afterFirst, "a second capture must be byte-identical");
});

test("capture reports per-file counts so an empty session is visible", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-"));
  writeSession(join(dir, "--a--"), "empty.jsonl", []);

  const result = capture({ dir, eventsFile: null });
  assert.equal(result.sessions, 1);
  assert.equal(result.files[0].events, 0);
});

test("findSessions survives a directory that does not exist", () => {
  assert.deepEqual(findSessions(join(tmpdir(), "definitely-not-here-1234")), []);
});

test("capture --dry-run writes nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "socrates-"));
  const dir = mkdtempSync(join(tmpdir(), "pi-"));
  writeSession(join(dir, "--a--"), "one.jsonl", SESSION);

  const stdout = execFileSync(process.execPath, [CLI, "capture", "--dir", dir, "--dry-run"], {
    env: { ...process.env, SOCRATES_HOME: home, PLUGIN_DATA: "" },
    encoding: "utf8",
  });

  assert.match(stdout, /would capture \d+ events from 1 sessions/);
  assert.throws(() => readFileSync(join(home, "events.jsonl"), "utf8"));
});
