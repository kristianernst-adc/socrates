# Design system

Reference for `generate-learning`.

Two things live here: **where the design judgment comes from**, and **the
mechanical contract** that judgment is expressed through.

## Where the judgment lives

Load the **`benji-taste`** skill (`plugin/skills/benji-taste/SKILL.md`) before
making layout or typography decisions. It is the visual reference for this
plugin — progressive disclosure, context continuity, selective emphasis, state
completeness, constraints, and inspecting the real artifact rather than trusting
the source.

It is an unofficial public-source synthesis of Benji Taylor's work, not endorsed
by him, and it was written for **interactive** products. Do not apply it
literally. Read it, then apply the translation below.

## Translating it to static documents

Our output is a self-contained HTML file with no JavaScript. Roughly a third of
the reference does not survive that, and pretending otherwise produces worse
pages. The honest mapping:

| Reference idea | In a static page |
| --- | --- |
| Progressive disclosure | `<details>` for drills and answers. Depth is opt-in, never a wall of text. |
| Context continuity | Provenance in the footer, always. The reader can see which file, repo and session a page came from. |
| Semantic motion | Becomes **semantic layout**. Structure is expressed by arrangement — numbered steps for sequence, arrows for flow, stacked bars for layers. Nothing moves, so arrangement carries the whole load. |
| Selective emphasis | The delight budget. Most pages are quiet. One page in ten earns a richer diagram. Do not decorate every page equally. |
| Tactility, sound, haptics | **Out of scope.** Static document. No sound, no fake interactivity. |
| State completeness | Applies to the *index*, not the page: empty, one-page, many-page, retired-only. |
| Constraints over variants | The token contract and the four named layouts. Resist a fifth. |
| Performance and trust | Self-contained, no external font or image fetch, opens instantly, prints correctly. |
| Judge the running product | Open the rendered HTML and look at it. Never declare a page done from the JSON. |
| Craft subordinate to product truth | A beautiful page about nothing is noise. The *gap* has to be real. |

The hard gates from the reference still apply, restated for documents: no
content that restates the obvious, no missing provenance, no unreadable
contrast, no external dependency, and no page shipped without having been looked
at rendered.


## Interactivity

A page may include inline JavaScript. Not a framework, not a build step — a page
is one file that opens from `file://` on a machine that is offline.

Use it only where **manipulating something teaches what reading cannot**:

| Interaction | Use when | Example |
| --- | --- | --- |
| Scrub a variable | a value has a non-obvious effect across a range | drag an offset past a cap and watch the result empty out |
| Toggle a path | two implementations differ in a way that is easier to see than to describe | ranked search vs. an exhaustive listing |
| Step through | order matters and the intermediate states carry the meaning | a request moving through a pipeline |
| Simulate an input | the answer depends on the input's shape | a query through tokenisation and fusion |

Do **not** add interactivity for any of these reasons:

- animating something that could simply be written down
- hiding content behind a control that would fit on the page
- making the reader perform steps you have not given them a reason to want
- anything whose removal would not change understanding

The test: if the interaction were replaced by one sentence, would the reader lose
something? If not, write the sentence.

### Constraints for a local file

Interactivity has to survive being opened with no server, no network, and no
tooling:

- **Inline classic scripts only.** A `file://` page cannot `import` a module or
  `fetch` a sibling file — the browser blocks both. One `<script>` with no
  `type="module"` and no external `src`.
- **No external resources** of any kind. No CDN, no fonts, no images from the
  network.
- **Readable without JavaScript.** The prose has to carry the idea on its own;
  the interaction is an addition. Do not render essential content from a script.
- **Never render the page's meaning from a script that could fail.** Set the
  default state in the HTML, then let the script adjust it.
- **Respect `prefers-reduced-motion`.** Transitions off, state changes still
  visible.
- **Keyboard usable.** Native controls (`input[type=range]`, `button`,
  `details`) rather than clickable divs.

## Collecting visual references

The design should evolve with evidence rather than taste-in-the-abstract. Mood
items are references gathered from the web, each with **the one thing worth
taking**.

```bash
socrates mood add --json '{
  "url": "https://example.com/post",
  "image": "https://example.com/hero.jpg",
  "title": "Editorial layout with hanging labels",
  "source": "example.com",
  "steal": "Move the pane labels outside the code block so the eye lands on the code first.",
  "tags": ["editorial", "code-layout"],
  "appliesTo": ["page"],
  "palette": [
    { "hex": "#faf8f4", "role": "background" },
    { "hex": "#a8551f", "role": "accent" }
  ],
  "typeNotes": "Serif headings at low contrast weight, tight tracking."
}'

socrates mood board      # renders site/mood.html — an image grid
socrates mood adopt <id> # this should become a token or layout change
```

Rules that keep this from turning into a Pinterest hole:

1. **`steal` is required and must be specific.** "Nice colours" is not a
   reference. "Labels outside the block, 1.1 line-height on code, one accent
   only" is.
2. **Mood images are never embedded in pages.** Pages stay self-contained,
   offline and attribution-neutral. Moods inform tokens; they do not ship.
3. **Palette extraction is done by looking at the image**, not by a library.
   That keeps the plugin dependency-free and works in any harness with vision.
4. **Adoption is a deliberate act.** A reference is `candidate` until it maps to
   a concrete token or layout change, at which point it becomes `adopted`. If it
   changed nothing, it becomes `rejected` — that is useful information too.
5. **Never copy a design wholesale.** Take the structural idea and rebuild it
   with our content, constraints and tokens.

The mood board is also the working prototype for the board view we want later,
so improvements to it are not throwaway.

## Reviewing a page before shipping it

Score it only after opening the rendered HTML.

| Dimension | Points |
| --- | ---: |
| The gap is real and evidenced | 20 |
| Grounded in actual code, not paraphrase | 15 |
| One idea, stated clearly | 15 |
| Layout fits the content | 15 |
| Blocks used deliberately, not all the same type | 10 |
| Drill is answerable and useful | 10 |
| Legible and correct in dark mode and print | 10 |
| Reads in under five minutes | 5 |
| **Total** | **100** |

Below 70, rework it or do not ship it. Two automatic failures, regardless of
score:

- **No provenance.** A page that cannot point at the work it came from is a blog
  post.
- **Fails the bar.** If the candidate does not pass all five tests in the
  `generate-learning` skill, it is not a page and no amount of craft rescues it.
  Title hook, lookup-shaped lesson, or a claim that only holds in one repository
  all fail here.

## Still to decide

- Typography has not been chosen deliberately yet — the current stack is a
  system default. This is the highest-leverage thing on the mood board.
- Only four layouts. Adding more should wait until a real page does not fit.
- The index grid is functional, not designed. It is the surface the board view
  will replace.
