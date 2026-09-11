// Stage 2 tests: the digest.
//
//   node --test plugin/test/*.test.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { CAPS, pickSession, previewArgs, renderDigest, substance } from "../lib/digest.mjs";
import { normalizeEvent } from "../lib/model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "bin", "socrates");
const SESSION = "01a08fc5-88cc-74f8-971d-edebe7df0b43";

let seq = 0;
const freshSeq = () => {
  seq = 0;
};

const ev = (kind, extra = {}) =>
  normalizeEvent({
    session: extra.session ?? SESSION,
    seq: (seq += 1),
    ts: extra.ts ?? "2026-09-11T09:21:40.000Z",
    kind,
    actor: extra.actor ?? "assistant",
    text: extra.text ?? "",
    tool: extra.tool ?? null,
    result: extra.result ?? null,
    model: extra.model ?? null,
    source: {},
    context: { cwd: "/repo" },
  });

/** Write a store and run the CLI against it, isolated from the real data root. */
function withStore(events, args) {
  const home = mkdtempSync(join(tmpdir(), "socrates-"));
  writeFileSync(join(home, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  const stdout = execFileSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, SOCRATES_HOME: home, PLUGIN_DATA: "" },
    encoding: "utf8",
  });
  return stdout;
}

// --- argument rendering ------------------------------------------------------

test("previewArgs prefers the command, then the path", () => {
  assert.equal(previewArgs({ command: "ls -la" }), "ls -la");
  assert.equal(previewArgs({ path: "/a/b.md" }), "/a/b.md");
  assert.equal(previewArgs({ file_path: "/a/b.md" }), "/a/b.md");
  assert.equal(previewArgs({ path: "/a/b.ts", edits: [{}, {}] }), "/a/b.ts  (2 edits)");
  assert.equal(previewArgs({ path: "/a/b.ts", content: "x".repeat(50) }), "/a/b.ts  (50 chars)");
  assert.equal(previewArgs(null), "");
});

test("tool args show for bash, for short args, and not for long args elsewhere", () => {
  freshSeq();
  const digest = renderDigest([
    ev("tool_call", { tool: { name: "bash", args: { command: "ls -la" } } }),
    ev("tool_call", { tool: { name: "grep", args: { pattern: "TODO" } } }),
    ev("tool_call", { tool: { name: "grep", args: { pattern: "x".repeat(400) } } }),
    ev("tool_call", { tool: { name: "ask_user_question", args: { questions: "y".repeat(400) } } }),
  ]);

  assert.match(digest, /TOOL\s+bash\s+ls -la/);
  assert.match(digest, /TOOL\s+grep\s+\{"pattern":"TODO"\}/);
  assert.ok(!digest.includes("x".repeat(50)), "long args on an unlisted tool must not appear");
  assert.ok(!digest.includes("y".repeat(50)), "long args on an unlisted tool must not appear");
  assert.match(digest, /TOOL\s+ask_user_question\s*$/m);
});

test("args longer than the cap are cut, not dropped", () => {
  freshSeq();
  const digest = renderDigest([ev("tool_call", { tool: { name: "bash", args: { command: "z".repeat(500) } } })]);
  assert.match(digest, new RegExp(`z{${CAPS.toolArgs}}…`));
  assert.ok(!digest.includes("z".repeat(CAPS.toolArgs + 1)));
});

// --- what gets dropped -------------------------------------------------------

test("successful tool results are dropped, failures survive", () => {
  freshSeq();
  const digest = renderDigest([
    ev("assistant_message", { text: "running it" }),
    ev("tool_call", { tool: { name: "bash", args: { command: "make" } } }),
    ev("tool_result", { actor: "tool", text: "OK, 400 lines of build noise", result: { ok: true } }),
    ev("tool_result", { actor: "tool", text: "error TS2304: cannot find name", result: { ok: false, exitCode: 2 } }),
  ]);

  assert.ok(!digest.includes("400 lines of build noise"));
  assert.match(digest, /FAILED\s+exit 2: error TS2304/);
});

test("low-signal event kinds never reach the digest", () => {
  freshSeq();
  const digest = renderDigest([
    ev("session_start", { text: "pi session v3" }),
    ev("thinking_level_change", { text: "medium" }),
    ev("annotation", { text: "my-extension" }),
    ev("user_message", { actor: "user", text: "hello" }),
  ]);

  assert.ok(!digest.includes("pi session v3"));
  assert.ok(!digest.includes("medium"));
  assert.ok(!digest.includes("my-extension"));
  assert.match(digest, /hello/);
});

