// Tipos del módulo de estadística (solo importa tipos de src/core).
import type { Outcome } from "../core/schemas.ts";

export type RunOutcome = Outcome;

/** Una fila por run. Los datos ausentes son null, nunca 0. */
export interface RunRow {
  caseId: string;
  configId: string;
  /** null = sin evaluar. */
  success: boolean | null;
  tokens: number | null;
  durationMs: number | null;
  outcome: RunOutcome;
  /** Índice de repetición (opcional, solo informativo). */
  rep?: number;
}

export type Veredicto =
  | "MEJORA"
  | "MEJORA MENOR"
  | "EQUIVALENTE"
  | "PEOR-REGRESIÓN"
  | "SIN EVIDENCIA";

export type MetricName = "success" | "tokens" | "duration";

/** Margen de efecto práctico mínimo (MPE). success en proporción (0.05 = 5 pp); el resto, fracción relativa. */
export interface Mpe {
  success: number;
  tokens: number;
  duration: number;
}

export const MPE_DEFAULT: Mpe = { success: 0.05, tokens: 0.1, duration: 0.15 };

export type Policy = "ITT" | "PP";

export interface Interval {
  lo: number;
  hi: number;
}
