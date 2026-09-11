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

## The bar

**Most sessions should produce zero cards.** That is the expected outcome, not a
failure. A feed where everything becomes a card is a feed nobody reads, and a
learning tool that produces homework is worse than no learning tool.

Signals that something *might* be a gap:

- the user asks the agent to explain something it just did
- the user accepted a large or non-obvious change without follow-up
- the user copied a command, flag or pattern without reading it
- the same class of question has come up before
- something failed in a way the user could not have predicted

But a signal is not a qualification. A candidate must pass **all five** tests:

1. **Transfer.** Would this still be true on a project you have not started yet?
   If it only holds here, it is a code-review comment, not a lesson.
2. **Lookup.** Could a competent engineer find this in one search? Then it is a
   lookup. Names of flags, environment variables, versions and APIs fail here,
   and they fail hard.
3. **Recurrence.** Would you plausibly get this wrong *again*? If you would never
   make the mistake now, you have already learned it and a card adds nothing.
4. **Decision.** Does it change a decision you make, or is it trivia? Prefer
   things that change how you would design something.
5. **Model.** Can you state the underlying principle in one sentence that is not
   just a restatement of the incident?

And the one that kills most candidates, stated plainly:
**the user asked about it ≠ it is worth learning.** Questions come from curiosity,
confusion and completeness. Only confusion is a gap.

Where the rejects go:

| Fails because… | Belongs in |
| --- | --- |
| they would want it done differently next time (style, approach, taste) | `update-taste` |
| it is a fact you can look up | nowhere — they already have the lookup |
| it is specific to this one piece of work | nowhere — it is already in the code |
| they have already learned it | nowhere — that would be revision they don't need |

Saying "nothing here is worth a card" is a good outcome. Say it plainly and
move on.

## Titles

The index is a reference someone scans in six months, not a feed they scroll.
A title has to let them decide whether to open the card, and let them find it
again by searching for the concept.

- **Name the concept, not the incident.** What happened goes in the page; the
  title carries the general idea.
- **Declare, don't tease.** No hooks, no rhetorical questions, no second person,
  no "why X is bad". If the title is working to make you curious, it is a blog
  headline and it will be useless on the board.
- **Lead with the concept, put the trap in the subtitle.**
- **Use the durable noun** — the word someone would actually search for.
- **Keep `summary` short.** It is clamped to a few lines on the board's paper.

| Bad | Why it fails | Good |
| --- | --- | --- |
| Load more doesn't load more | Hook. Says nothing about the subject. | Ranked search pages within a capped candidate pool |
| The fallback that fires on almost every request | Hook, and describes the bug rather than the lesson | Gate a fallback on zero results, not on a partial set |
| Using a fork means inheriting its parent's ecosystem | Hook-shaped, and the lesson underneath is a lookup | — |
| Aliases that point to nothing | Describes the incident | Foreign keys enforce existence, not availability |

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

3. **Load the design context.** Two optional resources, not a template:

   - `../benji-taste/SKILL.md` — principles for interfaces. Skim it if you are
     making layout or typography decisions.
   - `references/design-system.md` — the `--soc-*` tokens and a set of ready-made
     blocks, if you would rather compose than write HTML from scratch.

   Use them, mix them, or ignore them. There is no required shape.

4. **Pull the real code.** Verbatim from the session, the diff, or the file. Not
   a paraphrase, not a simplified invention. If you change it to make a point,
   say that you changed it.

5. **Write the page.** Hand-write HTML. It is your page: choose the structure,
   the layout, the styling, the length. Nothing is prescribed.

   ```bash
   socrates card add --json-file page.json
   ```

   `page.json` needs `title` (used on the board) and `html`. Everything else is
   optional metadata the board can use.

   ```json
   {
     "title": "Ranked search pages within a capped candidate pool",
     "summary": "Paging a ranked search past the point where the pool runs out.",
     "topic": "search",
     "html": "<!doctype html>...",
     "provenance": { "repo": "ash-conference", "files": ["services/search/service.py"] }
   }
   ```

   `html` may be a complete document — used untouched — or a fragment, which
   gets wrapped in a plain reading shell. Write a complete document when the
   shape matters.

   Use `--json-file` rather than `--json` for anything long. It sidesteps shell
   quoting entirely.

6. **Report one line.** Where it landed. Nothing else.

## A worked example

Hand-written HTML is the default, and the more interesting one to write. But if
you would rather compose than hand-roll a page, the structured block vocabulary
is still there. Same evidence either way: the user ran `git rebase --onto` from a
colleague's suggestion, watched it succeed, and asked "why did that work".

```json
{
  "title": "Rebasing a commit range onto a new base",
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

Every field and block type is in `references/card-model.md`.

Note the shape: it opens with an explanation, lands the contrast, then makes the
same idea stick three more ways. Seven blocks is the upper end — four is more
typical. If you wrote this by hand instead, you would probably keep the contrast
and the drill and drop the rest.

## Guardrails

- **Ground it.** Every card needs real provenance — repo, file, session, or the
  quote that triggered it. A card that cannot point at the work is a blog post.
- **Never invent code.** Copy it. If the real code is too long, cut it and say
  what you cut.
- **Never invent an API or a flag.** If you are not certain it exists, leave it
  out or check.
- **One idea per page.** Split rather than write a long one. If it takes more
  than a few minutes to read, it is probably two ideas.
- **Respect the taste file.** If a preference exists and you disagree with it,
  follow it and mention the disagreement once.
- **Do not redact reality into falseness.** Do not paste secrets. Do redact
  credentials — replace with `REDACTED` rather than dropping the surrounding
  code.
- **Do not spam.** If the user asked for one card, make one.
