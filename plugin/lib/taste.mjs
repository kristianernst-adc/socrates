// The taste model.
//
// Two record types, on purpose:
//
//   feedback  — what the user actually said, in their own words. Immutable,
//               append-only, never inferred. This is the ground truth.
//   statement — a distilled, actionable preference. Inferred from one or more
//               feedback records. Reviewable, retirable, and the only thing
//               that gets compiled into instructions.
//
// Keeping these apart is what stops the system from silently rewriting the
// user's intent. A statement can always be traced back to the feedback that
// produced it.
//
// STUB: conflict resolution, decay and pruning are deliberately simple here.
// See plugin/skills/update-taste/references/taste-model.md for the open bits.

import { appendJsonl, makeId, paths, readLatestById } from "./store.mjs";

export const POLARITIES = ["prefer", "avoid"];
export const SCOPE_LEVELS = ["global", "language", "repo", "task", "one-off"];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function normalizeScope(input) {
  const scope = input && typeof input === "object" ? input : {};
  const level = SCOPE_LEVELS.includes(scope.level) ? scope.level : "global";
  const match = {};
  for (const key of ["language", "repo", "cwd", "taskKind"]) {
    if (typeof scope.match?.[key] === "string" && scope.match[key].trim()) {
      match[key] = scope.match[key].trim();
    }
  }
  return { level, match };
}

/** Key a statement is deduplicated on: same claim, same scope, same polarity. */
function statementKey({ polarity, statement, scope }) {
  return [polarity, slug(statement), scope.level, JSON.stringify(scope.match)].join("|");
}

function confidence(observations, source) {
  return clamp(0.35 + 0.15 * (observations - 1) + (source === "user" ? 0.25 : 0), 0, 0.95);
}

/**
 * Turn an untrusted payload (from a model, a skill, or an MCP tool call) into a
 * feedback record. Unknown fields are dropped rather than stored.
 */
export function normalizeFeedback(input) {
  const polarity = POLARITIES.includes(input?.polarity) ? input.polarity : null;
  if (!polarity) throw new Error('feedback requires polarity: "prefer" or "avoid"');

  const about = typeof input.about === "string" ? input.about.trim() : "";
  if (!about) throw new Error("feedback requires about: what this is about");

  const statement = typeof input.statement === "string" ? input.statement.trim() : "";
  if (!statement) throw new Error("feedback requires statement: the preference, in one sentence");

  const now = new Date().toISOString();
  return {
    type: "feedback",
    id: typeof input.id === "string" && input.id ? input.id : makeId("fb"),
    createdAt: now,
    polarity,
    intensity: clamp(Number(input.intensity) || 2, 1, 3),
    about,
    statement,
    rationale: typeof input.rationale === "string" ? input.rationale.trim() : "",
    evidence: typeof input.evidence === "string" ? input.evidence.trim() : "",
    scope: normalizeScope(input.scope),
    scopeHint: typeof input.scopeHint === "string" ? input.scopeHint.trim() : "",
    // "user" means the user stated it as a general rule. "inferred" means we
    // generalised it ourselves and it should be confirmed before it applies.
    source: input.source === "user" ? "user" : "inferred",
    tags: Array.isArray(input.tags)
      ? input.tags.filter((t) => typeof t === "string" && t.trim()).slice(0, 8)
      : [],
    capturedBy: {
      harness: typeof input.harness === "string" ? input.harness : undefined,
      model: typeof input.model === "string" ? input.model : undefined,
      sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
      cwd: typeof input.cwd === "string" ? input.cwd : undefined,
    },
  };
}

/**
 * Fold one feedback record into the statement list.
 * Returns { statements, created, matched, conflicts }.
 */
