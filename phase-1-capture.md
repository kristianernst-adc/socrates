# Phase 1 — Capture

*Companion to [design.md](design.md). POC. The goal is one thing: turn a real conversation into a learning moment.*

## The goal, reduced to its smallest form

```
Pi session file  →  a digest a model can read  →  one grounded moment
```

Not a pipeline. Not an incremental event store. Not a heuristic engine. The only question
phase 1 has to answer is whether a conversation we already had can become something worth
reading. Everything past that is added when something concrete breaks.

**Phase 1 is done when:** from inside a Pi session, one command hands the agent a compact
view of a past conversation, and the agent writes a moment to `moments.jsonl` whose quote
you can find in that transcript.

## Stages

| Stage | What | Done when |
|---|---|---|
| **1** ✅ | `plugin/lib/pi.mjs` (transcript → events) and `socrates capture` (rebuild `events.jsonl`) | capture twice in a row leaves the file byte-identical |
| **2** ✅ | `plugin/lib/digest.mjs` and `socrates extract [--session ID] [--list]` | it prints a real session's conversation, capped, and you can actually read it |
| **3** ✅ | `plugin/skills/extract-moments/SKILL.md` | a real session yields ≥1 moment whose quote is in the transcript |
| **4** | Dogfood on our own work | findings written back into this file |

**Stage 3 is the finish line.** Stages 1 and 2 exist only to feed it.

### First run

On session `01a08fe7` — *"explain who elon musk is"*, *"what is aws."*, *"how do i
connect lambda to batch?"* — a 16-event, 8-minute session that is almost pure question-asking:

- `extract` produced a 2,965-char digest (~740 tokens)
- two moments were written, both `concept_encountered`, at confidence 0.6 and 0.45
- all four evidence ids resolved, and all four quotes were verified verbatim against the
  events they cite

**A false positive worth recording.** "explain who elon musk is" appears twice in that
session, which looks exactly like the `repeat_question` signal from the design doc. It is
not: the first attempt died with an OAuth error and the user simply asked again. The text
was repeated by infrastructure failure, not by uncertainty. Any repeat detector that keys on
message text alone will fire here and be wrong — it has to check whether the first attempt
actually produced an answer. This is the clearest argument yet for keeping signals out of the
first version.

**Rejected candidate.** A `tool_without_comprehension` moment about the AWS service list was
considered and dropped: the agent answered it plainly and the user moved on, so there was no
visible gap. Recording it would have been padding. Two moments from three questions is the
right ratio, and zero would also have been a valid answer.

## Three simplifications

Each deletes a class of bug, not just code.

### 1. Capture is a full rebuild, not an incremental append

No byte offsets, no `cursors.json`, no mtime/inode tracking, no torn-final-line handling, no
month shards, no epochs, no re-ingest-on-shrink. `socrates capture` reads every session file
and rewrites `events.jsonl` from scratch.

Sessions here total a few hundred KB, so this takes milliseconds. The payoff is that
idempotency stops being something to reason about and becomes something to assert:
**run capture twice, the file is byte-identical.** Event ids are derived from content
(`session + entryId + blockIndex`), so a rebuild is stable by construction.

*Ceiling:* this stops being viable somewhere in the hundreds of MB range. That is the
signal to bring back cursors, not before.

### 2. The digest goes to stdout, not to a file

No `packets/` directory, no packet schema, no `--window`, no `scope.truncated`. `socrates
extract` prints the conversation and the skill reads it. A packet was a cache of a
deterministic computation; until something is slow, there is nothing to cache.

### 3. No signals

The twelve heuristic detectors were the most interesting and least proven part of the plan.
They are also unfalsifiable right now, because we have never seen what a model does with a
plain digest. Baseline first, then measure whether signals beat it.

