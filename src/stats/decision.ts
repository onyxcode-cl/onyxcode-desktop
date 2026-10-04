// Regla de decisión con margen de efecto práctico (MPE) sobre el intervalo de confianza.
import type { Interval, MetricName, Mpe, Veredicto } from "./types.ts";
import { MPE_DEFAULT } from "./types.ts";
import { normQuantile, zTwoSided } from "./dist.ts";

/** Mínimo de casos pareados para emitir un veredicto distinto de SIN EVIDENCIA (configurable). */
export const MIN_CASES_DEFAULT = 10;

export interface MetricDecision {
  veredicto: Veredicto;
  /** Margen de MEJORA en la escala de análisis (proporción, o -ln(1-mpe) para tokens/duración). */
  margin: number;
  /** Margen de REGRESIÓN (proporción, o ln(1+mpe) para tokens/duración). Igual a `margin` en escala lineal. */
  marginLoss: number;
  /** IC de la "ganancia" (positivo = mejor), en la escala de análisis. */
  gain: Interval & { estimate: number };
  /** Efecto mínimo detectable (misma escala, magnitud) con 80 % de potencia, estimado desde el ancho del IC. */
  mde: number;
  /** true si el MDE <= min(margen, margen de pérdida) y hay casos suficientes. */
  powered: boolean;
  razon: string;
}

export interface DecideInput {
  estimate: number;
  lo: number;
  hi: number;
  /** Margen de mejora (en la escala de análisis, > 0). */
  margin: number;
  /** Margen de regresión; por defecto igual a `margin` (escala lineal: simétrico). */
  marginLoss?: number;
  /** +1 si valores más altos son mejores (éxito); -1 si más bajos son mejores (tokens, duración). */
  direction: 1 | -1;
  alpha?: number;
  power?: number;
  /** Casos pareados. Si se da y es < minCases, el veredicto es SIN EVIDENCIA y powered=false (A8). */
  nCases?: number;
  minCases?: number;
}

export function decideMetric(inp: DecideInput): MetricDecision {
  const alpha = inp.alpha ?? 0.05;
  const power = inp.power ?? 0.8;
  const { margin } = inp;
  const marginLoss = inp.marginLoss ?? inp.margin;
  const g = inp.direction === 1 ? { lo: inp.lo, hi: inp.hi } : { lo: -inp.hi, hi: -inp.lo };
  const est = inp.direction * inp.estimate;
  const gain = { estimate: est, lo: g.lo, hi: g.hi };
  if (![inp.estimate, inp.lo, inp.hi].every(Number.isFinite)) {
    return { veredicto: "SIN EVIDENCIA", margin, marginLoss, gain, mde: NaN, powered: false, razon: "datos insuficientes" };
  }
  const se = (g.hi - g.lo) / (2 * zTwoSided(alpha));
  const mde = (zTwoSided(alpha) + normQuantile(power)) * se;
  const minCases = inp.minCases ?? MIN_CASES_DEFAULT;
  if (inp.nCases !== undefined && inp.nCases < minCases) {
    return { veredicto: "SIN EVIDENCIA", margin, marginLoss, gain, mde, powered: false, razon: `solo ${inp.nCases} casos pareados (mínimo ${minCases}): no se emite veredicto` };
  }
  if (!(g.hi - g.lo > 0)) {
    return { veredicto: "SIN EVIDENCIA", margin, marginLoss, gain, mde, powered: false, razon: "IC degenerado (ancho 0): no se puede concluir" };
  }
  const powered = mde <= Math.min(margin, marginLoss);
  const mk = (veredicto: Veredicto, razon: string): MetricDecision => ({ veredicto, margin, marginLoss, gain, mde, powered, razon });

  if (g.lo > margin) return mk("MEJORA", "el IC completo supera el MPE a favor");
  if (g.hi < -marginLoss) return mk("PEOR-REGRESIÓN", "el IC completo supera el MPE en contra");
  if (g.lo > -marginLoss && g.hi < margin) {
    if (g.lo > 0) return mk("MEJORA MENOR", "mejora estadísticamente distinguible de 0 pero acotada por debajo del MPE");
    if (g.hi < 0) return mk("POSIBLE-REGRESIÓN", "degradación menor que el MPE pero distinguible de 0 (IC entre -MPE y 0): vigilar");
    return mk("EQUIVALENTE", "el IC completo cae dentro de ±MPE");
  }
  if (g.lo > 0) return mk("MEJORA MENOR", "IC excluye 0 a favor pero no se descarta un efecto menor que el MPE");
  if (g.hi < 0) return mk("POSIBLE-REGRESIÓN", "IC excluye 0 en contra; no se descarta que la regresión sea menor que el MPE");
  const poss = est <= -marginLoss ? " (estimación puntual en contra mayor al MPE: posible regresión)" : "";
  return mk("SIN EVIDENCIA", `IC demasiado ancho para concluir; MDE=${mde.toFixed(4)} vs MPE=${Math.min(margin, marginLoss).toFixed(4)}${poss}`);
}

