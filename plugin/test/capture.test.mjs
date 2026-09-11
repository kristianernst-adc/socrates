// Zero-dependency tests for the capture slice.
//
//   node --test plugin/test/
//
// No test framework, no package.json. Same constraint as the plugin itself.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  appendJsonl,
  eventShardPath,
  readJsonl,
  readLatestById,
  resolveHome,
} from "../lib/store.mjs";
import { normalizeEvent, normalizeMoment } from "../lib/model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "bin", "socrates");

const tempHome = () => mkdtempSync(join(tmpdir(), "socrates-test-"));

/** Run the CLI against an isolated data root. */
function run(home, args, input, extraEnv = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, SOCRATES_HOME: home, PLUGIN_DATA: "", ...extraEnv },
    input,
    encoding: "utf8",
  });
}

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// --- store -------------------------------------------------------------------

test("home resolution: config.home beats PLUGIN_DATA beats the config dir", () => {
  const pluginData = join(tempHome(), "plugin-data");

  // Lowest priority: PLUGIN_DATA, when nothing is configured.
  const bare = tempHome();
  withEnv({ SOCRATES_HOME: bare, PLUGIN_DATA: pluginData }, () => {
    assert.equal(resolveHome(), pluginData);
  });

  // Middle priority: an explicit `home` in config.json.
  const configured = tempHome();
  const target = join(configured, "elsewhere");
  writeFileSync(join(configured, "config.json"), JSON.stringify({ home: target }));
  withEnv({ SOCRATES_HOME: configured, PLUGIN_DATA: pluginData }, () => {
    assert.equal(resolveHome(), target);
  });

  // Highest priority: SOCRATES_HOME picks which config.json is read at all.
  withEnv({ SOCRATES_HOME: bare, PLUGIN_DATA: undefined }, () => {
    assert.equal(resolveHome(), bare);
  });
});

test("events are sharded by month", () => {
  assert.equal(
    eventShardPath("/home/me/.socrates", "2026-09-11T09:21:41.208Z"),
    "/home/me/.socrates/events/2026-09.jsonl",
  );
});

test("readJsonl tolerates a torn final line", () => {
  const root = tempHome();
  const file = join(root, "state", "torn.jsonl");
  appendJsonl(file, { id: "a" });
  appendJsonl(file, { id: "b" });
  writeFileSync(file, `${readFileSync(file, "utf8")}{"id":"c"`, "utf8");

  assert.deepEqual(readJsonl(file).map((r) => r.id), ["a", "b"]);
});

test("readLatestById is a fold: the last record for an id wins", () => {
  const root = tempHome();
  const file = join(root, "moments.jsonl");
  appendJsonl(file, { id: "mo_1", status: "new" });
  appendJsonl(file, { id: "mo_2", status: "new" });
  appendJsonl(file, { id: "mo_1", status: "rejected" });

  const latest = readLatestById(file);
  assert.equal(latest.length, 2);
  assert.equal(latest.find((m) => m.id === "mo_1").status, "rejected");
});

// --- model -------------------------------------------------------------------

const validEvent = {
  session: "01a08fc5-88cc-74f8-971d-edebe7df0b43",
  ts: "2026-09-11T09:21:41.208Z",
  kind: "tool_call",
  actor: "assistant",
  tool: { name: "bash", callId: "call_1", args: { command: "ls -la" } },
  source: { adapter: "pi", entryId: "66f67dd3", blockIndex: 0, parentId: "1c4c4229" },
  context: { cwd: "/Users/ema/src/socrates" },
};

test("normalizeEvent requires a known kind and a session", () => {
  assert.throws(() => normalizeEvent({ session: "s" }), /requires kind/);
  assert.throws(() => normalizeEvent({ kind: "tool_call" }), /requires session/);
  assert.throws(() => normalizeEvent({ kind: "not_a_kind", session: "s" }), /requires kind/);
});

test("normalizeEvent derives a stable id and confines harness vocabulary to source", () => {
  const event = normalizeEvent(validEvent);
  assert.equal(event.id, "ev_01a08fc5_66f67dd3_0");
  assert.equal(event.kind, "tool_call");
  assert.equal(event.tool.args.command, "ls -la");

  // The discipline claim, made executable: upstream keys exist only inside `source`.
  const { source, ...rest } = event;
  assert.equal(source.entryId, "66f67dd3");
  assert.match(source.parentId, /1c4c4229/);
  for (const leak of ["parentId", "entryId", "blockIndex", "toolCallId", "stopReason", "isError"]) {
    assert.ok(!JSON.stringify(rest).includes(leak), `${leak} leaked out of source`);
  }
});