export function foldFeedback(feedback, statements) {
  const key = statementKey(feedback);
  const existing = statements.find(
    (s) => s.status !== "retired" && statementKey(s) === key,
  );

  let created = false;
  let conflicts = [];

  if (existing) {
    existing.observations += 1;
    existing.lastSeen = feedback.createdAt;
    existing.updatedAt = feedback.createdAt;
    existing.support = [...new Set([...existing.support, feedback.id])];
    // A direct user statement outranks our own generalisation.
    if (feedback.source === "user") existing.source = "user";
    existing.confidence = confidence(existing.observations, existing.source);
    if (existing.status === "proposed" && feedback.source === "user") {
      existing.status = "active";
    }
    // Clear an existing conflict when the user restates the original position.
    if (existing.conflictsWith.length && feedback.source === "user") {
      for (const otherId of existing.conflictsWith) {
        const other = statements.find((s) => s.id === otherId);
        if (other) {
          other.conflictsWith = other.conflictsWith.filter((id) => id !== existing.id);
        }
      }
      existing.conflictsWith = [];
    }
  } else {
    // Conflict heuristic: opposite polarity, same subject, same scope level.
    //
    // TODO: this is a placeholder. Real conflicts are usually paraphrases
    // ("keep commits terse" vs "use descriptive commit messages") and this
    // will miss them. Detecting them properly needs the inference layer, not
    // string matching. See references/taste-model.md.
    conflicts = statements.filter(
      (s) =>
        s.status !== "retired" &&
        s.polarity !== feedback.polarity &&
        slug(s.about) === slug(feedback.about) &&
        s.scope.level === feedback.scope.level,
    );

    const statement = {
      type: "statement",
      id: makeId("tst"),
      createdAt: feedback.createdAt,
      updatedAt: feedback.createdAt,
      firstSeen: feedback.createdAt,
      lastSeen: feedback.createdAt,
      status: feedback.source === "user" ? "active" : "proposed",
      polarity: feedback.polarity,
      statement: feedback.statement,
      scope: feedback.scope,
      source: feedback.source,
      observations: 1,
      confidence: confidence(1, feedback.source),
      support: [feedback.id],
      conflictsWith: conflicts.map((c) => c.id),
      about: feedback.about,
      tags: feedback.tags,
    };
    for (const other of conflicts) {
      other.conflictsWith = [...new Set([...other.conflictsWith, statement.id])];
    }
    statements.push(statement);
    created = true;
  }

  return {
    statements,
    created,
    matched: existing?.id,
    conflicts: conflicts.map((c) => c.id),
  };
}

export function recordFeedback(input, home) {
  const target = paths(home);
  const feedback = normalizeFeedback(input);
  const statements = readLatestById(target.statements);

  // Statements are append-only, so after folding we re-append whichever ones
  // actually changed. Comparing snapshots is cheap here and avoids having to
  // thread a dirty-set through every branch of the fold.
  const before = new Map(statements.map((s) => [s.id, JSON.stringify(s)]));
  const result = foldFeedback(feedback, statements);
  appendJsonl(target.feedback, feedback);

  let changed = 0;
  for (const statement of result.statements) {
    if (before.get(statement.id) === JSON.stringify(statement)) continue;
    appendJsonl(target.statements, statement);
    changed += 1;
  }
  return { feedback, ...result, changed };
}

const SCOPE_ORDER = ["global", "language", "task", "repo", "one-off"];
const SCOPE_TITLES = {
  global: "Global",
  language: "By language",
  task: "By task",
  repo: "By repo",
  "one-off": "One-off context",
};

function scopeLabel(scope) {
  const detail = Object.values(scope.match ?? {});
  return detail.length ? ` (${detail.join(", ")})` : "";
}

/** Render the compiled instruction block. This is the artifact agents read. */
export function compile(statements) {
  const active = statements.filter((s) => s.status === "active");
  const proposed = statements.filter((s) => s.status === "proposed");
  const lines = [
    "<!-- generated by socrates. edit with the update-taste skill, not by hand. -->",
    "# Working preferences",
    "",
  ];

  if (!active.length) {
    lines.push("_Nothing recorded yet._", "");
  }

  for (const level of SCOPE_ORDER) {
    const group = active
      .filter((s) => s.scope.level === level)
      .sort((a, b) => b.confidence - a.confidence);
    if (!group.length) continue;
    lines.push(`## ${SCOPE_TITLES[level]}`, "");
    for (const s of group) {
      const prefix = s.polarity === "avoid" ? "Avoid: " : "";
      const note = s.observations > 1 ? ` _(seen ${s.observations}x)_` : "";
      lines.push(`- ${prefix}${s.statement}${scopeLabel(s.scope)}${note}`);
    }
    lines.push("");
  }

  if (proposed.length) {
    lines.push("## Pending confirmation", "", "_Inferred by the agent, not yet stated by you._", "");
    for (const s of proposed) {
      const prefix = s.polarity === "avoid" ? "Avoid: " : "";
      lines.push(`- [ ] ${prefix}${s.statement}${scopeLabel(s.scope)} \`${s.id}\``);
    }
    lines.push("");
  }

  const contested = statements.filter((s) => s.status !== "retired" && s.conflictsWith.length);
  if (contested.length) {
    lines.push("## Contested", "", "_Conflicting feedback. Needs a decision._", "");
    for (const s of contested) {
      lines.push(`- ${s.statement} vs. ${s.conflictsWith.join(", ")} \`${s.id}\``);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
