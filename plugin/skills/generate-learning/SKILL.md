---
name: generate-learning
description: Turn something that happened during a real coding session into a short, grounded learning card and render it as an HTML file. Use when the user asks to learn from what they just did, to explain something they used without understanding, to turn a session or diff into a lesson, or when evidence suggests a gap worth closing. Keywords - learning, learn, teach me, explain what we did, learning card, study, revision, drill, gap, "I don't understand", "why did that work".
license: MIT
metadata:
  version: "0.1.0"
  component: generation
---

# Generate a learning card

The job: take something that actually happened in the work, and turn it into the
shortest artifact that would make the reader genuinely understand it.

Not a tutorial. Not documentation. A card, grounded in the reader's own code,
that takes about five minutes.

## When to make one

Make a card when there is real evidence of a gap:

- the user asks the agent to explain something it just did
- the user accepted a large or non-obvious change without follow-up
- the user copied a command, flag or pattern without reading it
- the same class of question has come up before
- something failed in a way the user could not have predicted from what they knew
- the user explicitly asks to learn from a session

**Do not make a card when nothing was learned.** A card that restates the obvious
is how a learning tool becomes noise. If there is no gap, say so — that is a
valid and useful answer.

If the user's reaction was about *style* rather than understanding, that is
`update-taste`, not this skill.

## Steps

1. **Find the moment.** What specifically is not understood? One thing. If you
   find two unrelated things, make two cards.

2. **Read the taste file first** and follow it. Layout, tone and length are
   things the user has opinions about:

   ```bash
   socrates taste list
   ```

   Or read the compiled block at `TASTE.md` in the data root (`socrates home`).
   Respect what is there; do not re-litigate it.

3. **Load the design context.** Before touching anything visual, read:

   - `../benji-taste/SKILL.md` — the visual reference
   - `references/design-system.md` — the translation for static documents, the
     token contract, and the four named layouts

   Do not invent a layout. Pick one of the four, or say why none of them fit.

4. **Pull the real code.** Verbatim from the session, the diff, or the file. Not
   a paraphrase, not a simplified invention. If you change it to make a point,
   say that you changed it.

5. **Choose blocks honestly.** Usually three to five. The vocabulary:

   | Block | Use it for |
   | --- | --- |
   | `explanation` | the idea itself, in a few paragraphs |
   | `snippet` | code that actually ran, with a caption and optional highlighted lines |
   | `contrast` | what happened vs. what would have been better — the highest-value block |
   | `diagram` | structure that prose makes worse: a flow, an ordered sequence, stacked layers |
   | `drill` | one short question the reader answers, with a reveal |
   | `callout` | the one thing that bites: a gotcha, a warning, a tip |
   | `reference` | where to read the real documentation |

   A card of four `explanation` blocks is a blog post. Prefer a `contrast` or a
   `diagram` over another paragraph.

6. **Pick a layout** from `design-system.md`: `standard`, `before-after`,
   `walkthrough`, or `reference-sheet`. The layout decides rhythm and what the
   eye lands on first, so choose it deliberately.

7. **Calibrate difficulty** against what the reader actually demonstrated, not
   against how clever the material is. `intro` for first contact, `working` for
   the normal case, `deep` only if they are already fluent in the surrounding
   ideas.

8. **Write it.**

   ```bash
   socrates card add --json '{ ... }'
   ```

   This stores the card and renders one self-contained HTML file. It prints the
   path. Tell the user where it landed.

8. **Report one line.** What the card covers and where it is. Nothing else.

## A worked example

Evidence: the user ran `git rebase --onto` from a colleague's suggestion,
watched it succeed, and asked "why did that work".

```json
{
  "title": "Moving commits off a branch you already pushed",
  "subtitle": "What `git rebase --onto` does that a plain rebase cannot.",
  "topic": "git",
  "difficulty": "working",
  "layout": "before-after",
  "estimatedMinutes": 4,
  "tags": ["git", "rebase"],
  "summary": "Rebasing a range of commits onto a new base without dragging the old one along.",
  "provenance": {
    "repo": "toolbox/socrates",
    "files": ["plugin/lib/store.mjs"]
  },
  "signals": {
    "why": "user asked why the rebase worked",
    "confidence": 0.7
  },
  "blocks": [
    {
      "type": "explanation",
      "text": "`git rebase <upstream>` replays your commits onto upstream's tip. It assumes everything before your commits on the current branch *is* upstream. When that assumption is wrong — when you branched off something you no longer want — you need to say explicitly where the commits start and where they go. That is the three-argument form."
    },
    {
      "type": "contrast",
      "title": "Same six commits, different destination",
      "wrong": {
        "label": "What you tried first",
        "code": "git rebase main",
        "note": "Replays everything between main and HEAD, including the commits from the abandoned branch."
      },
      "right": {
        "label": "What worked",
        "code": "git rebase --onto main old-base",
        "note": "`old-base` is exclusive: only the commits *after* it are replayed."
      }
    },
    {
      "type": "diagram",
      "kind": "flow",
      "title": "Reading the three arguments",
      "nodes": [
        { "label": "main", "detail": "where the commits land" },
        { "label": "old-base", "detail": "exclusive lower bound" },
        { "label": "HEAD", "detail": "inclusive upper bound" }
      ]
    },
    {
      "type": "drill",
      "prompt": "You have 3 commits on top of `feature-a` and want only those on `main`. What do you type?",
      "hint": "Two refs and a flag, then the branch.",
      "answer": "`git rebase --onto main feature-a`. `feature-a` is exclusive, so its own commits are left behind."
    },
    {
      "type": "callout",
      "variant": "gotcha",
      "title": "Exclusive, not inclusive",
      "text": "The second ref is *not* replayed. Off-by-one here silently moves one commit too many."
    }
  ]
}
```

See `references/card-model.md` for every field and block.

Note the shape: it opens with an explanation, lands the contrast, then makes the
same idea stick three more ways with a snippet, a diagram and a drill. Seven
blocks is the upper end — four is more typical. `before-after` is the right
layout here because the contrast is the heart of the card.

## Guardrails

- **Ground it.** Every card needs real provenance — repo, file, session, or the
  quote that triggered it. A card that cannot point at the work is a blog post.
- **Never invent code.** Copy it. If the real code is too long, cut it and say
  what you cut.
- **Never invent an API or a flag.** If you are not certain it exists, leave it
  out or check.
- **One idea per card.** Split rather than write a long one. The five-minute
  ceiling is a feature.
- **Respect the taste file.** If a preference exists and you disagree with it,
  follow it and mention the disagreement once.
- **Do not redact reality into falseness.** Do not paste secrets. Do redact
  credentials — replace with `REDACTED` rather than dropping the surrounding
  code.
- **Do not spam.** If the user asked for one card, make one.
