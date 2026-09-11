# com.socrates/

Reverse-domain namespace for client-specific extras.

Agent Plugins v1 standardises exactly two component types — skills and MCP
servers. Anything harness-specific is supposed to live in a namespace directory
named after a reverse-domain identifier the owner controls, so that clients
which do not implement the namespace ignore it and portability is preserved.

This directory is the escape hatch. Nothing here should ever be required for the
portable core to work.

## What belongs here

Per-harness hooks and glue:

```
com.socrates/
  pi/          Pi extension (Pi has no native MCP, so it needs a bridge)
  claude/      hooks.json for Claude Code's SessionEnd / PreToolUse
  codex/       whatever Codex stabilises on
```

Each client reads only its own namespace folder. Adding one must not change how
any other client loads the plugin.

## pi/

The Pi side of the plugin. Pi has no MCP, so the portable surfaces reach it as
skills that shell out to the `socrates` CLI; this adds the two things Pi can do
natively and the portable format cannot express.

```
pi/index.ts        registered by the `pi.extensions` field in plugin/package.json
```

| | |
| --- | --- |
| `/socrates` | status, then `capture` · `learn` · `moments` · `open` |
| `@plugin:socrates <words>` | the same request, routed to the skill |

It adds no logic of its own — every branch shells out to `socrates …` and renders
the JSON, so the CLI stays the single implementation. A missing `socrates` on
`PATH` is reported with the symlink that fixes it, not swallowed.

The `@` handle is a rewrite, not a second mechanism: Pi already owns `@` for file
search, so the extension contributes one autocomplete entry and transforms the
text into an instruction for the skill. If Pi changes any of this, delete the
file — nothing portable depends on it.

## Before adding anything here

Ask whether it is actually needed. Hooks are the least portable and most
breakage-prone part of the whole design, and the plan is for them to be
*enrichment*, never load-bearing. Transcript ingestion and the skill + MCP
surfaces should already cover the base case.

`SOCRATES_NS` is not settled — pick a domain we actually control before shipping
anything public under this name.
