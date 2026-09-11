---
name: extract-moments
description: Turn a past coding session into learning moments — small, grounded things the user encountered but may not fully understand, each pointing back at the real conversation that produced it. Use when the user asks what they learned from a session, asks to review or revisit past work for understanding, asks what they keep asking about, or asks to turn a session into something worth reading. Also use when explicitly asked to extract moments. Keywords - what did I learn, learn from this session, review my sessions, what should I know, learning moment, did I understand, explain what I missed, learning card, revisit, go over what we did.
license: MIT
metadata:
  version: "0.1.0"
  component: capture
---

# Extract moments

The point is not to summarise a session. A summary tells the user what happened, which they
already know — they were there. A **moment** is one thing they encountered that is worth
understanding better, grounded in the actual conversation.

The failure mode is producing a book report. If the output reads like a changelog, it failed.

## Steps

1. **Pick the session.** If the user named one, match it. If not, take the newest one that
   has not been extracted yet:

   ```bash
   socrates extract --pending
   ```

   **If nothing is pending, say so and stop.** Re-extracting a session that already produced
   moments does not improve them — it appends a second copy, because moment ids are random.
   `socrates extract --list` shows every session with a `new`/`done` column if you need to
   see what has been covered. Only re-extract a finished session when the user asks for that
   session specifically.

2. **Get the digest.**

   ```bash
   socrates extract --session <id>
   ```

   The digest is the whole conversation, capped. Read it. Do not chase the raw transcript —
   if the digest is missing something you need, say so rather than working around it.

3. **Look for gaps in the *user's* understanding.** Not what happened; where they showed
   they were on unfamiliar ground. The strongest evidence:

   | Look for | Reads like |
   |---|---|
   | They asked the agent to explain something | "what is X", "how do I Y", "why does Z work" |
   | They asked the same thing more than once | a repeat within the session, or across sessions |
   | They asked something far below the level of the work | encyclopedic questions asked of a coding agent |
   | They accepted a large change without asking anything | a big tool-written diff and no follow-up |
   | They corrected themselves or the agent on the same topic twice | "no, actually…" |
   | They copied a command with flags they never discussed | a long command run once, unexplained |

   The user asking a question is evidence of *curiosity*, not proof of a gap. Set
   `confidence` honestly — a direct "how do I X" is stronger than a silent acceptance.

4. **Test each candidate before writing it.** A moment has to pass all four:

   - **Grounded** — it points at specific events in the digest, with a quote
   - **Specific** — "Lambda has no native Batch event source; EventBridge closes the loop",
     not "learn more about AWS"
   - **Falsifiable by the user** — they can read it and say "no, I know that"
   - **Not already obvious from the session** — if the agent explained it plainly and they
     said "got it", there is no gap

5. **Prefer few.** One to three good moments. Five is almost always padding. **Zero is a
   valid answer** — if the session was routine, say so and record nothing. Do not manufacture
   a moment to have something to show.

6. **Write each one.** Every claim must cite an event id that appears in the digest, and the
   quote must be verbatim from the digest.

   ```bash
   socrates moments add --json '{
     "kind": "concept_encountered",
     "title": "Lambda and Batch have no native event source — EventBridge closes the loop",
     "summary": "The user asked how to connect Lambda to Batch. The answer has two directions that both need wiring: Lambda submits the job through the Batch API, and completion comes back as an EventBridge event, not a callback. There is no built-in Lambda-to-Batch trigger.",
     "why": "They asked the question open-endedly rather than arriving with a plan, and the answer's structure — that both directions must be wired separately — is the part most people miss.",
     "confidence": 0.6,
     "basis": ["explain_request"],
     "evidence": [
       { "events": ["ev_01a08fe7_769e5c70_0"], "quote": "how do i connect lambda to batch?", "kind": "user_message" }
     ],
     "topics": ["aws", "lambda", "batch"],
     "concepts": [{ "name": "EventBridge as the completion path", "role": "central" }],
     "origin": { "sessionId": "01a08fe7-5ec2-703e-a8ea-dfc8e89f244d", "harness": "pi", "fidelity": "full" },
     "capturedBy": { "by": "skill:extract-moments", "version": 1 }
   }'
   ```

   Two fields worth getting right:

   - **`kind`** — `concept_encountered` (a topic they met), `pattern_used` (an approach they
     used without discussion), `tool_without_comprehension` (a command whose flags were never
     explained), `mistake_made` (they got something wrong), `user_correction` (they corrected
     the agent), `repeated_question`, `agent_explained` (the agent explained and it landed),
     `unresolved_question` (they asked and it was never really answered).
   - **`why`** — the reasoning about the *gap*, not a restatement of the summary. If this field
     could be deleted without losing anything, it is wrong.

7. **Confirm briefly.** One line per moment: the title and what it points at. Do not lecture
   the user about their own gaps or explain the concepts back at them — the moment is the
   artifact, this is just a receipt.

## Guardrails

- **Never cite an event id that is not in the digest.** Every id is printed on the left of
  its own line. If you cannot point at a line, there is no moment.
- **Never paraphrase into the `quote` field.** It must be findable verbatim in the digest.
  Quotes are how the user checks you.
- **Never extract a session that is already `done`** unless the user named it. The second
  pass duplicates the first.
- **Never invent a topic the session did not cover.** No "you should also learn X".
- **Never write a moment about the agent's own mistakes.** That is a different product. The
  subject is what the user does not know.
- **Do not write generic advice.** "Consider learning more about serverless" is not a moment.
- **Do not treat a question as a confession.** Asking "what is AWS" is a reasonable thing to
  do at any level of experience. Low confidence is usually the honest answer.
- **Do not record secrets, customer names or credentials.** Quote code and commands, not
  values.
- **Report nothing rather than reaching.** A session where the user knew what they were doing
  is not a failure of the extraction; manufacturing a gap is.

## Reference

The record fields, the kind vocabulary and the confidence scale live in
`schemas/moment.schema.json`. The digest format and its caps are in `plugin/lib/digest.mjs`.
