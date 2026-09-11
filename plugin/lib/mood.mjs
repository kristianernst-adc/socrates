// Mood items — visual references collected from the web.
//
// A mood item is a *reference*, not an asset. It records what to steal, not just
// "this looks nice". The point is to evolve the design tokens in
// skills/generate-learning/references/design-system.md with evidence, rather
// than guessing.
//
// Two rules that keep this clean:
//   1. Mood images never get embedded in cards. Cards must stay self-contained,
//      offline and attribution-neutral. Moods inform tokens; they do not ship.
//   2. Palette extraction is done by the agent looking at the image, not by
//      this code. That keeps the plugin dependency-free and means it works in
//      any harness with vision, rather than only where we have an image lib.
//
// STUB: no dedupe by URL, no automatic pruning, no token diffing.

import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { appendJsonl, makeId, paths, readLatestById } from "./store.mjs";

export const MOOD_STATUSES = ["candidate", "adopted", "rejected"];
export const MOOD_APPLIES_TO = ["page", "index", "board", "typography", "color"];

const optionalString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizePalette(input) {
  if (!Array.isArray(input)) return [];
  return input
    .flatMap((entry) => {
      const hex = typeof entry === "string" ? entry : entry?.hex;
      if (typeof hex !== "string" || !HEX.test(hex.trim())) return [];
      return [
        {
          hex: hex.trim().toLowerCase(),
          role: optionalString(typeof entry === "object" ? entry.role : undefined),
        },
      ];
    })
    .slice(0, 8);
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`mood requires ${field}`);
  return value.trim();
}

export function normalizeMood(input) {
  const steal = requireString(input?.steal, "steal (the one thing worth taking)");
  const url = optionalString(input.url);
  const image = optionalString(input.image);
  if (!url && !image) throw new Error("mood requires url or image");

  return {
    type: "mood",
    id: typeof input.id === "string" && input.id ? input.id : makeId("mood"),
    createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
    url,
    image,
    local: optionalString(input.local) ?? null,
    title: optionalString(input.title) ?? optionalString(input.source) ?? url ?? image,
    source: optionalString(input.source),
    tags: Array.isArray(input.tags)
      ? input.tags.filter((t) => typeof t === "string" && t.trim()).slice(0, 10)
      : [],
    steal,
    palette: normalizePalette(input.palette),
    typeNotes: optionalString(input.typeNotes),
    appliesTo: Array.isArray(input.appliesTo)
      ? input.appliesTo.filter((a) => MOOD_APPLIES_TO.includes(a))
      : [],
    status: MOOD_STATUSES.includes(input.status) ? input.status : "candidate",
    // Provenance of the reference itself, so we can go back and look again.
    foundBy: optionalString(input.foundBy),
    notes: optionalString(input.notes),
  };
}

const EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
};

/**
 * Fetch the reference image into mood/assets so the board survives the source
 * disappearing, and so it renders offline. Best effort: a failure here must not
 * lose the collected reference.
 */
export async function downloadMoodAsset(mood, home) {
  const target = paths(home);
  const remote = mood.image ?? mood.url;
  if (!remote) return { mood, downloaded: false, reason: "no image url" };

  try {
    const response = await fetch(remote, {
      redirect: "follow",
      headers: { "user-agent": "socrates-mood/0.1 (+local reference collection)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { mood, downloaded: false, reason: `http ${response.status}` };

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext =
      EXT_BY_TYPE[contentType] ?? extname(new URL(remote).pathname).slice(0, 5) ?? ".bin";
    if (!contentType.startsWith("image/") && !/^\.(jpe?g|png|webp|gif|avif|svg)$/i.test(ext)) {
      return { mood, downloaded: false, reason: `not an image (${contentType || "unknown"})` };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) return { mood, downloaded: false, reason: "empty body" };

    mkdirSync(target.moodAssets, { recursive: true });
    const name = `${mood.id}${ext}`;
    writeFileSync(join(target.moodAssets, name), bytes);
    return {
      mood: { ...mood, local: `assets/${name}` },
      downloaded: true,
      bytes: bytes.length,
    };
  } catch (error) {
    return { mood, downloaded: false, reason: error.message };
  }
}

export function recordMood(mood, home) {
  appendJsonl(paths(home).moods, mood);
  return mood;
}

export function listMoods(home, flags = {}) {
  let items = readLatestById(paths(home).moods);
  if (flags.status) items = items.filter((m) => m.status === flags.status);
  if (flags.tag) items = items.filter((m) => m.tags.includes(flags.tag));
  if (flags.appliesTo) items = items.filter((m) => m.appliesTo.includes(flags.appliesTo));
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function setMoodStatus(id, status, home) {
  if (!MOOD_STATUSES.includes(status)) throw new Error(`unknown mood status: ${status}`);
  const item = readLatestById(paths(home).moods).find((m) => m.id === id);
  if (!item) throw new Error(`no mood with id ${id}`);
  const next = { ...item, status, updatedAt: new Date().toISOString() };
  appendJsonl(paths(home).moods, next);
  return next;
}
