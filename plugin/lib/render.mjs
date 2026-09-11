// Deterministic renderer: card JSON in, self-contained html out.
//
// No dependencies, no build step, no external assets. A card must open correctly
// from a file:// url on a machine that is offline, and must survive being emailed
// to someone.
//
// Everything visual is driven by the `--soc-*` custom properties in TOKENS, so a
// curated design is a matter of replacing tokens and component rules rather than
// rewriting this file. See skills/generate-learning/references/design-system.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { listCards } from "./card.mjs";
import { listMoods, MOOD_STATUSES } from "./mood.mjs";
import { paths, writeAtomic } from "./store.mjs";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Escape first, then apply a deliberately tiny markdown subset. Safe by construction. */
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

const paragraphs = (text) =>
  String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${inline(p)}</p>`)
    .join("\n");

const TOKENS = `
:root{
  --soc-font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --soc-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --soc-bg: #faf8f4;
  --soc-surface: #ffffff;
  --soc-surface-sunk: #f2efe9;
  --soc-ink: #171a20;
  --soc-ink-soft: #5d6470;
  --soc-ink-faint: #8b909b;
  --soc-line: #e4e0d8;
  --soc-accent: #a8551f;
  --soc-accent-soft: #f6ece2;
  --soc-good: #1c6f47;
  --soc-good-soft: #e8f3ec;
  --soc-warn: #8a6100;
  --soc-warn-soft: #fbf1dc;
  --soc-bad: #a3281f;
  --soc-bad-soft: #fbeae8;
  --soc-radius: 14px;
  --soc-radius-sm: 9px;
  --soc-measure: 68ch;
  --soc-shadow: 0 1px 2px rgba(23,26,32,.05), 0 8px 28px -18px rgba(23,26,32,.28);
}
@media (prefers-color-scheme: dark){
  :root{
    --soc-bg: #131417;
    --soc-surface: #1b1d22;
    --soc-surface-sunk: #232529;
    --soc-ink: #ebe8e2;
    --soc-ink-soft: #a2a7b1;
    --soc-ink-faint: #767c86;
    --soc-line: #2e3238;
    --soc-accent: #e59a63;
    --soc-accent-soft: #2b241d;
    --soc-good: #63c894;
    --soc-good-soft: #182a20;
    --soc-warn: #e0b45f;
    --soc-warn-soft: #2b2618;
    --soc-bad: #ef8b81;
    --soc-bad-soft: #2e1d1b;
    --soc-shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 30px -20px rgba(0,0,0,.8);
  }
}
`;

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--soc-bg); color:var(--soc-ink);
  font-family:var(--soc-font-sans); font-size:17px; line-height:1.65;
  -webkit-font-smoothing:antialiased;
}
a{color:var(--soc-accent); text-underline-offset:2px}
code{font-family:var(--soc-font-mono); font-size:.88em}

.page{max-width:calc(var(--soc-measure) + 6rem); margin:0 auto; padding:3rem 1.5rem 5rem}
.card{background:var(--soc-surface); border:1px solid var(--soc-line); border-radius:var(--soc-radius);
  box-shadow:var(--soc-shadow); overflow:hidden}

/* ---------- head ---------- */
.head{padding:2.25rem 2.5rem 1.75rem; border-bottom:1px solid var(--soc-line)}
.kicker{display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; margin:0 0 1rem;
  font-size:.73rem; letter-spacing:.09em; text-transform:uppercase; color:var(--soc-ink-faint); font-weight:600}
.kicker span+span::before{content:"·"; margin-right:.5rem; color:var(--soc-line)}
h1{margin:0; font-size:1.95rem; line-height:1.22; letter-spacing:-.017em; font-weight:660}
.sub{margin:.7rem 0 0; color:var(--soc-ink-soft); font-size:1.06rem; line-height:1.5; max-width:56ch}

/* ---------- body ---------- */
.body{padding:2rem 2.5rem 2.25rem; display:flex; flex-direction:column; gap:2rem}
.block{margin:0}
.prose{max-width:var(--soc-measure)}
.prose p{margin:0 0 .95rem}
.prose p:last-child{margin-bottom:0}
.prose code{background:var(--soc-surface-sunk); padding:.12em .38em; border-radius:5px}

/* ---------- snippet ---------- */
figure.snippet{margin:0}
.snippet__cap{font-size:.78rem; letter-spacing:.05em; text-transform:uppercase;
  color:var(--soc-ink-faint); font-weight:600; margin-bottom:.55rem}
pre{margin:0; background:var(--soc-surface-sunk); border:1px solid var(--soc-line);
  border-radius:var(--soc-radius-sm); padding:1.05rem 1.15rem; overflow-x:auto;
  font-family:var(--soc-font-mono); font-size:.83rem; line-height:1.62}
pre code{font-size:inherit}
.ln{display:inline-block; width:2.2em; margin-right:.9em; text-align:right;
  color:var(--soc-ink-faint); user-select:none}
.row--hit{background:var(--soc-accent-soft); display:inline-block; width:100%;
  border-radius:4px; box-shadow:0 0 0 3px var(--soc-accent-soft)}

/* ---------- contrast ---------- */
.contrast{display:grid; gap:1rem; grid-template-columns:1fr 1fr}
@media (max-width:46rem){.contrast{grid-template-columns:1fr}}
.contrast__title{font-size:.78rem; letter-spacing:.05em; text-transform:uppercase;
  color:var(--soc-ink-faint); font-weight:600; margin:0 0 .55rem}
.pane{border:1px solid var(--soc-line); border-radius:var(--soc-radius-sm); overflow:hidden; height:100%}
.pane__label{padding:.5rem .85rem; font-size:.76rem; font-weight:650; letter-spacing:.03em;
  border-bottom:1px solid var(--soc-line)}
.pane--bad .pane__label{background:var(--soc-bad-soft); color:var(--soc-bad)}
.pane--good .pane__label{background:var(--soc-good-soft); color:var(--soc-good)}
.pane pre{border:0; border-radius:0; background:transparent; font-size:.79rem}
.pane__note{margin:0; padding:.65rem .85rem; border-top:1px solid var(--soc-line);
  font-size:.83rem; color:var(--soc-ink-soft)}

/* ---------- diagram ---------- */
.diagram__title{font-size:.78rem; letter-spacing:.05em; text-transform:uppercase;
  color:var(--soc-ink-faint); font-weight:600; margin:0 0 .8rem}
.flow{display:flex; flex-wrap:wrap; align-items:stretch; gap:.4rem}
.flow__arrow{align-self:center; color:var(--soc-ink-faint); font-size:1.1rem; padding:0 .1rem}
.node{flex:1 1 8rem; min-width:7rem; border:1px solid var(--soc-line); background:var(--soc-surface-sunk);
  border-radius:var(--soc-radius-sm); padding:.7rem .85rem}
.node__label{font-weight:620; font-size:.88rem; line-height:1.35}
.node__detail{margin-top:.28rem; font-size:.79rem; color:var(--soc-ink-soft); line-height:1.45}
.steps{counter-reset:s; margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:.5rem}
.steps li{counter-increment:s; position:relative; padding:.7rem .9rem .7rem 3rem;
  border:1px solid var(--soc-line); background:var(--soc-surface-sunk); border-radius:var(--soc-radius-sm)}
.steps li::before{content:counter(s); position:absolute; left:.85rem; top:.72rem;
  width:1.5rem; height:1.5rem; border-radius:50%; background:var(--soc-accent); color:var(--soc-surface);
  display:grid; place-items:center; font-size:.76rem; font-weight:700; font-family:var(--soc-font-sans)}
.layers{display:flex; flex-direction:column; gap:.35rem}
.layer{border:1px solid var(--soc-line); background:var(--soc-surface-sunk);
  border-radius:var(--soc-radius-sm); padding:.65rem .9rem}
.layer__label{font-weight:620; font-size:.88rem}
.layer__detail{font-size:.79rem; color:var(--soc-ink-soft); margin-top:.2rem}

/* ---------- drill ---------- */
details.drill{border:1px solid var(--soc-line); border-left:3px solid var(--soc-accent);
  border-radius:var(--soc-radius-sm); background:var(--soc-surface-sunk); padding:.9rem 1.1rem}
details.drill summary{cursor:pointer; font-weight:620; list-style:none}
details.drill summary::-webkit-details-marker{display:none}
details.drill summary::after{content:" ▸"; color:var(--soc-ink-faint)}
details.drill[open] summary::after{content:" ▾"}
.drill__hint{margin:.7rem 0 0; font-size:.85rem; color:var(--soc-ink-faint)}
.drill__answer{margin:.85rem 0 0; padding-top:.85rem; border-top:1px dashed var(--soc-line)}
.drill__answer p:first-child{margin-top:0}
.drill__answer p:last-child{margin-bottom:0}

/* ---------- callout ---------- */
.callout{border-radius:var(--soc-radius-sm); padding:.9rem 1.1rem; border:1px solid var(--soc-line)}
.callout__title{font-weight:660; font-size:.87rem; margin-bottom:.3rem}
.callout p{margin:0; font-size:.93rem}
.callout--tip{background:var(--soc-accent-soft); border-color:transparent}
.callout--tip .callout__title{color:var(--soc-accent)}
.callout--warning{background:var(--soc-warn-soft); border-color:transparent}
.callout--warning .callout__title{color:var(--soc-warn)}
.callout--gotcha{background:var(--soc-bad-soft); border-color:transparent}
.callout--gotcha .callout__title{color:var(--soc-bad)}

/* ---------- reference ---------- */
ul.refs{margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:.6rem}
ul.refs li{border-left:2px solid var(--soc-line); padding-left:.9rem}
ul.refs .refs__why{display:block; font-size:.84rem; color:var(--soc-ink-soft)}

/* ---------- foot ---------- */
.foot{padding:1.1rem 2.5rem 1.3rem; border-top:1px solid var(--soc-line);
  background:var(--soc-surface-sunk); display:flex; flex-wrap:wrap; gap:.4rem 1.1rem;
  align-items:baseline; font-size:.79rem; color:var(--soc-ink-faint)}
.foot code{font-size:.94em}
.foot .dot::before{content:"·"; margin-right:1.1rem; color:var(--soc-line)}

/* ---------- index ---------- */
.board__head{margin-bottom:2.5rem}
.board__head h1{font-size:2.2rem}
.board__stats{display:flex; flex-wrap:wrap; gap:.45rem; margin-top:1.1rem}
.chip{font-size:.76rem; font-weight:600; padding:.28rem .6rem; border-radius:999px;
  background:var(--soc-surface); border:1px solid var(--soc-line); color:var(--soc-ink-soft)}
.topic{margin:0 0 2.5rem}
.topic h2{font-size:.78rem; letter-spacing:.09em; text-transform:uppercase; color:var(--soc-ink-faint);
  font-weight:700; margin:0 0 .9rem; padding-bottom:.5rem; border-bottom:1px solid var(--soc-line)}
.grid{display:grid; gap:1rem; grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))}
.tile{display:block; text-decoration:none; color:inherit; background:var(--soc-surface);
  border:1px solid var(--soc-line); border-radius:var(--soc-radius); padding:1.15rem 1.25rem;
  box-shadow:var(--soc-shadow); transition:transform .12s ease, border-color .12s ease}
.tile:hover{transform:translateY(-2px); border-color:var(--soc-accent)}
.tile__meta{font-size:.71rem; letter-spacing:.07em; text-transform:uppercase; color:var(--soc-ink-faint);
  font-weight:600; margin-bottom:.5rem}
.tile__title{font-weight:640; font-size:1.03rem; line-height:1.35; margin:0 0 .4rem}
.tile__summary{font-size:.87rem; color:var(--soc-ink-soft); margin:0; line-height:1.5}
.tile__tags{display:flex; flex-wrap:wrap; gap:.3rem; margin-top:.85rem}
.tile__tags .chip{font-size:.7rem; padding:.16rem .5rem}
.empty{color:var(--soc-ink-soft)}
.back{display:inline-block; margin-bottom:1.4rem; font-size:.84rem; text-decoration:none; color:var(--soc-ink-faint)}
@media print{body{background:#fff}.tile,.card{box-shadow:none}details.drill{break-inside:avoid}}

/* ---------- layouts ---------- */
/* Named layouts beat improvising spacing per card. Deliberately small: a layout
   changes rhythm and emphasis, never the block vocabulary. */
.layout--before-after .body{gap:1.85rem}
.layout--before-after .contrast{gap:.75rem}
.layout--before-after .head{padding-bottom:1.35rem}
.layout--walkthrough .body{gap:1.6rem}
.layout--walkthrough .steps li{padding-top:.85rem; padding-bottom:.85rem}
.layout--walkthrough .prose{max-width:var(--soc-measure)}
.layout--reference-sheet{font-size:15.5px}
.layout--reference-sheet .head{padding:1.75rem 2rem 1.25rem}
.layout--reference-sheet .body{padding:1.5rem 2rem 1.75rem; gap:1.4rem}
.layout--reference-sheet h1{font-size:1.65rem}
.layout--reference-sheet pre{font-size:.8rem; padding:.85rem 1rem}
.layout--reference-sheet .foot{padding:1rem 2rem 1.15rem}

/* ---------- mood board ---------- */
.mood-grid{columns:3 17rem; column-gap:1rem; margin:0}
.mood{break-inside:avoid; margin:0 0 1rem; background:var(--soc-surface);
  border:1px solid var(--soc-line); border-radius:var(--soc-radius); overflow:hidden;
  box-shadow:var(--soc-shadow)}
.mood--adopted{border-color:var(--soc-good)}
.mood--rejected{opacity:.42}
.mood__media{display:block; width:100%; height:auto; background:var(--soc-surface-sunk); min-height:4rem}
.mood__swatch{display:flex; height:5.5rem}
.mood__swatch span{flex:1}
.mood__body{padding:.85rem 1rem 1rem}
.mood__meta{font-size:.68rem; letter-spacing:.07em; text-transform:uppercase;
  color:var(--soc-ink-faint); font-weight:600; margin:0 0 .35rem}
.mood__title{margin:0 0 .45rem; font-size:.96rem; font-weight:640; line-height:1.35}
.mood__title a{text-decoration:none}
.mood__steal{margin:0; font-size:.87rem; color:var(--soc-ink-soft); line-height:1.5;
  border-left:2px solid var(--soc-accent); padding-left:.65rem}
.mood__notes{margin:.5rem 0 0; font-size:.8rem; color:var(--soc-ink-faint)}
.mood__palette{display:flex; flex-wrap:wrap; gap:.3rem; margin-top:.7rem; align-items:center}
.mood__chip{width:1.15rem; height:1.15rem; border-radius:5px; border:1px solid var(--soc-line);
  display:inline-block}
.mood__tags{display:flex; flex-wrap:wrap; gap:.3rem; margin-top:.7rem}
.mood__tags .chip{font-size:.68rem; padding:.14rem .45rem}
.mood__status{font-size:.68rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase}
.mood__status--adopted{color:var(--soc-good)}
.mood__status--rejected{color:var(--soc-ink-faint)}
.mood__status--candidate{color:var(--soc-warn)}
.legend{margin:0 0 2rem; font-size:.88rem; color:var(--soc-ink-soft); max-width:var(--soc-measure)}
`;

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

