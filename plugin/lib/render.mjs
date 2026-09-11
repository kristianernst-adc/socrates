// Deterministic renderer: card JSON in, self-contained html out.
//
// No dependencies, no build step, no external assets. A card must open correctly
// from a file:// url on a machine that is offline, and must survive being emailed
// to someone.
//
// Everything visual is driven by the `--soc-*` custom properties in TOKENS, so a
// curated design is a matter of replacing tokens and component rules rather than
// rewriting this file. See skills/generate-learning/references/design-system.md.

import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
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
  --soc-paper: #fffdf7;
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
    --soc-paper: #1d1f24;
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
.head{padding:3rem 2.5rem 1.75rem; border-bottom:1px solid var(--soc-line)}
h1{margin:0; font-size:1.95rem; line-height:1.22; letter-spacing:-.017em; font-weight:660}
.sub{margin:.7rem 0 0; color:var(--soc-ink-soft); font-size:1.06rem; line-height:1.5; max-width:56ch}
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
details.drill summary::after{content:" →"; color:var(--soc-ink-faint); font-weight:400}
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

/* ---------- index: nothing forced ---------- */
/* (the board lives above; this only styles the mood board groups) */
.topic{margin:0 0 3rem}
.topic h2{font-size:.78rem; letter-spacing:.09em; text-transform:uppercase; color:var(--soc-ink-faint);
  font-weight:700; margin:0 0 1.2rem; padding-bottom:.5rem; border-bottom:1px solid var(--soc-line)}
