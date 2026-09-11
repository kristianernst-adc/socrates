# The taste model

Reference for the `update-taste` skill. Not required reading for normal use.

## Why two record types

A single record type tempts the system into storing a model's paraphrase of the
user as if it were the user's own position. Once that happens, you can no longer
tell the difference between "they said this" and "we assumed this", and the
preference store slowly drifts away from the person it is supposed to represent.

So:

| Record | Written by | Trust | Mutable |
| --- | --- | --- | --- |
| `feedback` | the agent, quoting the user | ground truth | no, append-only |
| `statement` | the fold | derived, reviewable | status only |

Every statement carries `support[]`, the feedback ids that produced it. If a
statement looks wrong, you can always read the reactions behind it.

## Storage

Under the data root (`socrates home` prints it):

```
taste/
  feedback.jsonl     append-only, one record per line
  statements.jsonl   append-only; latest record per id wins
  TASTE.md           generated, do not edit by hand
```

Statements are rewritten by appending a new line with the same `id`, so the file
survives a crash mid-write and keeps a history of how a preference evolved.

## Feedback fields

Required: `polarity`, `about`, `statement`.

| Field | Notes |
| --- | --- |
| `polarity` | `prefer` or `avoid` |
| `about` | short subject line — what this is about |
| `statement` | the preference as one actionable rule |
| `rationale` | why, in the user's words where possible |
| `evidence` | the concrete file, diff, command or commit |
| `intensity` | 1–3, how strongly they felt it |
| `scope` | see below |
| `source` | `user` or `inferred` |
| `tags` | free-form, used for filtering |
| `capturedBy` | harness, model, session, cwd — filled in automatically where known |

## Scope

Scope is the difference between a useful preference store and a pile of
unfalsifiable generalisations. Four levels, plus an escape hatch:

| Level | Applies to | Example |
| --- | --- | --- |
| `global` | everything, always | "Commit subjects are imperative and terse" |
| `language` | one language | "No `any` in exported TypeScript signatures" |
| `repo` | one repository | "This repo vendors its binaries; don't add lockfiles" |
| `task` | one kind of work | "For refactors, keep the diff mechanical and separate from behaviour changes" |
| `one-off` | this piece of work only | "Use the staging bucket for this deploy" |

`one-off` statements are recorded and shown, but should not be enforced. They
exist so the agent can be honest about weak evidence instead of either dropping
the signal or over-claiming.

## Confidence

Deliberately crude, and good enough to start:

```
confidence = clamp(0.35 + 0.15 * (observations - 1) + (source == "user" ? 0.25 : 0), 0, 0.95)
```

A single inferred statement starts at 0.35 and lands in *Pending confirmation*. A
single statement the user stated outright starts at 0.60 and is active
immediately. Repetition is what builds confidence.

## Conflicts

Opposite polarity, same subject line, same scope level is treated as a
conflict. Both statements are marked `conflictsWith` and surfaced in a Contested
section of `TASTE.md`.

The only automatic resolution is this: if the user restates one side directly,
that side wins and the conflict is cleared. Everything else is for the human to
decide. Silent resolution would be a bug, not a feature.

**This is a placeholder.** Real conflicts arrive as paraphrases — "keep commits
and terse" versus "write descriptive commit messages" — and string matching on
the subject line will miss most of them. Detecting conflicts properly is an
inference-layer job: either the agent records an explicit `conflictsWith` when it
notices the contradiction, or a scheduled pass looks for contradictions across
the store. Until then, treat Contested as a hint rather than a guarantee.

## Compilation

`TASTE.md` is grouped by scope, ordered widest to narrowest, sorted by
confidence within a group. It is intended to be small — a handful of lines the
agent can read on every turn, not a document. If it grows past roughly a screen,
that is a signal that too much has been recorded at `global` scope.

## Still undesigned

Called out honestly rather than guessed at:

- **Decay.** Preferences should probably weaken if never reconfirmed. No
  mechanism yet.
- **Merge.** Two statements that say nearly the same thing in different words
  stay separate. Fuzzy matching, or letting the model propose merges, is an open
  question.
- **Conflict detection.** Currently string matching on the subject line. Needs
  semantic comparison, and probably an explicit `conflictsWith` field the agent
  can set when it spots a contradiction.
- **Pruning.** Nothing currently moves low-confidence statements to `retired`.
- **Per-project scope keys.** `repo` currently matches a free-form string.
  Should probably normalise against git remote or the cwd slug that harnesses
  already use.
- **Sharing.** Two of us sharing a store is attractive and may be impossible if
  transcripts are not shareable. Unresolved.
- **Prompt injection surface.** `TASTE.md` ends up in a system prompt. Statements
  must stay short, human-readable and clearly user-authored.