test("assistant thinking is never rendered", () => {
  freshSeq();
  const digest = renderDigest([
    ev("assistant_thinking", { text: "I think the user is confused about the tree walk" }),
    ev("assistant_message", { text: "Sessions are trees." }),
  ]);

  // The user never saw the thinking, so it cannot be evidence of what they know.
  assert.ok(!digest.includes("I think the user is confused"));
  assert.match(digest, /Sessions are trees\./);
});

test("text is collapsed to one line", () => {
  freshSeq();
  const digest = renderDigest([ev("user_message", { actor: "user", text: "a\n\n  b\t c" })]);
  assert.match(digest, /USER\s+a b c$/m);
});

test("text over the cap is cut to exactly the cap", () => {
  freshSeq();
  const digest = renderDigest([ev("user_message", { actor: "user", text: "x".repeat(900) })]);
  const body = digest.split("\n").find((line) => line.includes("USER"));
  const rendered = body.slice(body.indexOf("USER") + "USER".length).trim();

  assert.equal(rendered.length, CAPS.text + 1, "cap plus the ellipsis");
  assert.match(rendered, new RegExp(`^x{${CAPS.text}}…$`));
});

test("summaries get a tighter cap than conversation text", () => {
  freshSeq();
  assert.ok(CAPS.summary < CAPS.text);
  const digest = renderDigest([ev("compaction", { text: "t".repeat(900) })]);
  assert.match(digest, new RegExp(`t{${CAPS.summary}}…`));
});

test("a lost context is called out rather than silently missing", () => {
  freshSeq();
  const digest = renderDigest([ev("compaction", { text: "summarised 50k tokens" })]);
  assert.match(digest, /COMPACTION\s+context lost — summarised 50k tokens/);
});

// --- citation ----------------------------------------------------------------

test("every line carries a citable event id, and the header explains that", () => {
  freshSeq();
  const events = [
    ev("user_message", { actor: "user", text: "why does that work?" }),
    ev("assistant_message", { text: "because of the tree walk" }),
  ];
  const digest = renderDigest(events);

  assert.match(digest, /cite events in evidence\.events/);
  for (const event of events) assert.ok(digest.includes(event.id), `${event.id} must be citable`);
});

test("a long pause gets a timestamp marker", () => {
  freshSeq();
  const digest = renderDigest([
    ev("user_message", { actor: "user", text: "one", ts: "2026-09-11T09:21:40.000Z" }),
    ev("user_message", { actor: "user", text: "two", ts: "2026-09-11T09:33:40.000Z" }),
  ]);
  assert.match(digest, /--- 09:33\s+\(\+12 min\)/);
});

// --- choosing and skipping sessions -----------------------------------------

test("substance needs an assistant message or a tool call", () => {
  freshSeq();
  assert.equal(substance([ev("user_message", { actor: "user" })]).hasConversation, false);
  freshSeq();
  assert.equal(substance([ev("error", { text: "OAuth refresh failed" })]).hasConversation, false);
  freshSeq();
  assert.equal(substance([ev("assistant_message")]).hasConversation, true);
});

test("pickSession resolves latest, a prefix, and nothing", () => {
  freshSeq();
  const events = [
    ev("assistant_message", { session: "aaaa1111-x", ts: "2026-09-11T09:00:00.000Z" }),
    ev("assistant_message", { session: "bbbb2222-y", ts: "2026-09-11T10:00:00.000Z" }),
  ];

  assert.equal(pickSession(events, "latest").session, "bbbb2222-y");
  assert.equal(pickSession(events, "aaaa").session, "aaaa1111-x");
  assert.equal(pickSession(events, "nope"), null);
});

// --- CLI ---------------------------------------------------------------------

test("extract prints the digest, and --list summarises", () => {
  freshSeq();
  const events = [
    ev("user_message", { actor: "user", text: "hi", session: "aaaa1111-x" }),
    ev("assistant_message", { text: "hello", session: "aaaa1111-x" }),
  ];

  assert.match(withStore(events, ["extract"]), /# session aaaa1111-x/);
  assert.match(withStore(events, ["extract", "--list"]), /aaaa1111\s+2\s+2026-09-11T09:21/);
});

test("extract refuses a session with nothing to learn", () => {
  freshSeq();
  const events = [
    ev("user_message", { actor: "user", text: "exit", session: "01a08fb2-aaaa" }),
    ev("error", { text: "OAuth refresh failed", session: "01a08fb2-aaaa" }),
  ];

  assert.match(withStore(events, ["extract"]), /skipped 01a08fb2: no conversation/);
});
