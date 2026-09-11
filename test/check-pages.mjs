// Fails if any generated page contains inline JavaScript that is not valid JS.
// Pages are free-form, so nothing else checks them — this is the only guard
// that a hand-written page will not throw when it is opened.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: check-pages.mjs <pages-dir>");
  process.exit(2);
}

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const bad = [];
let checked = 0;

for (const name of readdirSync(dir)) {
  if (!name.endsWith(".html")) continue;
  const html = readFileSync(join(dir, name), "utf8");
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const body = match[1].trim();
    if (!body) continue;
    const temp = join(tmpdir(), `socrates-check-${process.pid}-${checked}.js`);
    writeFileSync(temp, body, "utf8");
    try {
      execFileSync(process.execPath, ["--check", temp], { stdio: "pipe" });
      checked += 1;
    } catch (error) {
      bad.push(`${name}: ${String(error.stderr).split("\n").find((l) => l.includes("Error")) ?? "invalid"}`);
    } finally {
      unlinkSync(temp);
    }
  }
}

if (bad.length) {
  console.error(bad.join("\n"));
  process.exit(1);
}
console.log(`  ${checked} inline script(s) parse`);