/**
 * Margen de MEJORA en la escala de análisis. Éxito: proporción. Tokens/duración (escala ln, menos es mejor):
 * una reducción relativa `mpe` es ln(1-mpe) en la razón candidato/base, es decir una ganancia de -ln(1-mpe)
 * (antes se usaba ln(1+mpe) y una bajada del 9,1 % ya contaba como "10 %").
 */
export function marginFor(metric: MetricName, mpe: Mpe = MPE_DEFAULT): number {
  return metric === "success" ? mpe.success : -Math.log(1 - mpe[metric]);
}

/** Margen de REGRESIÓN: éxito igual; tokens/duración: un aumento relativo `mpe` es ln(1+mpe). */
export function marginLossFor(metric: MetricName, mpe: Mpe = MPE_DEFAULT): number {
  return metric === "success" ? mpe.success : Math.log(1 + mpe[metric]);
}

/**
 * Veredicto global. Reglas:
 *  1. Cualquier métrica PEOR-REGRESIÓN -> PEOR-REGRESIÓN.
 *  2. Si el éxito es SIN EVIDENCIA -> SIN EVIDENCIA (no se puede afirmar nada sin saber la calidad).
 *  3. Éxito POSIBLE-REGRESIÓN -> POSIBLE-REGRESIÓN: ninguna mejora de coste compensa una caída de calidad.
 *  4. Coste POSIBLE-REGRESIÓN sin mejora de éxito -> POSIBLE-REGRESIÓN.
 *  5. Alguna MEJORA -> MEJORA; si no, alguna MEJORA MENOR -> MEJORA MENOR; si no, EQUIVALENTE.
 *     (Por 2 y 3 el éxito es al menos EQUIVALENTE cuando se declara una mejora de coste.)
 *  Las métricas de coste (tokens, duración) en SIN EVIDENCIA no cuentan en 5.
 */
export function decideOverall(v: { success: Veredicto; tokens?: Veredicto; duration?: Veredicto }): Veredicto {
  const all = [v.success, v.tokens, v.duration].filter((x): x is Veredicto => x !== undefined);
  if (all.includes("PEOR-REGRESIÓN")) return "PEOR-REGRESIÓN";
  if (v.success === "SIN EVIDENCIA") return "SIN EVIDENCIA";
  if (v.success === "POSIBLE-REGRESIÓN") return "POSIBLE-REGRESIÓN";
  const successImproved = v.success === "MEJORA" || v.success === "MEJORA MENOR";
  if (!successImproved && all.includes("POSIBLE-REGRESIÓN")) return "POSIBLE-REGRESIÓN";
  if (all.includes("MEJORA")) return "MEJORA";
  if (all.includes("MEJORA MENOR")) return "MEJORA MENOR";
  return "EQUIVALENTE";
}
