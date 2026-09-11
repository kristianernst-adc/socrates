// Socrates storage layout.
//
// STUB: this is the personalization slice only. The capture/ingest side of the
// engine lives elsewhere and should eventually own root resolution for both.
//
// Everything is append-only JSONL. Reading is a fold over the file.

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
    tasteDir: join(home, "taste"),
    feedback: join(home, "taste", "feedback.jsonl"),
    statements: join(home, "taste", "statements.jsonl"),
    compiled: join(home, "taste", "TASTE.md"),
  };
}

export function ensureDirs(home) {
  mkdirSync(paths(home).tasteDir, { recursive: true });
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
