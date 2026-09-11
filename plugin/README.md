# plugin/

The Agent Plugins package. `plugin/` **is** the plugin root — everything the
specification cares about is relative to this directory.

Conformant to [Agent Plugins v1.0.0](https://agent-plugins.org/specification):
`plugin.json` manifest, `skills/` discovered at the fixed location, `mcp.json`
for the MCP server.

## Layout

```
plugin/
  plugin.json          manifest (@schema, name, metadata only — no component paths)
  mcp.json             MCP server declaration
  skills/              fixed discovery location
    capture-sessions/  read harness transcripts into a normalised event log
    update-taste/      personalization: turn a reaction into a durable preference
    extract-moments/   turn events into moments, each citing the events it came from
    generate-learning/ write a page, grounded in a session
      references/design-system.md   interactivity rules, mood workflow
    benji-taste/       the visual reference (vendored, see note below)
  bin/
    socrates           CLI — the automation surface
    socrates-mcp       stdio MCP server — the portable tool surface
  lib/
    store.mjs          data root resolution, JSONL, ids
    model.mjs          the event and moment models (the validation boundary)
    capture.mjs        three transcript adapters + incremental loading
    digest.mjs         a readable, event-id-citing digest of a session
    page.mjs           a page is a title plus html
    render.mjs         the board. no component library
    taste.mjs          preferences
    mood.mjs           web visual references
    page.mjs           learning pages
    mood.mjs           web visual references
    render.mjs         deterministic html (pages, index, mood board)
    model.mjs          the capture model (events, moments)
    pi.mjs             Pi transcript adapter — the only file that knows Pi exists
    capture.mjs        transcript discovery + the events.jsonl rebuild
    digest.mjs         events -> the compact text a model reads
  test/
    capture.test.mjs   store + model + CLI
    pi.test.mjs        adapter + capture rebuild
    digest.test.mjs    digest rendering + extract
                       run: ./test/smoke.sh
  com.socrates/        reverse-domain namespace for per-harness extras
```

`bin/` and `lib/` are not spec-defined locations. The spec allows any additional
files and directories alongside the component locations, and the containment
rules only apply to paths the plugin *declares*.

### vendored skills

`skills/benji-taste/` is a copy of an external, unofficial public-source
synthesis of Benji Taylor's UI work. It is vendored because it is the visual
reference and needs to travel with the plugin. It is not ours, it is not endorsed
by its subject, and it should be re-synced from source rather than edited here.
The adaptation notes that make it apply to static documents live in
`generate-learning/references/design-system.md`.

## Two surfaces, deliberately

| Surface | Who uses it | Why |
| --- | --- | --- |
| Skill + CLI | any harness, including ones with neither MCP nor hooks (Pi) | boring, robust, works today |
| MCP server | MCP-capable clients (Claude Code, Codex, Copilot, Cursor, Gemini) | structured tool calls, no shell quoting |

Both drive the same `lib/` code and the same JSONL store, so they cannot drift.

The CLI is also the automation surface — the cron-like jobs we want later call
`socrates …`, not the skill.

## Install

The spec deliberately does not define installation; each client discovers and
installs plugins its own way. Options, roughly in order of how much we should
trust them:

- **Development:** point the harness at this directory directly. In Pi, a local
  path install works and hot-reloads.
- **Pinned git ref:** once the repo is public, install from a tag or commit
  rather than a branch. Plugin code runs with the user's full permissions.
- **Via a compiler:** [sigilco/agentplugins](https://github.com/sigilco/agentplugins)
  emits per-harness artefacts from one manifest. Worth adopting once we need more
  than skills + MCP.

## Configure the data root

Resolution order, highest first:

1. `SOCRATES_HOME`
2. `home` in `<config dir>/config.json`
3. `PLUGIN_DATA` injected by the host
4. `~/.socrates`

```jsonc
// ~/.socrates/config.json
{ "home": "/Users/you/Documents/socrates" }
```

Check what is in effect:

```bash
plugin/bin/socrates home
```

## Developing

No build step and no dependencies — plain Node ESM, so the skill works in a
fresh checkout.

## Output

Everything a person looks at lives at the top level of the data root, so pointing
at the folder is enough:

```
<home>/
  index.html     the board — every page as a small paper on a surface
  pages/         one hand-written html file per page
  mood.html      the visual reference board
  pages.jsonl    the page records
  taste/         preferences + TASTE.md
  mood/          mood items + downloaded assets
  events/        captured sessions
  state/         ingest cursors
```

Pages are **whatever HTML the model writes**. `page add` takes an `html` field and
writes it out untouched; a fragment gets wrapped in a plain reading shell. There
is no required structure. There is no block vocabulary and no template.

The board gives each paper a stable tilt derived from its id, so nothing moves
around between renders. Hover lifts and wiggles it; click opens the page.
`prefers-reduced-motion` is respected.

## Developing

```bash
# capture sessions (deterministic, no model involved)
plugin/bin/socrates capture --current   # this session
plugin/bin/socrates capture             # sync everything found on disk
plugin/bin/socrates capture list
plugin/bin/socrates capture show <id>   # readable digest

# record a preference
echo '{"polarity":"avoid","about":"code comments","statement":"Avoid restating what the code already says","source":"user"}' \
  | plugin/bin/socrates taste add

plugin/bin/socrates taste compile
cat ~/.socrates/taste/TASTE.md

# author and render a learning page (normally done via the skill)
plugin/bin/socrates page add --json "$(cat page.json)"
plugin/bin/socrates render
open "$(plugin/bin/socrates home | python3 -c 'import json,sys;print(json.load(sys.stdin)["home"])')/site/index.html"

# collect a visual reference and see the mood board
plugin/bin/socrates mood add --json '{"url":"https://example.com","image":"https://example.com/x.jpg","steal":"Labels outside the code block"}'
plugin/bin/socrates mood board

# exercise the MCP server by hand
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | plugin/bin/socrates-mcp
```

Full smoke test, hermetic, 64 checks across all four capabilities:

```bash
./test/smoke.sh          # synthetic fixtures, touches nothing of yours
./test/smoke.sh --real   # also scan the real session directories on disk
```

## Capture

Reads transcripts straight off disk from Pi, Claude Code and Codex. No
cooperation from the harness is needed, which is what makes the plugin portable:
the capture channel is the filesystem, not an API.

| Harness | Location |
| --- | --- |
| Pi | `~/.pi/agent/sessions/` (or `PI_SESSION_DIR`) |
| Claude Code | `~/.claude/projects/` |
| Codex | `~/.codex/sessions/`, `~/.codex/archived_sessions/` |

Each adapter is ~40 lines and disposable. These formats are internal to their
tools and change without warning, so if one breaks, rewrite it and nothing else
moves. Everything downstream sees only normalised events.

### Incremental loading

Two levels, both keyed on the source file:

1. **Unchanged file** — size and mtime match the cursor, so it is never opened.
   A no-op sync over 2,000 sessions takes ~0.12s.
2. **Appended file** — read from the last consumed byte offset and *append* the
   new events. A 51MB rollout that gains one line costs one line, not 51MB.

Session transcripts are append-only, which is what makes (2) safe. Two details
make it correct rather than merely fast:

- **A trailing tool call is held back.** A tool call whose result has not
  arrived yet is buffered in the cursor rather than written, so the result can
  still be folded onto its call when it shows up in a later chunk. Without this,
  appending would leave a tool event and a separate orphan result. If a session
  goes quiet for `SOCRATES_SETTLE_MS` (default 60s), the tail is flushed as-is.
- **A partial trailing line is left alone.** The read stops at the last newline;
  a half-written line is picked up next time.

A cursor entry records the byte offset, the next sequence number, the session
meta, and any held-back events. The file is versioned, so a change to its
meaning invalidates it rather than silently pointing at the wrong output.

### Storage is per source file, not per session

This matters more than it looks. Codex **resumes a session into a new rollout
file that reuses the same `session_id`** — one session, many files. Keying
storage on the session id made later rollouts truncate earlier ones; 53 sessions
in a real corpus were losing data that way.

So each adapter reports both:

- `id` — the source file's own identity (Codex takes `payload.id`, the rollout
  id, not `session_id`)
- `sessionId` — the logical session, shared across resumed rollouts

Storage keys on `id`. If two files still claim the same one, the loser gets a
short path hash rather than overwriting the winner.

Full reads stream in 8MB blocks with a `StringDecoder`, so the previous ~512MB
V8 string ceiling no longer applies — an 894MB rollout that used to be skipped
now captures in about 3 seconds.

Deliberately dropped during normalisation: thinking blocks, Codex `developer`
boilerplate, Claude Code sidechains, image payloads, and tool output past ~2000
characters. Bulk without the moment that matters.

## Status

`plugin.json`, `mcp.json`, and the skills are the real shell. Capture works end to
end; taste has a model and store but no engine behind it yet.

Done:

- taste: feedback → statements → `TASTE.md`, plus the `update-taste` skill
- capture: the event and moment records, their schemas, and `moments add|list|dismiss`
- capture: reading Pi transcripts — `socrates capture` rebuilds `events.jsonl` from every
  session under `~/.pi/agent/sessions` (or `--dir`)
- capture: `socrates extract` renders one session as a compact, citable digest
- capture: the `extract-moments` skill turns a digest into grounded moments
`plugin.json`, `mcp.json`, the skills, and the renderer are real. `lib/` and
`bin/` implement enough to prove the model end to end, not the engine.

Working today: session capture for three harnesses, preferences
(record → fold → compile), learning pages (author → render → review), the
deterministic HTML renderer with four layouts, and the mood board with image
download.

Not done yet:

- dogfooding the loop on our own work (stage 4)
- per-harness hooks under `com.socrates/`
- no compaction of `events/`: retired sources are never pruned from disk
- wiring `TASTE.md` into a system prompt
- the scheduled jobs that keep pages and taste fresh without being asked
- MCP tools for pages, moods and capture (only taste is exposed so far)
- no eval set for page quality, so nothing guards against drift
- typography has not been chosen deliberately; it is the highest-leverage thing
  on the mood board
- `events/` is one file per *source session file*, not month-sharded as design.md sketched
