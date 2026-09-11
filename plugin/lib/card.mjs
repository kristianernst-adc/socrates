// The card model — a learning outcome, as data.
//
// A card is authored by a model (through the generate-learning skill) but it is
// NOT html. The model fills in this structure; render.mjs turns it into html
// deterministically.
//
// That separation is deliberate:
//   - one place to change the visual design, instead of a prompt
//   - the html can be re-rendered, re-themed or exported without re-asking a model
//   - the same card can become a board tile later without touching content
//   - transcribed code never gets a chance to inject markup
//
// STUB: no schemas for every block yet, no card-level fan-out (one card from many
// moments is expressed via provenance.moments).

import { appendJsonl, makeId, paths, readLatestById } from "./store.mjs";

export const BLOCK_TYPES = [
  "explanation", // prose
  "snippet", // code, verbatim from the work
  "contrast", // what happened vs. what would have been better
  "diagram", // a small structural picture, rendered as html/css
  "drill", // a question the reader answers, with a reveal
  "callout", // tip / warning / gotcha
  "reference", // where to read more
];

export const DIFFICULTIES = ["intro", "working", "deep"];
export const REVIEW_STATUSES = ["new", "seen", "learning", "known", "retired"];

// Named layouts. Choosing one deliberately beats improvising spacing per card.
// See skills/design-cards/references/card-layouts.md for when to use each.
export const LAYOUTS = ["standard", "before-after", "walkthrough", "reference-sheet"];

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`card requires ${field}`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeBlock(block, index) {
  const type = block?.type;
  if (!BLOCK_TYPES.includes(type)) {
    throw new Error(`block ${index}: unknown type ${JSON.stringify(type)}`);
  }

  switch (type) {
    case "explanation":
      return { type, text: requireString(block.text, `block ${index}.text`) };

    case "snippet":
      return {
        type,
        code: requireString(block.code, `block ${index}.code`),
        language: optionalString(block.language),
        caption: optionalString(block.caption),
        highlight: Array.isArray(block.highlight)
          ? block.highlight.filter((n) => Number.isInteger(n) && n > 0)
          : [],
      };

    case "contrast":
      return {
        type,
        title: optionalString(block.title),
        wrong: {
          label: optionalString(block.wrong?.label) ?? "What happened",
          code: requireString(block.wrong?.code, `block ${index}.wrong.code`),
          language: optionalString(block.wrong?.language),
          note: optionalString(block.wrong?.note),
        },
        right: {
          label: optionalString(block.right?.label) ?? "What would have been better",
          code: requireString(block.right?.code, `block ${index}.right.code`),
          language: optionalString(block.right?.language),
          note: optionalString(block.right?.note),
        },
      };

    case "diagram": {
      const kind = ["steps", "flow", "layers"].includes(block.kind) ? block.kind : "steps";
      const nodes = Array.isArray(block.nodes) ? block.nodes : [];
      if (!nodes.length) throw new Error(`block ${index}: diagram needs nodes`);
      return {
        type,
        kind,
        title: optionalString(block.title),
        nodes: nodes.map((node, i) => ({
          label: requireString(node?.label, `block ${index}.nodes[${i}].label`),
          detail: optionalString(node?.detail),
        })),
      };
    }

    case "drill":
      return {
        type,
        prompt: requireString(block.prompt, `block ${index}.prompt`),
        answer: optionalString(block.answer),
        hint: optionalString(block.hint),
      };

    case "callout": {
      const variant = ["tip", "warning", "gotcha"].includes(block.variant)
        ? block.variant
        : "tip";
      return {
        type,
        variant,
        title: optionalString(block.title),
        text: requireString(block.text, `block ${index}.text`),
      };
    }

    case "reference":
      return {
        type,
        url: requireString(block.url, `block ${index}.url`),
        title: requireString(block.title, `block ${index}.title`),
        why: optionalString(block.why),
      };

    default:
      throw new Error(`unreachable block type ${type}`);
  }
}