.back{display:inline-block; margin-bottom:1.4rem; font-size:.84rem; text-decoration:none; color:var(--soc-ink-faint)}
@media print{body{background:#fff}.paper,.card{box-shadow:none}details.drill{break-inside:avoid}}

/* ---------- board: papers on a surface ---------- */
.board__head{max-width:80rem; margin:0 auto; padding:3.5rem 2rem 0}
.board__head h1{font-size:.76rem; letter-spacing:.16em; text-transform:uppercase;
  color:var(--soc-ink-faint); font-weight:700; margin:0}
.canvas{max-width:80rem; margin:0 auto; padding:2.5rem 2rem 7rem;
  display:flex; flex-wrap:wrap; gap:2.4rem 2.1rem; align-items:flex-start}
.paper{--r:0deg; --y:0px; display:block; position:relative; width:14rem; min-height:9.5rem;
  padding:1.15rem 1.15rem 1.5rem; text-decoration:none; color:inherit;
  background:var(--soc-paper); border:1px solid var(--soc-line); border-radius:3px;
  box-shadow:0 1px 1px rgba(20,18,14,.045), 0 7px 16px -12px rgba(20,18,14,.5);
  transform:rotate(var(--r)) translateY(var(--y)); will-change:transform;
  transition:transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s ease}
.paper:hover,.paper:focus-visible{transform:rotate(0deg) translateY(calc(var(--y) - 12px)) scale(1.05);
  box-shadow:0 2px 3px rgba(20,18,14,.05), 0 22px 38px -20px rgba(20,18,14,.55);
  z-index:20; outline:none}
.paper:hover .paper__inner,.paper:focus-visible .paper__inner{animation:wiggle .5s cubic-bezier(.3,.9,.3,1)}
@keyframes wiggle{
  0%{transform:rotate(0)}
  22%{transform:rotate(2.1deg)}
  44%{transform:rotate(-1.7deg)}
  66%{transform:rotate(1.1deg)}
  84%{transform:rotate(-.5deg)}
  100%{transform:rotate(0)}}
.paper::after{content:""; position:absolute; right:0; bottom:0; width:0; height:0;
  border-style:solid; border-width:0 0 15px 15px;
  border-color:transparent transparent var(--soc-bg) transparent}
.paper__topic{font-size:.62rem; letter-spacing:.12em; text-transform:uppercase;
  color:var(--soc-ink-faint); font-weight:700; margin:0 0 .55rem}
.paper__title{font-weight:640; font-size:.97rem; line-height:1.34; margin:0; letter-spacing:-.005em}
.paper__summary{margin:.6rem 0 0; font-size:.815rem; line-height:1.45; color:var(--soc-ink-soft);
  display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden}
@media (prefers-reduced-motion:reduce){
  .paper{transition:none}
  .paper:hover,.paper:focus-visible{transform:rotate(0deg) translateY(calc(var(--y) - 6px)) scale(1.03)}
  .paper:hover .paper__inner,.paper:focus-visible .paper__inner{animation:none}}
.empty{color:var(--soc-ink-soft); max-width:80rem; margin:0 auto; padding:0 2rem}

/* Minimal shell for a hand-written fragment that isn't a full document. */
.frag{max-width:42rem; margin:0 auto; padding:4rem 1.5rem 6rem; line-height:1.65}
.frag h1{font-size:1.6rem; letter-spacing:-.015em; margin:0 0 1rem}
.frag h2{font-size:1.15rem; margin:2.2rem 0 .7rem}
.frag pre{background:var(--soc-surface-sunk); border:1px solid var(--soc-line); border-radius:8px;
  padding:1rem; overflow-x:auto; font-family:var(--soc-font-mono); font-size:.83rem}
.frag code{font-family:var(--soc-font-mono); font-size:.88em}
.frag img{max-width:100%; height:auto; border-radius:8px}

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
.chip{font-size:.76rem; font-weight:600; padding:.28rem .6rem; border-radius:999px;
  background:var(--soc-surface); border:1px solid var(--soc-line); color:var(--soc-ink-soft)}
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
  if (p.repo) bits.push(`<span>${escapeHtml(p.repo)}</span>`);
  else if (p.cwd) bits.push(`<span><code>${escapeHtml(p.cwd)}</code></span>`);
  for (const file of p.files.slice(0, 3)) {
    bits.push(`<span><code>${escapeHtml(file)}</code></span>`);
  }
  if (p.harness) bits.push(`<span>${escapeHtml(p.harness)}${p.model ? `/${escapeHtml(p.model)}` : ""}</span>`);
  return bits.join('<span class="dot"></span>');
};

const DOC_RX = /^\s*(<!doctype|<html)/i;

/** A hand-written page is used verbatim. A fragment gets a plain shell. */
function ensureDocument(html, title) {
  if (DOC_RX.test(html)) return html;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${TOKENS}
body{margin:0;background:var(--soc-bg);color:var(--soc-ink);font-family:var(--soc-font-sans);font-size:17px}
</style>
</head>
<body>
<main class="frag">
${html}
</main>
</body>
</html>
`;
}

export function renderCard(card) {
  if (card.html) return ensureDocument(card.html, card.title);
  return renderBlockCard(card);
}

function renderBlockCard(card) {
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
  <a class="back" href="../index.html">← all learnings</a>
  <article class="card layout--${escapeHtml(card.layout)}">
    <header class="head">
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

/**
 * Stable pseudo-random placement, so a paper sits in the same spot every time.
 * Restrained on purpose: enough variation to read as loose paper, not so much
 * that it looks like a ransom note.
 */
function paperStyle(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  const h2 = Math.abs(h);
  const rotation = ((h2 % 760) / 100 - 3.8).toFixed(2);
  const drop = (((h2 >> 9) % 1000) / 100 - 5).toFixed(2);
  return `--r:${rotation}deg; --y:${drop}px`;
}

export function renderBoard(cards) {
  const open = cards
    .filter((c) => c.review.status !== "retired")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const papers = open
    .map(
      (card) => `<a class="paper" href="pages/${escapeHtml(card.id)}.html" style="${paperStyle(card.id)}">
    <div class="paper__inner">
      <p class="paper__topic">${escapeHtml(card.topic)}</p>
      <h2 class="paper__title">${escapeHtml(card.title)}</h2>
      ${card.summary ? `<p class="paper__summary">${inline(card.summary)}</p>` : ""}
    </div>
  </a>`,
    )
    .join("\n  ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Learnings</title>
<style>${TOKENS}${BASE_CSS}</style>
</head>
<body>
<header class="board__head">
  <h1>Learnings</h1>
</header>
<main class="canvas">
  ${papers}
</main>
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
  const file = paths(home).moodBoard;
  writeAtomic(file, renderMoodBoard(listMoods(home)));
  return file;
}

/** Write the board and every page. Returns the paths written. */
export function renderAll(home) {
  const target = paths(home);
  // Retired cards stay in the store but must not be rendered, or their pages
  // linger and the orphan sweep below treats them as live.
  const cards = listCards(home).filter((c) => c.review.status !== "retired");
  mkdirSync(target.pagesDir, { recursive: true });

  const written = [];
  const live = new Set();
  for (const card of cards) {
    const file = join(target.pagesDir, `${card.id}.html`);
    writeAtomic(file, renderCard(card));
    written.push(file);
    live.add(`${card.id}.html`);
  }

  // Pages for retired cards should not be left behind. Only ever touch files we
  // could have written ourselves.
  for (const name of readdirSync(target.pagesDir)) {
    if (live.has(name) || !/^crd_[a-z0-9]+[.]html$/.test(name)) continue;
    try {
      unlinkSync(join(target.pagesDir, name));
    } catch {
      /* an orphan page is not worth failing a render over */
    }
  }

  writeAtomic(target.board, renderBoard(cards));
  written.push(target.board);
  return { written, cards: cards.length };
}

export function renderOne(id, home) {
  const target = paths(home);
  const card = listCards(home).find((c) => c.id === id);
  if (!card) throw new Error(`no card with id ${id}`);
  if (card.review.status === "retired") throw new Error(`card ${id} is retired; reinstate it before rendering`);
  mkdirSync(target.pagesDir, { recursive: true });
  const file = join(target.pagesDir, `${card.id}.html`);
  writeAtomic(file, renderCard(card));
  writeAtomic(target.board, renderBoard(listCards(home)));
  return file;
}
