// Renderer.
//
// Deliberately does almost nothing. A page is a document someone else wrote; this
// writes it out and lists it on a board. There is no component library, no block
// vocabulary and no template — nothing here decides what a page contains.
//
// Two things this file *is* responsible for:
//   - the board (index.html), which places every page as a paper on a surface
//   - the mood board (mood.html), a working document of collected references
//
// Both are self-contained: inline CSS, no external resources, no scripts.

import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { listPages, looksLikeDocument } from "./page.mjs";
import { listMoods, MOOD_STATUSES } from "./mood.mjs";
import { paths, writeAtomic } from "./store.mjs";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Escape first, then apply a tiny markdown subset. Safe by construction. */
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

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
  --soc-good: #1c6f47;
  --soc-warn: #8a6100;
  --soc-radius: 14px;
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
    --soc-good: #63c894;
    --soc-warn: #e0b45f;
    --soc-radius: 14px;
  }
}
`;

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--soc-bg);color:var(--soc-ink);
  font-family:var(--soc-font-sans);font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:var(--soc-accent);text-underline-offset:2px}
code{font-family:var(--soc-font-mono);font-size:.88em}

/* ---------- board: papers on a surface ---------- */
.board__head{max-width:80rem;margin:0 auto;padding:3.5rem 2rem 0}
.board__head h1{font-size:.76rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--soc-ink-faint);font-weight:700;margin:0}
.canvas{max-width:80rem;margin:0 auto;padding:2.5rem 2rem 7rem;
  display:flex;flex-wrap:wrap;gap:2.4rem 2.1rem;align-items:flex-start}
.paper{--r:0deg;--y:0px;display:block;position:relative;width:14rem;min-height:9.5rem;
  padding:1.15rem 1.15rem 1.5rem;text-decoration:none;color:inherit;
  background:var(--soc-paper);border:1px solid var(--soc-line);border-radius:3px;
  box-shadow:0 1px 1px rgba(20,18,14,.045),0 7px 16px -12px rgba(20,18,14,.5);
  transform:rotate(var(--r)) translateY(var(--y));will-change:transform;
  transition:transform .3s cubic-bezier(.2,.8,.2,1),box-shadow .3s ease}
.paper:hover,.paper:focus-visible{transform:rotate(0deg) translateY(calc(var(--y) - 12px)) scale(1.05);
  box-shadow:0 2px 3px rgba(20,18,14,.05),0 22px 38px -20px rgba(20,18,14,.55);z-index:20;outline:none}
.paper:hover .paper__inner,.paper:focus-visible .paper__inner{animation:wiggle .5s cubic-bezier(.3,.9,.3,1)}
@keyframes wiggle{
  0%{transform:rotate(0)}22%{transform:rotate(2.1deg)}44%{transform:rotate(-1.7deg)}
  66%{transform:rotate(1.1deg)}84%{transform:rotate(-.5deg)}100%{transform:rotate(0)}}
.paper::after{content:"";position:absolute;right:0;bottom:0;width:0;height:0;border-style:solid;
  border-width:0 0 15px 15px;border-color:transparent transparent var(--soc-bg) transparent}
.paper__topic{font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;
  color:var(--soc-ink-faint);font-weight:700;margin:0 0 .55rem}
.paper__title{font-weight:640;font-size:.97rem;line-height:1.34;margin:0;letter-spacing:-.005em}
.paper__summary{margin:.6rem 0 0;font-size:.815rem;line-height:1.45;color:var(--soc-ink-soft);
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
@media (prefers-reduced-motion:reduce){
  .paper{transition:none}
  .paper:hover,.paper:focus-visible{transform:rotate(0deg) translateY(calc(var(--y) - 6px)) scale(1.03)}
  .paper:hover .paper__inner,.paper:focus-visible .paper__inner{animation:none}}
.empty{color:var(--soc-ink-soft);max-width:80rem;margin:0 auto;padding:0 2rem}

/* ---------- mood board ---------- */
.topic{margin:0 0 3rem}
.topic h2{font-size:.78rem;letter-spacing:.09em;text-transform:uppercase;color:var(--soc-ink-faint);
  font-weight:700;margin:0 0 1.2rem;padding-bottom:.5rem;border-bottom:1px solid var(--soc-line)}
.chip{font-size:.76rem;font-weight:600;padding:.28rem .6rem;border-radius:999px;
  background:var(--soc-surface);border:1px solid var(--soc-line);color:var(--soc-ink-soft)}
.mood-grid{columns:3 17rem;column-gap:1rem;margin:0}
.mood{break-inside:avoid;margin:0 0 1rem;background:var(--soc-surface);border:1px solid var(--soc-line);
  border-radius:var(--soc-radius);overflow:hidden;box-shadow:0 1px 2px rgba(20,18,14,.05)}
.mood--adopted{border-color:var(--soc-good)}
.mood--rejected{opacity:.42}
.mood__media{display:block;width:100%;height:auto;background:var(--soc-surface-sunk);min-height:4rem}
.mood__swatch{display:flex;height:5.5rem}
.mood__swatch span{flex:1}
.mood__body{padding:.85rem 1rem 1rem}
.mood__meta{font-size:.68rem;letter-spacing:.07em;text-transform:uppercase;
  color:var(--soc-ink-faint);font-weight:600;margin:0 0 .35rem}
.mood__title{margin:0 0 .45rem;font-size:.96rem;font-weight:640;line-height:1.35}
.mood__title a{text-decoration:none}
.mood__steal{margin:0;font-size:.87rem;color:var(--soc-ink-soft);line-height:1.5;
  border-left:2px solid var(--soc-accent);padding-left:.65rem}
.mood__notes{margin:.5rem 0 0;font-size:.8rem;color:var(--soc-ink-faint)}
.mood__palette{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.7rem;align-items:center}
.mood__chip{width:1.15rem;height:1.15rem;border-radius:5px;border:1px solid var(--soc-line);display:inline-block}
.mood__tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.7rem}
.mood__tags .chip{font-size:.68rem;padding:.14rem .45rem}
.mood__status{font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.mood__status--adopted{color:var(--soc-good)}
.mood__status--rejected{color:var(--soc-ink-faint)}
.mood__status--candidate{color:var(--soc-warn)}
.pagehead{max-width:80rem;margin:0 auto;padding:3.5rem 2rem 0}
.pagehead h1{font-size:.76rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--soc-ink-faint);font-weight:700;margin:0}
.legend{max-width:52rem;margin:0 auto;padding:1rem 2rem 0;font-size:.88rem;color:var(--soc-ink-soft)}
.back{display:inline-block;margin:0 0 1.4rem;font-size:.84rem;text-decoration:none;color:var(--soc-ink-faint)}
/* Minimal shell for a fragment that is not a full document. */
.frag{max-width:42rem;margin:0 auto;padding:4rem 1.5rem 6rem;line-height:1.65}
.frag h1{font-size:1.6rem;letter-spacing:-.015em;margin:0 0 1rem}
.frag h2{font-size:1.15rem;margin:2.2rem 0 .7rem}
.frag pre{background:var(--soc-surface-sunk);border:1px solid var(--soc-line);border-radius:8px;
  padding:1rem;overflow-x:auto;font-family:var(--soc-font-mono);font-size:.83rem}
.frag code{font-family:var(--soc-font-mono);font-size:.88em}
.frag img{max-width:100%;height:auto;border-radius:8px}
@media print{.paper,.mood{box-shadow:none}}
`;

