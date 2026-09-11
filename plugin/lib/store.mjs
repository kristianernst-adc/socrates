// Socrates storage layout.
//
// Everything is append-only JSONL. Reading is a fold over the file.
//
// Two things intentionally live outside the flat files: captured events, which
// are one file per *source session file* so that incremental loading can append
// to the right one, and mood assets, which are binary.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_CONFIG_DIR = join(homedir(), ".socrates");

function readConfig(dir) {
  const file = join(dir, "config.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Data root resolution, highest priority first:
 *   1. SOCRATES_HOME environment variable
 *   2. `home` in config.json
 *   3. PLUGIN_DATA injected by the host (Agent Plugins clients)
 *   4. ~/.socrates
 */
export function resolveHome() {
  const configDir = process.env.SOCRATES_HOME?.trim() || DEFAULT_CONFIG_DIR;
  const config = readConfig(configDir);
  if (typeof config.home === "string" && config.home.trim()) {
    return config.home.trim().replace(/\/+$/, "");
  }
  const pluginData = process.env.PLUGIN_DATA?.trim();
  if (pluginData) return pluginData.replace(/\/+$/, "");
  return configDir;
}

export function paths(home = resolveHome()) {
  return {
    home,

    // personalization
    tasteDir: join(home, "taste"),
    feedback: join(home, "taste", "feedback.jsonl"),
    statements: join(home, "taste", "statements.jsonl"),
    compiled: join(home, "taste", "TASTE.md"),

    // capture
    eventsDir: join(home, "events"),
    moments: join(home, "moments.jsonl"),
    state: join(home, "state"),
    cursor: join(home, "state", "captured.json"),

    // pages
    pages: join(home, "pages.jsonl"),

    // mood
    moodDir: join(home, "mood"),
    moods: join(home, "mood", "items.jsonl"),
    moodAssets: join(home, "mood", "assets"),

    // output, at the top level so opening the folder is enough
    board: join(home, "index.html"),
    pagesDir: join(home, "pages"),
    moodBoard: join(home, "mood.html"),
  };
}

export function ensureDirs(home) {
  mkdirSync(home, { recursive: true });
}

export function appendJsonl(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return []; // tolerate a torn final line
      }
    });
}

/** Latest record wins per id, so records stay append-only and still "update". */
export function readLatestById(file) {
  const byId = new Map();
  for (const record of readJsonl(file)) {
    if (record?.id) byId.set(record.id, record);
  }
  return [...byId.values()];
}

export function writeAtomic(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}

export function makeId(prefix) {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${rand}`;
}

/** FNV-1a, used where a stable short digest of a string is enough. */
export function hash(input) {
  let h = 0x811c9dc5;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

/**
 * A deterministic event id. Determinism is what makes re-reading a source file
 * idempotent: the same transcript line always produces the same event id.
 */
export function eventId(session, entryId, blockIndex = 0) {
  return `evt_${hash(`${session}:${entryId}:${blockIndex}`)}`;
}
