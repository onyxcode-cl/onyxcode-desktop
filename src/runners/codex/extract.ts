import type { Telemetry } from "../../core/schemas.ts";
import { normalizeTelemetry, nsum, uniq } from "../../telemetry/normalize.ts";
import { TOOL_ITEM_TYPES } from "./events.ts";
import { CODEX_CAPABILITIES } from "./types.ts";
import type { CodexParsed, RolloutTokens } from "./types.ts";

/**
 * Telemetría normalizada de Codex. input = input_tokens (ya incluye cached),
 * output = output_tokens (ya incluye reasoning). Nulls declarados: cost, cacheWriteTokens,
 * toolDurationMs, filesRead, steps (y llmCalls/peakContext si no hay rollout).
 */
export function extractCodex(parsed: CodexParsed, rollout: RolloutTokens | null, unverified: string[]): Telemetry {
  const u = parsed.usage;
  const tools = parsed.items.filter((i) => TOOL_ITEM_TYPES.has(i.type));
  const cmds = parsed.items.filter((i) => i.type === "command_execution");
  const changes = parsed.items.flatMap((i) => (i.type === "file_change" ? (i.changes ?? []) : []));
  const kind = (re: RegExp): string[] => uniq(changes.filter((c) => re.test(c.kind)).map((c) => c.path));
  const created = new Set(kind(/^add/i));
  const deleted = new Set(kind(/^(del|remov)/i));
  const modified = kind(/^(upd|mod|chang)/i).filter((p) => !created.has(p) && !deleted.has(p));
  const sawFileEvents = parsed.items.some((i) => i.type === "file_change") || parsed.turnsCompleted > 0;
  return normalizeTelemetry(
    {
      inputTokens: u?.input_tokens ?? null,
      outputTokens: u?.output_tokens ?? null,
      cachedTokens: u?.cached_input_tokens ?? null,
      reasoningTokens: u?.reasoning_output_tokens ?? null,
      totalTokens: u ? nsum(u.input_tokens, u.output_tokens) : null,
      llmCalls: rollout ? rollout.distinctCalls : null,
      peakContext: rollout?.peakContext ?? null,
      costUsd: null,
      toolCalls: parsed.turnsCompleted > 0 || parsed.items.length ? tools.length : null,
      commands: parsed.turnsCompleted > 0 || parsed.items.length ? cmds.length : null,
      steps: null,
      filesRead: null,
      filesModified: sawFileEvents ? modified : null,
      filesCreated: sawFileEvents ? [...created].sort() : null,
      filesDeleted: sawFileEvents ? [...deleted].sort() : null,
    },
    CODEX_CAPABILITIES,
    {
      runner: "codex",
      threadId: parsed.threadId,
      tokenSemantics: "input incluye cached_input; output incluye reasoning_output",
      declaredNulls: ["costUsd", "cacheWriteTokens", "toolDurationMs", "filesRead", "steps", ...(rollout ? [] : ["llmCalls", "peakContext"])],
      rollout: rollout && { distinctCalls: rollout.distinctCalls, rawEvents: rollout.rawEvents, duplicatesDropped: rollout.duplicatesDropped, files: rollout.files },
      commandsList: cmds.map((c) => c.command ?? "").slice(0, 200),
      commandFailures: cmds.filter((c) => c.exitCode != null && c.exitCode !== 0).length,
      errors: parsed.errors.slice(0, 20),
      unknownEventTypes: parsed.unknownEventTypes,
      malformedLines: parsed.malformedLines,
      unverified,
    },
  );
}