/**
 * A page is used verbatim if it is a document. A fragment gets the plainest
 * possible shell, because a bare fragment looks broken — but nothing here styles
 * the content itself. That is the author's decision.
 */
export function ensureDocument(html, title) {
  if (looksLikeDocument(html)) return html;
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

// ---------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------

/** Stable pseudo-random placement, so a paper sits in the same spot every time. */
function paperStyle(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  const h2 = Math.abs(h);
  const rotation = ((h2 % 760) / 100 - 3.8).toFixed(2);
  const drop = (((h2 >> 9) % 1000) / 100 - 5).toFixed(2);
  return `--r:${rotation}deg; --y:${drop}px`;
}

export function renderBoard(pages) {
  const open = pages
    .filter((p) => p.status !== "dismissed")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const papers = open
    .map(
      (page) => `<a class="paper" href="pages/${escapeHtml(page.id)}.html" style="${paperStyle(page.id)}">
    <div class="paper__inner">
      <p class="paper__topic">${escapeHtml(page.topic)}</p>
      <h2 class="paper__title">${escapeHtml(page.title)}</h2>
      ${page.summary ? `<p class="paper__summary">${inline(page.summary)}</p>` : ""}
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
    ? `<a href="${escapeHtml(mood.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(mood.title)}</a>`
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
<header class="pagehead"><h1>Mood board</h1></header>
<p class="legend">Visual references collected from the web, each with the one thing worth
taking from it. These inform how the output looks. They are never embedded in a page.</p>
${moods.length ? body : '<p class="empty">Nothing collected yet.</p>'}
<p class="legend"><a href="index.html">← all learnings</a></p>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/** Write the board and every page. Returns the paths written. */
export function renderAll(home) {
  const target = paths(home);
  const pages = listPages(home);
  mkdirSync(target.pagesDir, { recursive: true });

  const written = [];
  const live = new Set();
  for (const page of pages) {
    const file = join(target.pagesDir, `${page.id}.html`);
    writeAtomic(file, ensureDocument(page.html, page.title));
    written.push(file);
    live.add(`${page.id}.html`);
  }

  // Pages for dismissed entries should not be left behind. Only ever touch files
  // we could have written ourselves.
  for (const name of readdirSync(target.pagesDir)) {
    if (live.has(name) || !/^pg_[a-z0-9]+[.]html$/.test(name)) continue;
    try {
      unlinkSync(join(target.pagesDir, name));
    } catch {
      /* an orphan page is not worth failing a render over */
    }
  }

  writeAtomic(target.board, renderBoard(pages));
  written.push(target.board);
  return { written, pages: pages.length };
}

export function renderOne(id, home) {
  const target = paths(home);
  const page = listPages(home).find((p) => p.id === id);
  if (!page) throw new Error(`no page with id ${id}`);
  mkdirSync(target.pagesDir, { recursive: true });
  const file = join(target.pagesDir, `${page.id}.html`);
  writeAtomic(file, ensureDocument(page.html, page.title));
  writeAtomic(target.board, renderBoard(listPages(home)));
  return file;
}

export function renderMoodBoardTo(home) {
  const file = paths(home).moodBoard;
  writeAtomic(file, renderMoodBoard(listMoods(home)));
  return file;
}