They go to [Later](#later) along with a note on what would justify bringing them back.

## What we are betting on

The digest carries the whole load, so **digest quality is the main risk in the phase**. If a
competent model reading a plain, truncated conversation cannot find one honest moment, then
signals, ranking or a second pass is the fix — and we will know that from Stage 4 output
rather than from argument.

The second bet is that one moment from one session is enough to judge. If a session produces
five candidate moments, that is Stage 4 data, not a reason to build a curator.

## What survives from the original plan

Kept, because removing it would cost more than it saves or would break something already
built:

- **`events.jsonl` persists.** It is what makes `ev_...` evidence pointers resolve, keeps
  `C0` valid, and preserves the material if Pi deletes a session. One file, no shards.
- **The event and moment schemas.** Already written and tested, and they are the contract
  with A's half.
- **The normalizers as the validation boundary.** Untrusted model output still cannot
  inject fields, and a moment still cannot be stored without evidence.
- **The append-only fold.** Corrections append; the latest record for an id wins.

Deleted: cursors and incremental reads, sharding, the packet schema and directory, the
signals module, blobs, active-path/branch filtering, the `state/` directory.

## The Pi adapter (Stage 1)

Grounded in Pi's `docs/session-format.md` (session v3) and verified against real files.

Location: `~/.pi/agent/sessions/--<cwd with / → ->--/<timestamp>_<uuid>.jsonl`, plus
`$PI_SESSION_FILE` when set.

**Discover by globbing, not by folder name.** The slug is lossy — `/a-b/c` and `/a/b-c` both
become `-a-b-c`. Read `cwd` from the `session` header instead.

**Ten entry types plus seven message roles.** Anything unrecognized becomes a `raw` event
rather than being dropped.

**One message block = one event**, sharing an `entryId` and differing by `blockIndex`. This
turns a 40-tool-call assistant turn into addressable pieces instead of one blob.

**Files grow while Pi runs.** A full rebuild sidesteps this entirely — there is no offset to
go stale, so capture is safe to run at any time.

There is no Pi daemon log. The session JSONL *is* the log; `bashExecution` entries carry user
`!` commands with exit codes.

Deliberately not in Stage 1: active-path/branch filtering (sessions here are linear) and
redaction (see [Later](#later)).

## The digest (Stage 2)

The whole quality of the output depends on this, so it gets one job: fit a conversation into
a budget without losing the parts a moment could come from.

### Measured, not guessed

The largest session on this machine — 286 events, one long working session — breaks down as:

| Source | Chars | Note |
|---|---|---|
| `tool_call` args | **158,411** | |
| `tool_result` text | ~95,000 | |
| `assistant_thinking` | 84,348 | 54 events |
| user + assistant text | ~31,000 | the conversation itself |
| tool args capped at 200 each | 15,849 | |

**The plan had this backwards.** I assumed tool *results* were the dominant cost. They are
not: **tool arguments are, and by a wide margin.** A `write` call inlines an entire file and
an `edit` call inlines old and new text, so the transcript contains the codebase twice over.

That changes the recipe. Capping each tool call's args at 200 characters takes the big
session from ~45k tokens to **~5.9k tokens**; dropping tool result bodies alone barely helps
because args are larger.

### The rule

- **cap tool args** (~200 chars). Show args always for `bash`/`edit`/`write`/`read`, and for
  any tool whose args already fit in ~120 chars; otherwise the tool name alone
- **drop tool result bodies**. Keep failures, with exit codes
- truncate user and assistant text (~600 chars)
- **never render `assistant_thinking`**
- print event ids, because they are the citation key a moment's evidence must point at
- print a timestamp only when a pause of 5+ minutes happened — silence is signal

### Why thinking is excluded

This was the first thing cut, and the reason is a principle rather than a budget:

> **Evidence must be something the user actually saw.**

The user never read the agent's thinking. So thinking cannot be evidence of what *they* do
not understand, and a moment grounded in it is unverifiable by the person it is for. The job
is to find gaps in the human's understanding, and the only place those are visible is the
conversation.

It is tempting because it is the most self-aware text in the transcript — it is where the
agent writes "I invented that". But that is the agent noticing its own error, which is a
different product. Thinking is still captured into `events.jsonl`, so it is there if a use
appears; it just does not reach the model as evidence.

### Where it actually landed

| | Chars | ~Tokens |
|---|---|---|
| everything, as captured | 210,643 | 52,661 |
| digest with thinking excluded | **32,310** | **8,078** |
| dropped by excluding thinking | −19,868 | −4,967 |

Composition of the digest now:

| Line type | Share |
|---|---|
| `TOOL` | 53% |
| `ASSISTANT` | 38% |
| `USER` | 6% |
| `FAILED` | 2% |

So a long session costs ~8k tokens, and the remaining bulk is tool calls — which carry real
signal (what was actually run), just verbosely. 56% of the `TOOL` bytes come from commands at
or near the 200-char cap, mostly exploratory `cmd && cmd && echo "=== ===" && cmd` chains.

`CAPS.toolArgs` is one constant if that turns out to be too generous. It was left at 200
because the commands that matter are short anyway and the win is roughly 1k tokens, which is
not worth losing command detail over until Stage 4 says otherwise.

Two known rough edges, left alone until Stage 4 shows they matter:

- `bash` commands containing heredocs or `python3 -c` scripts render as one long line
- event ids cost 12%; shortening them would need the model to assemble ids, which it would
  get wrong. Not worth it

### Also worth noting

`write` and `edit` args put whole file contents into the transcript. That is a privacy
surface as well as a size one, and it is the strongest argument for redaction landing before
the store is ever shared.

### The substance gate

A session with no assistant messages and no tool calls is not worth a model call. `extract`
skips those and says why, rather than emitting an empty digest. On this machine that skips 2
of 4 sessions, both OAuth failures where the user typed `exit`.

This is not the thin end of the signals wedge — it is a "is there a conversation here at
all" check. Note its limit: `hello` → `Hello! How can I help you today?` passes the gate and
still has nothing in it. Catching that needs judgement, so it costs one model call that
returns no moments. That is the correct price.

## The moment (unchanged from C0)

`schemas/moment.schema.json`, with `evidence: [{ events: ["ev_…"], quote }]` required. A
moment without evidence is refused, because the entire premise is that a learning points at
something that actually happened.

`origin.fidelity` stays: a moment from a session where capture lost something says so.

## Later

Ordered by what we would reach for first, with the trigger for each:

| Item | Bring it back when |
|---|---|
| Redaction | before anything leaves the machine, or before a shared store. **The nearest real thing** — a real session here already contains a tool result with a provider OAuth error and a full URL. |
| Signals | Stage 4 output is too generic to be worth reading |
| Incremental cursors | capture takes long enough to notice, or the store passes ~100 MB |
| Active-path filtering | a real session contains a branch and a moment comes from the abandoned half |
| Blobs | truncation is visibly eating evidence a moment needed |
| Packet file + schema | A needs to reproduce or diff a packet offline |
| Event schema versioning, MCP tools for capture, cards, HTML, non-Pi adapters | as their phases arrive |
