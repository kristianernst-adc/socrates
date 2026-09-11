---
name: update-taste
description: Record what the user liked or disliked about an agent outcome so future work matches their taste. Use when the user reacts to output ("I like this", "don't do that again", "why did you write it that way", "next time use X"), corrects a style or approach, or asks for something to be done differently from now on. Also use to review or retire recorded preferences. Keywords - preference, taste, feedback, liked, disliked, style, house style, convention, "from now on", "next time", "I prefer", "stop doing".
license: MIT
metadata:
  version: "0.1.0"
  component: personalization
---

# Update taste

Turns a passing reaction into a durable preference. The point is that the user
never has to repeat themselves, and that the plugin gets closer to their taste
over time.

## The two records

Everything you capture becomes **feedback**, which folds into **statements**.

- **feedback** — what the user actually said, in their own words. Never
  generalised, never invented. This is the ground truth.
- **statement** — one actionable rule, derived from one or more feedback
  records. This is what actually gets compiled into instructions the agent
  reads.

You write feedback. The fold produces statements. Do not hand-write statements.

## Steps

1. **Get the exact reaction.** Quote the user. If their words are ambiguous,
   ask one short question rather than guessing — `About: "the migration script
   you wrote" — was it the structure or the commenting style?`

2. **Find the concrete evidence.** Point at the real thing: the file path, the
   diff hunk, the command, the commit. A preference with no evidence cannot be
   checked later and should not be recorded.

3. **Decide polarity.**
   - `prefer` — they want more of this.
   - `avoid` — they want less of this.

4. **Write one statement, phrased as a rule.**
   - For `prefer`, phrase it as the instruction: `Keep migration scripts split
     into one file per step`
   - For `avoid`, phrase it as the anti-pattern itself: `Multi-paragraph
     narrative commit bodies`
   - Bad: `The user liked the migration script` (describes a reaction, not a rule)
   - Bad: `Be better` (not actionable)

5. **Decide scope honestly.** Default to the narrowest scope the evidence
   supports. Widening scope without evidence is how this feature becomes noise.
   - `global` — they said it applies everywhere, or it is clearly about how they
     like to work
   - `language`, `repo`, `task` — the evidence is specific to one of these
   - `one-off` — true for this piece of work only; recorded but not enforced

6. **Set source honestly.** This one matters:
   - `user` — the user stated it as a general rule, in those words. It becomes
     active immediately.
   - `inferred` — you generalised from one reaction. It lands in *Pending
     confirmation* until the user agrees.

   If you are not sure, use `inferred`. Over-claiming here is the main failure
   mode of this skill.

7. **Record it.**

   ```bash
   socrates taste add --json '{
     "polarity": "prefer",
     "about": "commit message style in this repo",
     "statement": "Keep commit subjects terse and imperative",
     "rationale": "user said the previous ones were too wordy",
     "evidence": "commit 4f2a1c9",
     "scope": { "level": "repo", "match": { "repo": "toolbox/socrates" } },
     "source": "inferred",
     "tags": ["git", "communication"]
   }'
   ```

   Then regenerate the compiled block:

   ```bash
   socrates taste compile
   ```

8. **Confirm briefly.** One line: what you recorded, and whether it is active or
   pending. Do not lecture the user about their own preference.

## Reviewing and correcting

```bash
socrates taste list --status proposed          # what needs confirming
socrates taste list --level repo               # scoped to a repo
socrates taste retire <statement-id>           # wrong or no longer true
```

If the user says "yes, always do that" about something in Pending confirmation,
re-record it with `source: "user"`. That promotes it to active.

## Guardrails

- **Never invent a preference.** If the user did not react, there is nothing to
  record. Silence is not approval.
- **Never widen scope on your own.** One reaction in one file is not a global
  rule. When unsure, `one-off` exists precisely so you can record without
  over-committing.
- **Do not record transient task state.** "Use the staging bucket for this
  deploy" is not taste.
- **Do not overwrite history.** Feedback records are append-only; corrections
  are new records. Retiring is a status change, not a deletion.
- **Do not record secrets or customer data** in `about`, `rationale` or
  `evidence`. Quote code, not credentials.
- **Contradictions are information, not errors.** If new feedback opposes an
  existing statement, record it and tell the user you have a conflict to
  resolve. Do not silently pick a winner.

## Reference

`references/taste-model.md` — the record fields, scope semantics, confidence and
conflict handling, and what is still undesigned.
