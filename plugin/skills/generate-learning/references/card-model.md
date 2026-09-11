# The card model

Reference for the `generate-learning` skill.

A card is **data**, not HTML. You fill in this structure; the renderer turns it
into a self-contained HTML file. That is why the visual design can change without
regenerating any content, and why the same card can become a board tile later.

## Top-level fields

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | What this teaches. Not a topic name — a claim or a question. |
| `subtitle` | no | The one-line hook under the title. |
| `summary` | no | Used on the index tile. Write it for a list, not a page. |
| `topic` | no | Grouping key on the index. Lowercase, one word or a short slug. Defaults to `general`. |
| `tags` | no | Up to 8, free-form. |
| `difficulty` | no | `intro` \| `working` \| `deep`. Defaults to `working`. |
| `estimatedMinutes` | no | Capped at 60. Defaults to 5. Keep it honest. |
| `blocks` | yes | At least one. See below. |
| `provenance` | no | Strongly expected. Grounding. |
| `signals` | no | Why this card exists. |
| `review` | no | Spaced repetition state, managed by the CLI. |

### provenance

`moments[]`, `sessionId`, `harness`, `cwd`, `repo`, `files[]`, `model`.

The CLI fills `cwd`, and `harness`/`model`/`sessionId` when it can detect them
from the environment. You should fill `repo` and `files` — those are the ones a
reader actually uses to go look at the code.

### signals

`why` — a short phrase explaining what suggested a gap, e.g. *"user asked why the
rebase worked"*. It is shown in the card header, so it should read naturally.

`confidence` — 0 to 1. Be honest; it drives nothing yet, but it will drive
pruning later.

## Blocks

Blocks render in the order given. Three to five is a good card.

### explanation

```json
{ "type": "explanation", "text": "Markdown-lite: **bold**, *italic*, `code`, blank line for paragraphs." }
```

### snippet

```json
{
  "type": "snippet",
  "code": "const x = 1;\n",
  "language": "ts",
  "caption": "store.mjs, the fold",
  "highlight": [2, 3]
}
```

`highlight` is 1-based line numbers, drawn with an accent background. Use it
rather than trimming context the reader needs.

### contrast

The highest-value block. Side-by-side code with a label and a note on each side.

```json
{
  "type": "contrast",
  "title": "optional caption",
  "wrong": { "label": "What happened", "code": "...", "note": "..." },
  "right": { "label": "What would have been better", "code": "...", "note": "..." }
}
```

`label` defaults to *What happened* / *What would have been better* if omitted.
Keep both sides short enough to compare without scrolling sideways.

### diagram

Rendered as HTML and CSS, no images, no SVG geometry.

```json
{
  "type": "diagram",
  "kind": "steps" | "flow" | "layers",
  "title": "optional",
  "nodes": [{ "label": "required", "detail": "optional" }]
}
```

- `steps` — ordered, numbered, vertical. Use when order matters.
- `flow` — left to right with arrows, wraps on narrow screens. Use for a
  pipeline or a data path.
- `layers` — stacked bars. Use for levels of abstraction or nesting.

Cap it at about five nodes. A diagram that needs eight nodes needs two diagrams.

### drill

```json
{ "type": "drill", "prompt": "...", "hint": "...", "answer": "..." }
```

Rendered collapsed; the reader clicks to reveal. Exactly one drill per card, at
the end of the thinking. A drill with no `answer` is a trick, not a drill.

### callout

```json
{ "type": "callout", "variant": "tip" | "warning" | "gotcha", "title": "...", "text": "..." }
```

One per card, usually. `gotcha` is for the thing that will bite them; `warning`
for a real cost or risk; `tip` for a shortcut.

### reference

```json
{ "type": "reference", "url": "https://...", "title": "...", "why": "..." }
```

Point at primary sources. `why` says what to read it *for*. Do not invent URLs —
if you cannot verify it, leave the block out.

## What is not here

- No inline HTML block. Content is escaped and only the renderer emits markup.
  This keeps transcribed code from becoming an injection surface.
- No per-card styling. If a card wants a different look, that is a design-system
  change, not a card change.
- No multi-card series yet. One card, one idea.