export function normalizeCard(input) {
  const html = typeof input?.html === "string" && input.html.trim() ? input.html : undefined;
  const blocks = Array.isArray(input?.blocks) ? input.blocks : [];

  // Loosest possible contract: a page is either hand-written html or structured
  // blocks. Everything else is optional metadata the board can use.
  if (!html && !blocks.length) {
    throw new Error("card requires html, or at least one block");
  }

  const now = new Date().toISOString();
  const minutes = Number(input.estimatedMinutes);

  return {
    type: "card",
    id: typeof input.id === "string" && input.id ? input.id : makeId("crd"),
    createdAt: typeof input.createdAt === "string" ? input.createdAt : now,
    updatedAt: now,
    title: requireString(input.title, "title"),
    subtitle: optionalString(input.subtitle),
    summary: optionalString(input.summary),
    topic: optionalString(input.topic) ?? "general",
    tags: Array.isArray(input.tags)
      ? input.tags.filter((t) => typeof t === "string" && t.trim()).slice(0, 8)
      : [],
    difficulty: DIFFICULTIES.includes(input.difficulty) ? input.difficulty : undefined,
    layout: LAYOUTS.includes(input.layout) ? input.layout : "standard",
    estimatedMinutes:
      Number.isFinite(minutes) && minutes > 0 ? Math.min(60, Math.round(minutes)) : undefined,
    // Verbatim page. If this is set, blocks are ignored.
    html,
    blocks: html ? [] : blocks.map(normalizeBlock),
    // Grounding. A card that cannot point at the work it came from is a blog post.
    provenance: {
      moments: Array.isArray(input.provenance?.moments)
        ? input.provenance.moments.filter((m) => typeof m === "string")
        : [],
      sessionId: optionalString(input.provenance?.sessionId),
      harness: optionalString(input.provenance?.harness),
      cwd: optionalString(input.provenance?.cwd),
      repo: optionalString(input.provenance?.repo),
      files: Array.isArray(input.provenance?.files)
        ? input.provenance.files.filter((f) => typeof f === "string")
        : [],
      model: optionalString(input.provenance?.model),
    },
    // Why we thought this was worth teaching.
    signals: {
      why: optionalString(input.signals?.why),
      confidence: Number.isFinite(Number(input.signals?.confidence))
        ? Math.min(1, Math.max(0, Number(input.signals.confidence)))
        : 0.5,
    },
    review: {
      status: REVIEW_STATUSES.includes(input.review?.status) ? input.review.status : "new",
      lastReviewedAt: optionalString(input.review?.lastReviewedAt) ?? null,
      intervalDays: Number.isFinite(Number(input.review?.intervalDays))
        ? Number(input.review.intervalDays)
        : 0,
      ease: Number.isFinite(Number(input.review?.ease)) ? Number(input.review.ease) : 2.5,
    },
  };
}

export function recordCard(input, home) {
  const target = paths(home);
  const card = normalizeCard(input);
  const existing = readLatestById(target.cards).find((c) => c.id === card.id);
  if (existing) card.createdAt = existing.createdAt;
  appendJsonl(target.cards, card);
  return card;
}

export function listCards(home) {
  return readLatestById(paths(home).cards).filter((c) => c.review.status !== "trashed");
}

/**
 * Spaced repetition, deliberately minimal: a small SM-2-ish step. The point for
 * now is only that feedback changes the interval, not that the schedule is good.
 */
export function reviewCard(id, status, home) {
  const target = paths(home);
  const card = readLatestById(target.cards).find((c) => c.id === id);
  if (!card) throw new Error(`no card with id ${id}`);
  if (!REVIEW_STATUSES.includes(status)) throw new Error(`unknown review status: ${status}`);

  const ease = card.review.ease;
  const previous = card.review.intervalDays;
  let interval;
  switch (status) {
    case "known":
      interval = previous ? Math.round(previous * ease) : 3;
      break;
    case "learning":
      interval = 1;
      break;
    case "seen":
      interval = previous || 1;
      break;
    default:
      interval = 0;
  }

  const next = {
    ...card,
    updatedAt: new Date().toISOString(),
    review: {
      ...card.review,
      status,
      intervalDays: interval,
      lastReviewedAt: new Date().toISOString(),
    },
  };
  appendJsonl(target.cards, next);
  return next;
}
