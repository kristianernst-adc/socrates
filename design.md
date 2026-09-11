# Socrates — Design Notes

*Status: early thinking. Direction, not specification.*

## The problem

We ship a lot, and we ship fast, because agents do more of the work than they used to.
The side effect is that work happens without understanding accumulating. We use tools,
patterns and abstractions we never sat down and learned, and we rarely notice the gaps
until something breaks in a way we can't reason about.

Socrates is the missing feedback loop: take the work we already did, infer what we
probably don't understand well, and turn it into learning material worth actually
reading.

Not a course. Not a dashboard of metrics. A feed of small, grounded learnings drawn
from our own real sessions.

## Principles

- **Learning material must be grounded in real work.** A card should point at the actual
  diff, command or conversation that produced it. Generic "10 things to know about X"
  content is worthless.
- **Zero ceremony beats completeness.** If using it requires changing how we work, it
  will be abandoned by week three.
- **Everything is a file.** Append-only JSONL, greppable, diffable, portable. No database,
  no server, no account.
- **Local by default.** Transcripts contain client code, secrets and half-finished
  thinking. Nothing leaves the machine unless explicitly opted in.
- **Degrade honestly.** Different harnesses expose different things. We should be loud
  about what we can and can't see, rather than silently producing thinner output.
- **The user's judgement is the label.** "Knew this / new to me / boring" is the training
  signal. The system improves by being corrected, not by being clever.

## Harness agnosticism — what we found

There are several "open plugin" efforts in flight. The relevant ones:

- **[Agent Plugins v1.0.0](https://agent-plugins.org/specification)** — the closest thing
  to a real standard. Vendor-neutral, governed by a TSC with maintainers from Amazon,
  Cursor, Microsoft, OpenAI, Vercel and Google. But it is deliberately small: it
  standardises **skills and MCP servers only**. Commands, hooks, agents and rules are
  explicitly out of scope until those formats converge, and are supposed to live in
  reverse-domain escape hatches (`com.example.client/`).
- **Agent Skills** (`SKILL.md`) — the portable instruction layer, and the piece with the
  widest real adoption. Pi, Claude Code, Codex, OpenCode, Copilot and Gemini all read it.
- **MCP** — the portable *tool* layer. Well supported almost everywhere.
- **Hooks** — the non-portable part. There is no cross-harness hook contract yet.
  [HCP](https://github.com/khimaros/hcp-spec) is the most serious attempt (a subprocess
  contract, stdin JSON → stdout JSONL, with `pi-evolve` and `opencode-evolve` hosts
  already existing). Worth watching, probably not worth betting on yet.
- **Compilers** like [sigilco/agentplugins](https://github.com/sigilco/agentplugins) take
  one manifest and emit per-harness artefacts. Useful as a reference for how to structure
  adapters, and possibly as our packaging step later.

### The conclusion that matters

**Don't pick one integration point. Layer three, and let each fail independently.**

1. **Transcript files on disk.** The baseline capture channel, and the only one that
   requires no cooperation from the harness. Pi writes session JSONL, Claude Code writes
   `~/.claude/projects/**/*.jsonl`, Codex writes rollouts under `~/.codex/`. This is what
   gets us to "works everywhere" on day one.
   The cost: these formats are internal and change without notice. Claude Code says so
   explicitly in its own docs. So parsing must be isolated behind adapters that can be
   rewritten in an afternoon, and we should never let a raw harness record shape leak
   into our own model.
2. **A portable instruction + tool surface** — a skill plus an MCP server, shipped as an
   Agent Plugins package. This is how the agent learns that Socrates exists, and how it
   can voluntarily record something worth remembering, ask a question, or pull up prior
   learnings mid-task.
3. **Per-harness hooks, as an optional enrichment.** Automatic end-of-session capture,
   nudges, "you just hit this concept for the fourth time". Nice, not load-bearing.
   Goes in reverse-domain namespace directories so it never breaks portability.

### Practical wrinkles

- **Pi has no built-in MCP.** This is an explicit design choice upstream. So for Pi we
  either bundle a small bridge extension or rely on transcript ingestion plus a skill.
  Several community bridges exist and are simple enough to vendor or write ourselves.
- **We are not the first to call a CLI from a skill.** That is the boring, robust path,
  and it means the same core works even in a harness with neither MCP nor hooks.
- **A generic ingest command is our escape hatch.** `socrates ingest --stdin` means any
  tool, any language, any future harness can feed us. That is what makes the agnosticism
  claim true rather than aspirational.

## Architecture

Three parts, loosely coupled. The middle one is the product; the others are plumbing.

```
   capture                 core                    surface
┌────────────┐      ┌──────────────────┐      ┌──────────────┐
│  ingest    │─────▶│  normalize       │─────▶│  render      │
│  adapters  │      │  extract         │      │  browse      │
│            │      │  profile         │      │  review      │
└────────────┘      │  generate        │      └──────────────┘
 transcript files   └──────────────────┘      static HTML now,
 hooks                    │                  board later
 MCP tools                ▼
                    JSONL store
```

- **Capture** — reads sessions (and later, live hook events) and converts them into one
  normalized event stream. Harness-specific knowledge lives only here.
- **Core** — extraction, inference, generation, storage. Harness-agnostic by construction.
- **Surface** — the HTML output today, whatever the board becomes later.

The important discipline is that **harness knowledge stops at the adapter boundary**.

## The folder and the knowledge system

A single configurable root (default `~/.socrates/`). Everything readable, everything
inspectable, nothing hidden in a binary format.

```
~/.socrates/
  config.json          what to watch, which models, privacy rules
  events/              normalized, append-only, sharded by month
  moments.jsonl        extracted learning moments — the atomic unit
  cards/               the things a human actually reads
  profile/             the model of what we know and don't
  state/               ingest cursors, dedupe, spaced-repetition state
  site/                rendered output
```

The data model is a funnel, and each stage should be individually useful:

**Events** are raw-ish: a turn, a tool call, a diff, an error, a correction. Cheap to
produce, expensive to read.

**Moments** are the load-bearing abstraction. One moment = one thing that happened which
is worth understanding. A concept encountered, a pattern used, a mistake made, a
correction the user gave the agent, a tool used without comprehension, a question asked
twice. Moments carry provenance — session, cwd, repo, model, and the code or command they
came from — because without provenance we cannot be grounded.

**Cards** are rendered from moments for a human. Short explanation, the real snippet,
a "you could have done this instead", a small exercise or drill, a pointer to deeper
material. One card may draw on several moments.

**Profile** is the aggregate: a topic graph with per-topic signals, and a ranked list of
suspected gaps. This is where personalisation lives and where the whole thing either
becomes genuinely useful or becomes a generic tutorial generator.

### What we can actually infer from

The interesting signal is not "what topics appear". It is behavioural evidence of
uncertainty:

- the user accepts a large, complex agent change without any follow-up
- the same class of question is asked repeatedly across sessions
- the user reverts or hand-corrects agent output
- the user corrects the agent on something the agent got right
- a command is run that the user clearly doesn't understand (flags copied, output
  unread, retries)
- the user asks the agent to explain something it just did — good signal, and the moment
  should be captured verbatim

None of these are certain. They are priors, and the user's feedback should dominate them.

### Feedback loop

Cards get a lightweight reaction: knew it / new to me / useful / not useful. That drives
spaced repetition (simple interval scheduling is enough), and it also becomes the eval
set for extraction quality. Without feedback this is just a random article generator.

## The displayer

Phase one: **static HTML**, generated by the core, readable without a server. The value
is being able to open one file and see today's learnings.

Phase two, if it earns it: something closer to a board — visual, browsable, cards with
thumbnails, grouping by topic, a sense of a collection being built. That suggests cards
should carry a small structured `visual` hint from the start (a diagram sketch, a code
contrast, a before/after) rather than assuming prose. It costs almost nothing now and
avoids a rewrite later.

Deliberately *not* building a web app in phase one. No accounts, no hosting, no
realtime. If the output isn't interesting as static HTML, the board won't save it.

## Open questions

- **Where does inference happen, and how often?** Per session, nightly, on demand?
  Cheapest useful answer is probably a cheap model on a schedule, with an expensive model
  only for cards.
- **How do we avoid being annoying?** The nudge-to-value ratio is the whole product risk.
- **How much of the profile should be visible?** "Here's what we think you don't know"
  is powerful and also easy to get wrong in a way that feels insulting.
- **Is per-user or per-team the default?** Two of us sharing a store is useful for
  comparison but the transcripts may not be shareable at all.
- **Redaction.** This needs to be designed in, not bolted on. Secrets, client names,
  customer data. Probably: local-only by default, a redaction pass before anything is
  kept, and an explicit opt-in for any cloud model.
- **Do we build our own MCP bridge for Pi, or depend on a community one?**

## Working split

Two people, one vertical slice as the first goal: *one real session in, one genuinely
good learning card out.* Everything else is expansion.

**A — the brain (inference and generation)**
Extraction from normalized events into moments; the topic graph and gap inference; card
generation; the eval harness and golden set that keeps quality from drifting. This is the
half with the most uncertainty and the most interesting problems.

**B — the body (capture, storage, surface, packaging)**
The store and config; ingest adapters, starting with Pi; redaction and privacy controls;
the HTML renderer; and the Agent Plugins packaging (skill, MCP server, per-harness
extras). This is the half with the most surface area and the most external churn.

**Shared**
The normalized event schema is the interface between the two halves, so it should be
designed together and frozen early — even if it changes later. Both should dogfood. Both
should contribute to the golden session set, since it doubles as the eval set.

The natural first sequence is: schema → capture Pi sessions → thin extraction → one
rendered card. A and B can work on opposite ends of that immediately, meeting in the
middle at the schema.
