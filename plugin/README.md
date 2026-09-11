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
    update-taste/
      SKILL.md
      references/taste-model.md
  bin/
    socrates           CLI — the automation surface
    socrates-mcp       stdio MCP server — the portable tool surface
  lib/
    store.mjs          data root resolution + JSONL + the append-only fold
    taste.mjs          the taste model
    model.mjs          the capture model (events, moments)
  test/
    capture.test.mjs   zero-dep tests: node --test plugin/test/*.test.mjs
  com.socrates/        reverse-domain namespace for per-harness extras
```

`bin/` and `lib/` are not spec-defined locations. The spec allows any additional
files and directories alongside the component locations, and the containment
rules only apply to paths the plugin *declares*.

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

```bash
# record a preference
echo '{"polarity":"avoid","about":"code comments","statement":"Avoid restating what the code already says","source":"user"}' \
  | plugin/bin/socrates taste add

plugin/bin/socrates taste compile
cat ~/.socrates/taste/TASTE.md

# exercise the MCP server by hand
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | plugin/bin/socrates-mcp
```

## Status

`plugin.json`, `mcp.json`, and the skill are the real shell. Capture and taste
both have a working data model and store; neither has an engine yet.

Done:

- taste: feedback → statements → `TASTE.md`, plus the `update-taste` skill
- capture: the event and moment records, their schemas, and `moments add|list|dismiss`

Not done yet:

- reading the transcripts (`socrates capture`) — the ingest side of the other half
- packet generation and the `extract-moments` skill
- per-harness hooks under `com.socrates/`
- wiring `TASTE.md` into a system prompt, or a skill that reads it
- the scheduled jobs that will keep taste fresh without being asked

See [../phase-1-capture.md](../phase-1-capture.md) for the capture plan.
