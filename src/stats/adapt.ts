// Adaptador RunResult (core) -> RunRow (stats). Datos ausentes = null, nunca 0.
import type { RunResult } from "../core/schemas.ts";
import type { RunRow } from "./types.ts";

export function runResultToRow(r: RunResult): RunRow {
  const t = r.telemetry;
  const tokens = t.totalTokens ?? (t.inputTokens !== null && t.outputTokens !== null ? t.inputTokens + t.outputTokens : null);
  return {
    caseId: r.scenarioId,
    configId: r.configurationId,
    success: r.success,
    tokens,
    durationMs: r.durationMs,
    outcome: r.outcome,
    rep: r.repetition,
  };
}

export function runResultsToRows(rs: readonly RunResult[]): RunRow[] {
  return rs.map(runResultToRow);
}
