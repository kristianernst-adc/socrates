# Socrates

Turns work you already did with coding agents into learning material worth reading.

Not a course, not a dashboard. A feed of small learnings drawn from your own real sessions,
each one pointing back at the conversation that produced it.

- **[design.md](design.md)** — what this is and why. Read this first.
- **[phase-1-capture.md](phase-1-capture.md)** — the plan and current state of the capture phase.

## Status

Phase 1 (capture) works end to end: **one real session in, grounded learning moments out.**

| Works | Not built |
|---|---|
| Pi transcripts → normalized events | redaction |
| one session → a compact, citable digest | cards / HTML output |
| digest → learning moments, via a skill | topic profile, spaced repetition |
| taste model (feedback → preferences) | MCP tools for capture |
| | adapters other than Pi |

## Requirements

**Node 20+ and nothing else.** No `package.json`, no `node_modules`, no build step. This is
deliberate — the plugin has to work from a fresh checkout, and the skill shells out to the
same CLI whether or not anything is installed.

## Layout

```
design.md                product thinking
phase-1-capture.md       the phase plan, kept current with what actually happened
schemas/                 language-neutral JSON Schema contracts
  event.schema.json
  moment.schema.json
  taste.schema.json
plugin/                  the Agent Plugins package — this is the plugin root
  plugin.json            Agent Plugins v1.0.0 manifest
  mcp.json               MCP server declaration
  bin/socrates           the CLI — automation surface
  bin/socrates-mcp       stdio MCP server — portable tool surface (taste only so far)
  bin/socrates-nightly   the unattended pipeline — see "Running extraction unattended"
  lib/store.mjs          data root resolution, JSONL, the append-only fold
  lib/model.mjs          the capture data model (events, moments)
  lib/pi.mjs             Pi transcript adapter — the only file that knows Pi exists
  lib/capture.mjs        transcript discovery + the events.jsonl rebuild
  lib/digest.mjs         events → the compact text a model reads
  lib/taste.mjs          the taste model
  skills/                discovered at this fixed location by Agent Plugins hosts
    extract-moments/     digest → learning moments
    update-taste/        reactions → durable preferences
  test/                  zero-dependency tests
  com.socrates/          reverse-domain namespace for per-harness extras
.pi/settings.json        registers plugin/ with Pi for local development
```

## Getting started

### 1. The data root

Everything lives in one directory. Resolution order, highest first:

| Level | Set by | Beats |
|---|---|---|
| `SOCRATES_HOME` | environment variable | everything — and it also selects *which* `config.json` is read |
| `config.home` | `~/.socrates/config.json` | `PLUGIN_DATA`, the default |
| `PLUGIN_DATA` | the MCP adapter, for plugin child processes | the default |
| `~/.socrates` | fallback | — |

Check what is in effect at any time:

```bash
plugin/bin/socrates home
```

> **Use a per-command override, never `export`.**
>
> ```bash
> SOCRATES_HOME=$(mktemp -d) plugin/bin/socrates capture   # right: one command
> export SOCRATES_HOME=$(mktemp -d)                        # wrong: poisons the shell
> ```
>
> An exported `SOCRATES_HOME` silently wins over `~/.socrates` for the rest of the shell
> session, and `[]` from an empty scratch directory looks exactly like "nothing recorded
> yet". This has cost real time. See [Gotchas](#gotchas).

### 2. The CLI on your PATH

The skill shells out to a bare `socrates`, so it needs to resolve. Symlink the nightly runner
too, or you will be calling it by path forever:

```bash
ln -s "$PWD/plugin/bin/socrates" ~/.local/bin/socrates
ln -s "$PWD/plugin/bin/socrates-nightly" ~/.local/bin/socrates-nightly
```

### 3. Register the plugin with Pi

```bash
pi install -l ./plugin      # writes .pi/settings.json, does not copy anything
```

That is already committed, so a fresh clone just needs the project trusted:

```
/trust      # once per project
/reload     # after editing any SKILL.md
```

Then either `/skill:extract-moments` to force-load it, or ask naturally — *"what did I learn
from this session?"* — and the skill description should match.

Pi discovers skills from `plugin/skills/` by convention, so a new skill needs no manifest
change: add `plugin/skills/<name>/SKILL.md` and `/reload`.

## Running it

```bash
node --test plugin/test/*.test.mjs     # 40 tests, no dependencies

plugin/bin/socrates capture            # rebuild events.jsonl from Pi transcripts
plugin/bin/socrates extract --list     # which sessions are in the store
plugin/bin/socrates extract --session latest
plugin/bin/socrates moments list
```

