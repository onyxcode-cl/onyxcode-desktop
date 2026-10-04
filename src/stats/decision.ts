// Regla de decisión con margen de efecto práctico (MPE) sobre el intervalo de confianza.
import type { Interval, MetricName, Mpe, Veredicto } from "./types.ts";
import { MPE_DEFAULT } from "./types.ts";
import { normQuantile, zTwoSided } from "./dist.ts";

export interface MetricDecision {
  veredicto: Veredicto;
  /** Margen en la escala de análisis (proporción, o log(1+mpe) para tokens/duración). */
  margin: number;
  /** IC de la "ganancia" (positivo = mejor), en la escala de análisis. */
  gain: Interval & { estimate: number };
  /** Efecto mínimo detectable (misma escala, magnitud) con 80 % de potencia, estimado desde el ancho del IC. */
  mde: number;
  /** true si el MDE <= margen: el experimento podía detectar un efecto del tamaño del MPE. */
  powered: boolean;
  razon: string;
}

export interface DecideInput {
  estimate: number;
  lo: number;
  hi: number;
  margin: number;
  /** +1 si valores más altos son mejores (éxito); -1 si más bajos son mejores (tokens, duración). */
  direction: 1 | -1;
  alpha?: number;
  power?: number;
}

export function decideMetric(inp: DecideInput): MetricDecision {
  const alpha = inp.alpha ?? 0.05;
  const power = inp.power ?? 0.8;
  const { margin } = inp;
  const g = inp.direction === 1 ? { lo: inp.lo, hi: inp.hi } : { lo: -inp.hi, hi: -inp.lo };
  const est = inp.direction * inp.estimate;
  const gain = { estimate: est, lo: g.lo, hi: g.hi };
  if (![inp.estimate, inp.lo, inp.hi].every(Number.isFinite)) {
    return { veredicto: "SIN EVIDENCIA", margin, gain, mde: NaN, powered: false, razon: "datos insuficientes" };
  }
  const se = (g.hi - g.lo) / (2 * zTwoSided(alpha));
  const mde = (zTwoSided(alpha) + normQuantile(power)) * se;
  const powered = mde <= margin;
  const mk = (veredicto: Veredicto, razon: string): MetricDecision => ({ veredicto, margin, gain, mde, powered, razon });

  if (g.lo > margin) return mk("MEJORA", "el IC completo supera el MPE a favor");
  if (g.hi < -margin) return mk("PEOR-REGRESIÓN", "el IC completo supera el MPE en contra");
  if (g.lo > -margin && g.hi < margin) {
    if (g.lo > 0) return mk("MEJORA MENOR", "mejora estadísticamente distinguible de 0 pero acotada por debajo del MPE");
    if (g.hi < 0) return mk("EQUIVALENTE", "dentro del MPE (degradación menor distinguible de 0, vigilar)");
    return mk("EQUIVALENTE", "el IC completo cae dentro de ±MPE");
  }
  if (g.lo > 0) return mk("MEJORA MENOR", "IC excluye 0 a favor pero no se descarta un efecto menor que el MPE");
  const poss = est <= -margin ? " (estimación puntual en contra mayor al MPE: posible regresión)" : "";
  return mk("SIN EVIDENCIA", `IC demasiado ancho para concluir; MDE=${mde.toFixed(4)} vs MPE=${margin.toFixed(4)}${poss}`);
}

export function marginFor(metric: MetricName, mpe: Mpe = MPE_DEFAULT): number {
  return metric === "success" ? mpe.success : Math.log(1 + mpe[metric]);
}

/**
 * Veredicto global. Reglas:
 *  1. Cualquier métrica PEOR-REGRESIÓN -> PEOR-REGRESIÓN.
 *  2. Si el éxito es SIN EVIDENCIA -> SIN EVIDENCIA (no se puede afirmar nada sin saber la calidad).
 *  3. Alguna MEJORA -> MEJORA; si no, alguna MEJORA MENOR -> MEJORA MENOR; si no, EQUIVALENTE.
 *  Las métricas de coste (tokens, duración) en SIN EVIDENCIA no cuentan en 3.
 */
export function decideOverall(v: { success: Veredicto; tokens?: Veredicto; duration?: Veredicto }): Veredicto {
  const all = [v.success, v.tokens, v.duration].filter((x): x is Veredicto => x !== undefined);
  if (all.includes("PEOR-REGRESIÓN")) return "PEOR-REGRESIÓN";
  if (v.success === "SIN EVIDENCIA") return "SIN EVIDENCIA";
  if (all.includes("MEJORA")) return "MEJORA";
  if (all.includes("MEJORA MENOR")) return "MEJORA MENOR";
  return "EQUIVALENTE";
}
