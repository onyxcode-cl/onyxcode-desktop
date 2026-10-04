// Tipos locales de evaluadores (independientes de src/core hasta que se unifiquen los esquemas).
import type { WorkspaceDiff } from "../workspace/diff.ts";

export interface EvaluatorResult {
  schemaVersion: "1";
  evaluator: string;
  /** false cuando el evaluador no aplica al caso: pass y score quedan null. */
  applicable: boolean;
  pass: boolean | null;
  /** 0..1 o null si no aplica. */
  score: number | null;
  details: Record<string, unknown>;
  durationMs: number | null;
  /** Error de infraestructura del evaluador (no del agente). */
  error?: string;
}

export interface EvalContext {
  /** Workspace del agente (ya sin procesos vivos). */
  workspaceDir: string;
  /** Copia de evaluación (con tests ocultos inyectados). */
  evalDir?: string;
  /** Rutas relativas de los tests ocultos inyectados en evalDir. */
  hiddenFiles?: string[];
  /** Diff precalculado; si falta, se captura desde workspaceDir. */
  diff?: WorkspaceDiff;
  env?: Record<string, string>;
}

export interface Evaluator {
  readonly id: string;
  evaluate(ctx: EvalContext): Promise<EvaluatorResult>;
}

export function notApplicable(evaluator: string, reason: string): EvaluatorResult {
  return { schemaVersion: "1", evaluator, applicable: false, pass: null, score: null, details: { reason }, durationMs: null };
}

export function infraError(evaluator: string, error: string, durationMs: number | null = null): EvaluatorResult {
  return { schemaVersion: "1", evaluator, applicable: true, pass: null, score: null, details: {}, durationMs, error };
}
