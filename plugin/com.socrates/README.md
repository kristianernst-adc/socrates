# com.socrates/

Reverse-domain namespace for client-specific extras.

Agent Plugins v1 standardises exactly two component types — skills and MCP
servers. Anything harness-specific is supposed to live in a namespace directory
named after a reverse-domain identifier the owner controls, so that clients
which do not implement the namespace ignore it and portability is preserved.

This directory is the escape hatch. Nothing here should ever be required for the
portable core to work.

## What belongs here

Per-harness hooks and glue, once we get to them:

```
com.socrates/
  pi/          Pi extension (Pi has no native MCP, so it needs a bridge)
  claude/      hooks.json for Claude Code's SessionEnd / PreToolUse
  codex/       whatever Codex stabilises on
```

Each client reads only its own namespace folder. Adding one must not change how
any other client loads the plugin.

## Before adding anything here

Ask whether it is actually needed. Hooks are the least portable and most
breakage-prone part of the whole design, and the plan is for them to be
*enrichment*, never load-bearing. Transcript ingestion and the skill + MCP
surfaces should already cover the base case.

`SOCRATES_NS` is not settled — pick a domain we actually control before shipping
anything public under this name.