Note the glob: `node --test plugin/test/` (a bare directory) fails on Node 25.

## Running extraction unattended

The first two steps need no model at all, so a scheduler can keep the store fresh for free:

```bash
socrates capture
socrates extract --list
```

The judgement step does need a model, and headless print mode is the way in:

```bash
pi -p --no-session --tools bash \
  "Use the extract-moments skill on the most recent session"
```

| Flag | Why |
|---|---|
| `-p` | print the response and exit — no TUI |
| `--no-session` | keeps this run out of your session list |
| `--tools bash` | gives it the CLI and nothing else |

The whole pipeline ships as one script, so the only thing you add is the schedule:

```bash
plugin/bin/socrates-nightly              # capture -> moments -> cards -> render
plugin/bin/socrates-nightly --no-model   # capture only; no model calls, no cost
plugin/bin/socrates-nightly --dry-run    # print the plan, change nothing
plugin/bin/socrates-nightly -h           # options and environment
```

It resolves `socrates` and `pi` itself instead of trusting `PATH`, logs every run to
`<data root>/nightly.log`, never exports `SOCRATES_HOME`, and runs each model step only when
there is work for it — `extract --pending` (a session with content and no moments yet) and
`moments list --uncarded` (a moment with no card). So a nightly job never re-extracts a session
it already read, which would append a second copy of every moment, and never pays for a no-op
run.

### Scheduling it

On macOS use `launchd`, not cron. Put this at
`~/Library/LaunchAgents/com.socrates.nightly.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.socrates.nightly</string>
  <key>ProgramArguments</key>
  <array><string>/Users/you/src/socrates/plugin/bin/socrates-nightly</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>SOCRATES_PROJECT_DIR</key><string>/Users/you/src/socrates</string>
  </dict>
  <key>StandardOutPath</key><string>/tmp/socrates-nightly.out</string>
  <key>StandardErrorPath</key><string>/tmp/socrates-nightly.err</string>
</dict>
</plist>
```

```bash
launchctl load -w ~/Library/LaunchAgents/com.socrates.nightly.plist
launchctl kickstart -p gui/$(id -u)/com.socrates.nightly   # fire it now, to prove it works
launchctl unload -w ~/Library/LaunchAgents/com.socrates.nightly.plist   # off again
```

The run's own log is `<data root>/nightly.log` either way; the plist paths only catch what
happens before the script starts. `kickstart` matters because a 3am job is otherwise only
observable the morning after — do not schedule something you have never seen run.

Both `EnvironmentVariables` entries are load-bearing, and both are easy to miss. launchd
starts the job with roughly `PATH=/usr/bin:/bin`, where Homebrew's `node` does not exist, so
without the first the script exits 127 having done nothing. Without the second it runs from
`$HOME`, where a locally-registered plugin is not visible — see below. Adjust both paths.

cron works too, but on macOS it is deprecated and needs **Full Disk Access** granted to
`/usr/sbin/cron` in System Settings → Privacy & Security. Without it cron cannot read `~/.pi`
or `~/.socrates`, and the job appears to run while silently doing nothing:

```cron
30 3 * * *  $HOME/src/socrates/plugin/bin/socrates-nightly
```

Two environment gaps apply to either scheduler, and the plist above closes both. A scheduled
process gets a minimal `PATH`, so if `node` or `pi` live outside `/usr/bin:/bin`, say so:

```cron
PATH=/opt/homebrew/bin:/usr/bin:/bin
30 3 * * *  $HOME/src/socrates/plugin/bin/socrates-nightly
```

And the plugin has to be discoverable. If you registered it locally (`pi install -l ./plugin`)
rather than globally, the job starts in the wrong directory — point the script at the project,
which both registers the skills and gives the run the right `cwd`:

```cron
30 3 * * *  SOCRATES_PROJECT_DIR=$HOME/src/socrates $HOME/src/socrates/plugin/bin/socrates-nightly
```

A full run costs two model calls, and only on nights with new work — both steps are skipped
when nothing is pending. For a free nightly run that just keeps the store and the html fresh,
use `--no-model` in place of the bare script above.

**Why `latest` is right here and wrong in a session.** Inside a session, `--session latest`
resolves to the half-finished conversation you are in. After it ends — or on a schedule —
`latest` resolves to a *completed* session, which is exactly what you want to extract. So
unattended extraction is not only about not blocking you; it is what makes the default
session selector correct.

