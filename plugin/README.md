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
    generate-learning/ turn real work into a learning card + html
      references/card-model.md      record fields and block types
      references/design-system.md   token contract, layouts, mood workflow
    benji-taste/       the visual reference (vendored, see note below)
  bin/
    socrates           CLI — the automation surface
    socrates-mcp       stdio MCP server — the portable tool surface
  lib/
    store.mjs          data root resolution + JSONL
    capture.mjs        transcript adapters + normalised events
    taste.mjs          preferences
    card.mjs           learning cards
    mood.mjs           web visual references
    render.mjs         deterministic html (cards, index, mood board)
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
  pages/         one hand-written html file per item
  mood.html      the visual reference board
  cards/         the data (cards.jsonl)
  taste/         preferences + TASTE.md
  mood/          mood items + downloaded assets
  events/        captured sessions
  state/         ingest cursors
```

Pages are **whatever HTML the model writes**. `card add` takes an `html` field and
writes it out untouched; a fragment gets wrapped in a plain reading shell. There
is no required structure. The older block vocabulary (`explanation`, `contrast`,
`diagram`, `drill`, …) still works for when composing beats hand-rolling, but it
is an option, not the format.

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

# author and render a learning card (normally done via the skill)
plugin/bin/socrates card add --json "$(cat card.json)"
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

Deliberately dropped during normalisation: thinking blocks, Codex `developer`
boilerplate, Claude Code sidechains, image payloads, and tool output past ~2000
characters. Bulk without the moment that matters.

Sessions over 256MB are skipped with a clear message rather than crashing the
scan. Override with `SOCRATES_MAX_SESSION_BYTES`.

## Status

`plugin.json`, `mcp.json`, the skills, and the renderer are real. `lib/` and
`bin/` implement enough to prove the model end to end, not the engine.

Working today: session capture for three harnesses, preferences
(record → fold → compile), learning cards (author → render → review), the
deterministic HTML renderer with four layouts, and the mood board with image
download.

Not done yet:

- per-harness hooks under `com.socrates/` — capture is pull-based only
- wiring `TASTE.md` into a system prompt
- the scheduled jobs that keep cards and taste fresh without being asked
- MCP tools for cards, moods and capture (only taste is exposed so far)
- no eval set for card quality, so nothing guards against drift
- typography has not been chosen deliberately; it is the highest-leverage thing
  on the mood board
- `events/` is one file per session, not month-sharded as design.md sketched
