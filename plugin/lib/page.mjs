// A page.
//
// A page is a title plus HTML. That is the whole contract. There is no component
// library and no block vocabulary: whoever writes the page decides its structure,
// layout and styling. The renderer's only job is to put the document where it
// belongs.
//
// The optional fields exist for the board, which has to list and place pages, not
// to constrain what is in them.

import { appendJsonl, makeId, paths, readLatestById } from "./store.mjs";

const optionalString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const requireString = (value, field) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`page requires ${field}`);
  return value.trim();
};

/** Anything that looks like a document is used as-is; anything else is wrapped. */
export const looksLikeDocument = (html) => /^\s*(<!doctype|<html)/i.test(html);

export function normalizePage(input) {
  const html = typeof input?.html === "string" ? input.html.trim() : "";
  if (!html) throw new Error("page requires html");

  const now = new Date().toISOString();
  return {
    type: "page",
    id: typeof input.id === "string" && input.id ? input.id : makeId("pg"),
    createdAt: typeof input.createdAt === "string" ? input.createdAt : now,
    updatedAt: now,
    title: requireString(input.title, "title"),
    summary: optionalString(input.summary),
    topic: optionalString(input.topic) ?? "general",
    tags: Array.isArray(input.tags)
      ? input.tags.filter((t) => typeof t === "string" && t.trim()).slice(0, 8)
      : [],
    html,
    // Grounding. A page that cannot point at the work it came from is a blog post.
    provenance: {
      moments: Array.isArray(input.provenance?.moments)
        ? input.provenance.moments.filter((m) => typeof m === "string")
        : [],
      session: optionalString(input.provenance?.session),
      adapter: optionalString(input.provenance?.adapter),
      cwd: optionalString(input.provenance?.cwd),
      repo: optionalString(input.provenance?.repo),
      files: Array.isArray(input.provenance?.files)
        ? input.provenance.files.filter((f) => typeof f === "string")
        : [],
      model: optionalString(input.provenance?.model),
    },
    // Why this was thought worth writing down.
    why: optionalString(input.why),
    status: ["open", "dismissed"].includes(input.status) ? input.status : "open",
  };
}

export function recordPage(input, home) {
  const page = normalizePage(input);
  const existing = readLatestById(paths(home).pages).find((p) => p.id === page.id);
  if (existing) page.createdAt = existing.createdAt;
  appendJsonl(paths(home).pages, page);
  return page;
}

export function listPages(home, { includeDismissed = false } = {}) {
  const pages = readLatestById(paths(home).pages);
  return includeDismissed ? pages : pages.filter((p) => p.status !== "dismissed");
}

export function dismissPage(id, home) {
  const page = readLatestById(paths(home).pages).find((p) => p.id === id);
  if (!page) throw new Error(`no page with id ${id}`);
  const next = { ...page, status: "dismissed", updatedAt: new Date().toISOString() };
  appendJsonl(paths(home).pages, next);
  return next;
}