**Trust is the other catch, and it fails silently.** Project-local resources — including this
plugin's skills — load only when the project is trusted, and `-p` never shows a trust prompt.
With the default `defaultProjectTrust: "ask"`, a non-interactive run *ignores* them. On a
machine with no saved `~/.pi/agent/trust.json` entry, the run does not error: it simply has no
`extract-moments` to use, and you get a strange model answer instead. `socrates-nightly`
passes `--approve` so it does not depend on ambient state. Check what a run can see with:

```bash
printf '%s\n' '{"type":"get_commands","id":1}' | pi --mode rpc --approve \
  | grep -o 'skill:[a-z-]*'
```

Without `--approve` that reports only your user-level skills; with it, the plugin's appear.

**Auth is the catch.** A headless run needs credentials that work non-interactively. An
OAuth provider whose refresh token has expired fails at 3am with nobody watching; a static
API key does not. Use `pi --provider <p> --model <m>` to override the model for one run
without changing your interactive default.

**Watch the model.** This runs on whatever `defaultProvider`/`defaultModel` are set to, at
3am, with no one reading the output. A model that is fine for extraction and cheap is a
better default here than the most capable one. Check `~/.pi/agent/settings.json`.

## The store

```
~/.socrates/
  config.json      optional; can pin `home`
  events.jsonl     every captured event, rebuilt from scratch by `capture`
  moments.jsonl    the extracted learning moments
  taste/
    feedback.jsonl   what the user actually said — ground truth, never inferred
    statements.jsonl derived preferences, the things that get compiled
    TASTE.md         the compiled instruction block
```

All JSONL, append-only, greppable, diffable. No database, no server.

## Conventions

These are load-bearing. Breaking one usually means losing a property that is hard to get back.

- **Append-only, fold on read.** A correction is a new record with the same `id`;
  `readLatestById` keeps the last. Nothing is mutated in place, which is what keeps the
  feedback history usable as an eval set.
- **Normalizers are the validation boundary.** `normalizeEvent` / `normalizeMoment` in
  `lib/model.mjs` narrow untrusted input (a model, a skill, stdin) to known fields. The JSON
  Schemas in `schemas/` are the language-neutral contract for other languages and for review —
  they are *not* the runtime validator, so they must be kept in sync by hand.
- **No dependencies and no build step.** Both surfaces must run from a fresh checkout.
- **Event ids are derived from content** (`ev_<session>_<entryId>_<block>`), never from a byte
  offset. That is what makes re-ingesting idempotent by construction rather than a dedupe pass.
- **Harness vocabulary stops at the adapter boundary.** Upstream Pi field names may appear only
  inside `event.source`. There is a test for this.
- **Evidence must be something the user actually saw.** This is why `assistant_thinking` is
  captured but never rendered in the digest: the user never read it, so it cannot be evidence
  of what they do not understand.
- **Prefer fewer moments.** Zero is a valid answer. A moment with no evidence is refused.

## Gotchas

Things that have already cost time here.

- **A stale exported `SOCRATES_HOME`.** `moments list` prints `[]` and looks like an empty
  store. Empty lists now name the file they read and the override that diverted them, on
  stderr so `--format json` stays pipeable.
- **`PLUGIN_DATA` diverts the store when the MCP server runs.** The adapter sets it for plugin
  child processes, and it outranks the `~/.socrates` default — so the MCP server and the CLI
  would read *different stores* with no visible difference. Pinning
  `~/.socrates/config.json` to `{"home": "/absolute/path"}` fixes it, because `config.home`
  outranks `PLUGIN_DATA`. It does **not** protect against a stale `SOCRATES_HOME`.
- **`capture` is a full rebuild, not an incremental append.** No cursors, no offsets, nothing to
  go stale while Pi is still writing. Idempotency is assertable (`capture` twice → byte-identical
  file). Ceiling is somewhere in the hundreds of MB; that is when cursors come back.
- **Capture is self-referential.** The store contains the session you are testing from, so
  grepping `events.jsonl` for a string can match merely because you grepped for it. Verify by
  the `id` field, never a substring.
- **`--session latest` is always the session you are currently in**, since the store is rebuilt
  from disk. Extracting it means extracting a half-finished conversation.
- **`write` and `edit` arguments inline entire files** into the transcript, so the event store is
  effectively a second copy of the repo. Harmless locally; it is why redaction has to land
  before anything is shared.

## Troubleshooting

```bash
socrates home              # where is the store, really
env | grep SOCRATES        # is something overriding it
socrates extract --list    # which sessions were captured
```

`moments list` shows nothing →
either the store is genuinely empty, or `SOCRATES_HOME` is stale. The stderr note tells you
which; if you see no note at all, the list was not empty.