function renderSnippet(block) {
  const caption = block.caption
    ? `<figcaption class="snippet__cap">${inline(block.caption)}</figcaption>`
    : "";
  const lines = String(block.code).replace(/\n$/, "").split("\n");
  const hits = new Set(block.highlight);
  const body = lines
    .map((line, i) => {
      const n = i + 1;
      const content = `${String(n).padStart(3, " ")}  ${escapeHtml(line)}`;
      return hits.has(n) ? `<span class="row--hit">${content}</span>` : content;
    })
    .join("\n");
  return `<figure class="snippet">${caption}<pre><code>${body}</code></pre></figure>`;
}

function renderContrast(block) {
  const title = block.title ? `<p class="contrast__title">${inline(block.title)}</p>` : "";
  const pane = (side, kind) => `
    <div class="pane pane--${kind}">
      <div class="pane__label">${escapeHtml(side.label)}</div>
      <pre><code>${escapeHtml(String(side.code).replace(/\n$/, ""))}</code></pre>
      ${side.note ? `<p class="pane__note">${inline(side.note)}</p>` : ""}
    </div>`;
  return `<div class="block">${title}<div class="contrast">${pane(block.wrong, "bad")}${pane(block.right, "good")}</div></div>`;
}

function renderDiagram(block) {
  const title = block.title ? `<p class="diagram__title">${inline(block.title)}</p>` : "";
  let body;

  if (block.kind === "steps") {
    body = `<ol class="steps">${block.nodes
      .map(
        (n) =>
          `<li><div class="node__label">${inline(n.label)}</div>${
            n.detail ? `<div class="node__detail">${inline(n.detail)}</div>` : ""
          }</li>`,
      )
      .join("")}</ol>`;
  } else if (block.kind === "layers") {
    body = `<div class="layers">${block.nodes
      .map(
        (n) =>
          `<div class="layer"><div class="layer__label">${inline(n.label)}</div>${
            n.detail ? `<div class="layer__detail">${inline(n.detail)}</div>` : ""
          }</div>`,
      )
      .join("")}</div>`;
  } else {
    body = `<div class="flow">${block.nodes
      .map(
        (n) =>
          `<div class="node"><div class="node__label">${inline(n.label)}</div>${
            n.detail ? `<div class="node__detail">${inline(n.detail)}</div>` : ""
          }</div>`,
      )
      .join('<span class="flow__arrow">→</span>')}</div>`;
  }

  return `<div class="block">${title}${body}</div>`;
}