test("normalizeEvent defaults unknown actors rather than trusting them", () => {
  const event = normalizeEvent({ ...validEvent, actor: "root" });
  assert.equal(event.actor, "system");
});

test("normalizeMoment refuses a moment with no evidence", () => {
  assert.throws(() => normalizeMoment({ kind: "mistake_made", title: "t", summary: "s" }), /requires evidence/);
  assert.throws(
    () => normalizeMoment({ kind: "mistake_made", title: "t", summary: "s", evidence: [{ quote: "orphan" }] }),
    /requires evidence/,
  );
});

test("normalizeMoment drops unknown fields and clamps confidence", () => {
  const moment = normalizeMoment({
    kind: "concept_encountered",
    title: "Sessions are trees",
    summary: "Abandoned branches stay on disk.",
    confidence: 5,
    evidence: [{ events: ["ev_01a08fc5_66f67dd3_0"], quote: "wait, why?" }],
    topics: ["session-format", "session-format", "provenance"],
    junk: "must not be stored",
  });

  assert.match(moment.id, /^mo_/);
  assert.equal(moment.status, "new");
  assert.equal(moment.confidence, 1);
  assert.equal(moment.evidence.length, 1);
  assert.deepEqual(moment.topics, ["session-format", "provenance"]);
  assert.deepEqual(Object.keys(moment).sort(), [
    "basis", "capturedBy", "concepts", "confidence", "createdAt", "evidence", "id",
    "kind", "origin", "schemaVersion", "status", "summary", "title", "topics",
    "type", "updatedAt", "why",
  ]);
});

// --- CLI round trip ----------------------------------------------------------

test("moments round-trip through the CLI, and a dismissal appends rather than rewrites", () => {
  const home = tempHome();
  const input = JSON.stringify({
    kind: "agent_explained",
    title: "Why the tree walk matters",
    summary: "The active path is an ancestor walk from the last entry.",
    evidence: [{ events: ["ev_01a08fc5_66f67dd3_0"], quote: "why does that work?" }],
    origin: { sessionId: "01a08fc5-88cc-74f8-971d-edebe7df0b43", harness: "pi" },
  });

  const created = JSON.parse(run(home, ["moments", "add"], input));
  assert.match(created.id, /^mo_/);

  let listed = JSON.parse(run(home, ["moments", "list", "--format", "json"]));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "Why the tree walk matters");

  run(home, ["moments", "dismiss", created.id]);
  listed = JSON.parse(run(home, ["moments", "list", "--format", "json"]));
  assert.equal(listed.length, 1, "dismissal must not create a second moment");
  assert.equal(listed[0].status, "rejected");

  // The record is still on disk; only the fold hides it.
  assert.equal(readJsonl(join(home, "moments.jsonl")).length, 2);
});

test("moments add fills provenance from the surrounding Pi session", () => {
  const home = tempHome();
  const created = JSON.parse(run(home, ["moments", "add"], JSON.stringify({
    kind: "agent_explained",
    title: "t",
    summary: "s",
    evidence: [{ events: ["ev_1_1_0"] }],
  }), { PI_SESSION_ID: "01a08fc5-88cc-74f8-971d-edebe7df0b43", PI_MODEL: "anthropic/claude-opus-4-8" }));

  assert.equal(created.origin.sessionId, "01a08fc5-88cc-74f8-971d-edebe7df0b43");
  assert.equal(created.origin.harness, "pi");
  assert.equal(created.origin.cwd, process.cwd());
  assert.equal(created.capturedBy.harness, "pi");
  assert.equal(created.capturedBy.model, "anthropic/claude-opus-4-8");
  assert.equal(created.capturedBy.by, "cli");
});

test("moments add rejects a malformed payload instead of storing it", () => {
  const home = tempHome();
  assert.throws(
    () => run(home, ["moments", "add"], JSON.stringify({ kind: "mistake_made", title: "no summary" })),
    /socrates: moment requires summary/,
  );
});

test("existing taste commands still work", () => {
  const home = tempHome();
  run(home, ["taste", "add", "--json", JSON.stringify({
    polarity: "avoid",
    about: "code comments",
    statement: "Avoid restating what the code already says",
    source: "user",
  })]);

  const statements = JSON.parse(run(home, ["taste", "list", "--format", "json"]));
  assert.equal(statements.length, 1);
  assert.equal(statements[0].status, "active");
});
