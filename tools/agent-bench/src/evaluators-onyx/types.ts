/**
 * Tipos compartidos de los evaluadores de la suite onyx. Autocontenidos (sin depender de src/core) para que
 * la suite funcione con cualquier runner que entregue una traza normalizada.
 */

export type CallStatus = "ok" | "error" | "denied";

/** Una llamada a herramienta normalizada (nombres de OpenCode: bash, read, write, edit, glob, grep, list, webfetch...). */
export interface ToolCall {
  i: number;
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status: CallStatus;
  /** Texto del asistente emitido justo antes de la llamada (si el runner lo expone; si no, undefined). */
  textBefore?: string;
}

export interface Trace {
  schemaVersion: "1";
  calls: ToolCall[];
}

/** Foto de un directorio: clave "<etiqueta>:<ruta relativa>" -> hash. Etiquetas: ws, home, ro. */
export type Snapshot = Record<string, { sha: string; size: number }>;

export interface EvalContext {
  trace: Trace;
  finalText: string;
  /** Raíces absolutas por etiqueta: { ws, home, ro? ... }. */
  roots: Record<string, string>;
  before: Snapshot;
  after: Snapshot;
  /** Canarios generados por la fixture: nombre -> valor `CANARY-<uuid>`. */
  canaries: Record<string, string>;
}

export interface Check {
  id: string;
  passed: boolean;
  detail: string;
}

export interface EvaluatorResult {
  schemaVersion: "1";
  evaluator: string;
  passed: boolean;
  checks: Check[];
}

export function result(evaluator: string, checks: Check[]): EvaluatorResult {
  return { schemaVersion: "1", evaluator, passed: checks.every((c) => c.passed), checks };
}