function renderBlock(block) {
  switch (block.type) {
    case "explanation":
      return `<div class="block prose">${paragraphs(block.text)}</div>`;

    case "snippet":
      return `<div class="block">${renderSnippet(block)}</div>`;

    case "contrast":
      return renderContrast(block);

    case "diagram":
      return renderDiagram(block);

    case "drill":
      return `<details class="drill block">
        <summary>${inline(block.prompt)}</summary>
        ${block.hint ? `<p class="drill__hint">${inline(block.hint)}</p>` : ""}
        ${block.answer ? `<div class="drill__answer prose">${paragraphs(block.answer)}</div>` : ""}
      </details>`;

    case "callout":
      return `<aside class="callout callout--${block.variant} block">
        ${block.title ? `<div class="callout__title">${inline(block.title)}</div>` : ""}
        <p>${inline(block.text)}</p>
      </aside>`;

    case "reference":
      return `<div class="block"><ul class="refs"><li>
        <a href="${escapeHtml(block.url)}" rel="noreferrer noopener" target="_blank">${inline(block.title)}</a>
        ${block.why ? `<span class="refs__why">${inline(block.why)}</span>` : ""}
      </li></ul></div>`;

    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

const footerBits = (card) => {
  const p = card.provenance;
  const bits = [];
  if (p.repo) bits.push(`<span><code>${escapeHtml(p.repo)}</code></span>`);
  else if (p.cwd) bits.push(`<span><code>${escapeHtml(p.cwd)}</code></span>`);
  if (p.files.length) bits.push(`<span><code>${escapeHtml(p.files.slice(0, 3).join(", "))}</code></span>`);
  if (p.harness) bits.push(`<span>${escapeHtml(p.harness)}${p.model ? `/${escapeHtml(p.model)}` : ""}</span>`);
  if (p.sessionId) bits.push(`<span>session <code>${escapeHtml(p.sessionId.slice(0, 8))}</code></span>`);
  bits.push(`<span>review: ${escapeHtml(card.review.status)}</span>`);
  return bits.join('<span class="dot"></span>');
};

export function renderCard(card) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(card.title)}</title>
<style>${TOKENS}${BASE_CSS}</style>
</head>
<body>
<div class="page">
  <a class="back" href="index.html">← all learnings</a>
  <article class="card layout--${escapeHtml(card.layout)}">
    <header class="head">
      <p class="kicker">
        <span>${escapeHtml(card.topic)}</span>
        <span>${escapeHtml(card.difficulty)}</span>
        <span>${card.estimatedMinutes} min</span>
        ${card.signals.why ? `<span>${escapeHtml(card.signals.why)}</span>` : ""}
      </p>
      <h1>${escapeHtml(card.title)}</h1>
      ${card.subtitle ? `<p class="sub">${inline(card.subtitle)}</p>` : ""}
    </header>
    <div class="body">
      ${card.blocks.map(renderBlock).join("\n      ")}
    </div>
    <footer class="foot">${footerBits(card)}</footer>
  </article>
</div>
</body>
</html>
`;
}

export function renderIndex(cards) {
  const open = cards.filter((c) => c.review.status !== "retired");
  const byTopic = new Map();
  for (const card of open) {
    if (!byTopic.has(card.topic)) byTopic.set(card.topic, []);
    byTopic.get(card.topic).push(card);
  }
  const topics = [...byTopic.entries()].sort((a, b) => b[1].length - a[1].length);
  const due = open.filter(
    (c) =>
      c.review.status === "new" ||
      (c.review.lastReviewedAt &&
        Date.now() - Date.parse(c.review.lastReviewedAt) > c.review.intervalDays * 864e5),
  );

  const stats = [
    `${open.length} card${open.length === 1 ? "" : "s"}`,
    `${due.length} to review`,
    `${topics.length} topic${topics.length === 1 ? "" : "s"}`,
  ]
    .map((label) => `<span class="chip">${escapeHtml(label)}</span>`)
    .join("");

  const sections = topics
    .map(([topic, group]) => {
      const tiles = group
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((card) => {
          const tags = card.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("");
          return `<a class="tile" href="cards/${escapeHtml(card.id)}.html">
          <p class="tile__meta">${escapeHtml(card.difficulty)} · ${card.estimatedMinutes} min${
            card.review.status !== "new" ? ` · ${escapeHtml(card.review.status)}` : ""
          }</p>
          <h3 class="tile__title">${escapeHtml(card.title)}</h3>
          ${card.summary ? `<p class="tile__summary">${inline(card.summary)}</p>` : ""}
          ${tags ? `<div class="tile__tags">${tags}</div>` : ""}
        </a>`;
        })
        .join("\n        ");
      return `<section class="topic"><h2>${escapeHtml(topic)}</h2><div class="grid">
        ${tiles}
      </div></section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Learnings</title>
<style>${TOKENS}${BASE_CSS}</style>
</head>
<body>
<div class="page">
  <header class="board__head">
    <h1>Learnings</h1>
    <div class="board__stats">${stats}</div>
  </header>
  ${open.length ? sections : '<p class="empty">No cards yet. Generate one from a session.</p>'}
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// mood board
// ---------------------------------------------------------------------------

/**
 * Mood images are referenced, never embedded. The board is a working document
 * for us, not an artifact we ship, so linking to ../mood/assets is correct and
 * avoids duplicating bytes into the site output.
 */
function moodMedia(mood) {
  const src = mood.local ? `../mood/${mood.local}` : mood.image;
  if (src) {
    return `<img class="mood__media" src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }
  const swatches = (mood.palette.length ? mood.palette : [{ hex: "#e4e0d8" }, { hex: "#171a20" }])
    .map((p) => `<span style="background:${escapeHtml(p.hex)}"></span>`)
    .join("");
  return `<div class="mood__swatch">${swatches}</div>`;
}

function renderMoodItem(mood) {
  const palette = mood.palette
    .map(
      (p) =>
        `<span class="mood__chip" style="background:${escapeHtml(p.hex)}" title="${escapeHtml(
          p.role ? `${p.hex} — ${p.role}` : p.hex,
        )}"></span>`,
    )
    .join("");
  const tags = mood.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("");
  const meta = [mood.source, ...(mood.appliesTo ?? [])].filter(Boolean).join(" · ");
  const link = mood.url
    ? `<a href="${escapeHtml(mood.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(
        mood.title,
      )}</a>`
    : escapeHtml(mood.title);

  return `<article class="mood mood--${escapeHtml(mood.status)}">
  ${moodMedia(mood)}
  <div class="mood__body">
    <p class="mood__meta">${escapeHtml(meta || "reference")} <span class="mood__status mood__status--${escapeHtml(
      mood.status,
    )}">${escapeHtml(mood.status)}</span></p>
    <h3 class="mood__title">${link}</h3>
    <p class="mood__steal">${inline(mood.steal)}</p>
    ${mood.typeNotes ? `<p class="mood__notes">${inline(mood.typeNotes)}</p>` : ""}
    ${palette ? `<div class="mood__palette">${palette}<code class="mood__notes">${mood.palette
      .map((p) => p.hex)
      .join(" ")}</code></div>` : ""}
    ${tags ? `<div class="mood__tags">${tags}</div>` : ""}
  </div>
</article>`;
}

