// Pi transcript adapter.
//
// The only file in the plugin that knows Pi exists. Everything downstream sees
// events, never entries.
//
// Reference: Pi's docs/session-format.md, session v3. Transcripts are JSONL where
// each line is an entry, and entries form a tree via id/parentId — so one file can
// contain conversations that were branched away from and abandoned.
//
// STUB: entries are read in file order and every branch is captured. Filtering to
// the active path is deferred until a real session needs it.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { normalizeEvent } from "./model.mjs";

export const ADAPTER = { name: "pi", version: 1 };

/**
 * Read a session file into { line, entry } rows. A torn final line — Pi appends
 * while it runs — and any other unparseable line is skipped rather than fatal.
 */
export function readSession(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        return [{ line: index + 1, entry: JSON.parse(line) }];
      } catch {
        return [];
      }
    });
}

/** Text of a Pi content value: a plain string, or an array of typed blocks. */
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

/** Content blocks worth one event each. A string becomes a single text block. */
function blocksOf(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

/**
 * Convert one Pi session file into normalized events.
 *
 * One content block becomes one event, sharing an entryId and differing by
 * blockIndex — so a 40-tool-call turn is addressable rather than one blob.
 */
export function sessionToEvents(file) {
  const rows = readSession(file);
  const header = rows.find((row) => row.entry.type === "session")?.entry ?? {};
  const sessionId = header.id ?? basename(file, ".jsonl");
  const context = { cwd: header.cwd ?? "", repo: null };
  const events = [];
  let seq = 0;

  const push = (kind, { line, entry, actor, text = "", tool = null, result = null, model = null, blockIndex = 0 }) => {
    seq += 1;
    events.push(
      normalizeEvent({
        session: sessionId,
        seq,
        ts: entry.timestamp ?? header.timestamp,
        kind,
        actor,
        text: typeof text === "string" ? text : "",
        tool,
        result,
        model,
        source: {
          adapter: ADAPTER.name,
          adapterVersion: ADAPTER.version,
          file,
          line,
          entryId: entry.id ?? "x",
          blockIndex,
          parentId: entry.parentId ?? null,
        },
        context,
      }),
    );
  };

  /** A message entry, dispatched on role. Pi message roles are not entry types. */
  const pushMessage = (row) => {
    const { entry } = row;
    const message = entry.message ?? {};

    switch (message.role) {
      case "user":
      case "assistant": {
        const isAssistant = message.role === "assistant";
        const actor = isAssistant ? "assistant" : "user";
        blocksOf(message.content).forEach((block, blockIndex) => {
          if (block?.type === "text") {
            push(isAssistant ? "assistant_message" : "user_message", {
              ...row,
              actor,
              text: block.text,
              blockIndex,
            });
          } else if (block?.type === "thinking") {
            push("assistant_thinking", { ...row, actor, text: block.thinking, blockIndex });
          } else if (block?.type === "toolCall") {
            push("tool_call", {
              ...row,
              actor,
              blockIndex,
              tool: { name: block.name, callId: block.id, args: block.arguments },
            });
          } else {
            push("raw", { ...row, actor, text: block?.type, blockIndex });
          }
        });
        // An assistant turn that failed is itself evidence, and has no text block.
        if (isAssistant && message.stopReason === "error") {
          push("error", { ...row, actor, text: message.errorMessage });
        }
        break;
      }

      case "toolResult":
        blocksOf(message.content).forEach((block, blockIndex) => {
          push("tool_result", {
            ...row,
            actor: "tool",
            blockIndex,
            text: textOf([block]),
            tool: { name: message.toolName, callId: message.toolCallId },
            result: { ok: message.isError !== true },
          });
        });
        break;

      case "bashExecution":
        push("bash_execution", {
          ...row,
          actor: "user",
          text: message.output,
          tool: { name: "bash", args: { command: message.command } },
          result: { ok: message.exitCode === 0, exitCode: message.exitCode, truncated: message.truncated },
        });
        break;

      case "custom":
        push("annotation", { ...row, actor: "system", text: textOf(message.content) || message.customType });
        break;

      case "branchSummary":
        push("branch_summary", { ...row, actor: "system", text: message.summary });
        break;

      case "compactionSummary":
        push("compaction", { ...row, actor: "system", text: message.summary });
        break;

      default:
        push("raw", { ...row, actor: "system", text: message.role });
    }
  };

  for (const row of rows) {
    const { entry } = row;
    const common = { ...row, actor: "system", text: "" };

    switch (entry.type) {
      case "session":
        push("session_start", { ...common, text: `pi session v${entry.version ?? 1}` });
        break;
      case "message":
        pushMessage(row);
        break;
      case "model_change":
        push("model_change", { ...common, model: { provider: entry.provider, id: entry.modelId } });
        break;
      case "thinking_level_change":
        push("thinking_level_change", { ...common, text: entry.thinkingLevel });
        break;
      case "compaction":
        push("compaction", { ...common, text: entry.summary });
        break;
      case "branch_summary":
        push("branch_summary", { ...common, text: entry.summary });
        break;
      case "label":
        push("label", { ...common, actor: "user", text: entry.label });
        break;
      case "session_info":
        push("annotation", { ...common, actor: "user", text: entry.name });
        break;
      case "custom":
      case "custom_message":
        push("annotation", { ...common, text: entry.customType });
        break;
      default:
        // Never silently drop an entry type we do not know yet.
        push("raw", { ...common, text: entry.type });
    }
  }

  return { sessionId, cwd: context.cwd, file, events };
}