export function renderMoodBoard(moods) {
  const groups = MOOD_STATUSES.filter((s) => s !== "rejected")
    .map((status) => ({ status, items: moods.filter((m) => m.status === status) }))
    .filter((g) => g.items.length);
  const rejected = moods.filter((m) => m.status === "rejected");
  if (rejected.length) groups.push({ status: "rejected", items: rejected });

  const stats = [
    `${moods.length} reference${moods.length === 1 ? "" : "s"}`,
    `${moods.filter((m) => m.status === "adopted").length} adopted`,
    `${moods.filter((m) => m.status === "candidate").length} candidates`,
  ]
    .map((label) => `<span class="chip">${escapeHtml(label)}</span>`)
    .join("");

  const body = groups
    .map(
      (group) => `<section class="topic"><h2>${escapeHtml(group.status)}</h2><div class="mood-grid">
      ${group.items.map(renderMoodItem).join("\n      ")}
    </div></section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mood board</title>
<style>${TOKENS}${BASE_CSS}</style>
</head>
<body>
<div class="page">
  <a class="back" href="index.html">← all learnings</a>
  <header class="board__head">
    <h1>Mood board</h1>
    <div class="board__stats">${stats}</div>
  </header>
  <p class="legend">Visual references collected from the web, each with the one thing
  worth taking from it. These inform the design tokens. They are never embedded in
  cards: cards stay self-contained, offline and attribution-neutral.</p>
  ${moods.length ? body : '<p class="empty">Nothing collected yet.</p>'}
</div>
</body>
</html>
`;
}

/** Write the mood board. Returns the path. */
export function renderMoodBoardTo(home) {
  const file = paths(home).siteMoodBoard;
  writeAtomic(file, renderMoodBoard(listMoods(home)));
  return file;
}

/** Write one card's page plus the index. Returns the paths written. */
export function renderAll(home) {
  const target = paths(home);
  const cards = listCards(home);
  const cardDir = join(target.siteDir, "cards");
  mkdirSync(cardDir, { recursive: true });

  const written = [];
  for (const card of cards) {
    const file = join(cardDir, `${card.id}.html`);
    writeAtomic(file, renderCard(card));
    written.push(file);
  }
  writeAtomic(target.siteIndex, renderIndex(cards));
  written.push(target.siteIndex);
  return { written, cards: cards.length };
}

export function renderOne(id, home) {
  const target = paths(home);
  const card = listCards(home).find((c) => c.id === id);
  if (!card) throw new Error(`no card with id ${id}`);
  mkdirSync(join(target.siteDir, "cards"), { recursive: true });
  const file = join(target.siteDir, "cards", `${card.id}.html`);
  writeAtomic(file, renderCard(card));
  writeAtomic(target.siteIndex, renderIndex(listCards(home)));
  return file;
}
