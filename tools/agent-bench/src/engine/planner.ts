import { deterministicId, seededShuffle } from "../core/ids.ts";
import type { Configuration, Experiment, RunResult } from "../core/schemas.ts";

export interface PlannedRun {
  /** posición en el orden de ejecución (0-based) */
  index: number;
  /** clave estable (experimento, escenario, configuración, repetición): sirve para reanudar */
  key: string;
  scenarioId: string;
  configurationId: string;
  repetition: number;
  /** semilla por run (derivada, determinista) */
  seed: number;
}

export interface PricePerMTok { inputPerMTok: number; outputPerMTok: number }
/** modelo (o "provider/model") -> precio USD por millón de tokens */
export type PricingTable = Record<string, PricePerMTok>;

export interface PlanOptions {
  configurations?: readonly Configuration[];
  /** runs previos (para estimar tokens/duración/coste por observación) */
  history?: readonly RunResult[];
  pricing?: PricingTable;
  /** supuestos si no hay historial */
  defaultTokensPerRun?: number;
  defaultSecPerRun?: number;
  /** fracción de tokens de entrada para convertir tokens totales a coste (def 0.8) */
  inputShare?: number;
}

export interface PlanEstimate {
  runs: number;
  tokensPerRun: number;
  tokensTotal: number;
  tokensBasis: "history" | "default";
  secPerRun: number;
  wallSecTotal: number;
  /** null si no se puede estimar (sin precios ni coste observado) */
  costUsdTotal: number | null;
  costUsdPerRun: number | null;
  /** configuraciones cuyo coste no se puede estimar */
  costUnknownFor: string[];
}

export interface Plan {
  schemaVersion: "1";
  experimentId: string;
  design: Experiment["design"];
  seed: number;
  runs: PlannedRun[];
  estimate: PlanEstimate;
  warnings: string[];
}

export function runKey(experimentId: string, scenarioId: string, configurationId: string, repetition: number): string {
  return deterministicId("run", experimentId, scenarioId, configurationId, repetition);
}

export function runKeyOf(r: Pick<RunResult, "experimentId" | "scenarioId" | "configurationId" | "repetition">): string {
  return runKey(r.experimentId ?? "", r.scenarioId, r.configurationId, r.repetition);
}

function seedFor(exp: Experiment, key: string): number {
  return parseInt(deterministicId("seed", exp.seed, key).slice(0, 7), 16);
}

/**
 * Expande el experimento en runs.
 * - interleaved: cada bloque (escenario, repetición) contiene TODAS las configuraciones en orden aleatorio
 *   y los bloques se barajan; así la deriva temporal (carga del proveedor, hora) no sesga una configuración.
 * - blocked: configuraciones barajadas, cada una completa de seguido (útil para depurar; sesgo por deriva).
 * Todo el orden depende solo de exp.seed: mismo experimento + semilla = mismo plan.
 */
export function expandRuns(exp: Experiment): PlannedRun[] {
  const out: Array<Omit<PlannedRun, "index">> = [];
  const mk = (scenarioId: string, configurationId: string, repetition: number): Omit<PlannedRun, "index"> => {
    const key = runKey(exp.id, scenarioId, configurationId, repetition);
    return { key, scenarioId, configurationId, repetition, seed: seedFor(exp, key) };
  };
  if (exp.design === "interleaved") {
    const blocks: Array<Array<Omit<PlannedRun, "index">>> = [];
    for (let rep = 0; rep < exp.repetitions; rep++) {
      for (const sc of exp.scenarios) {
        const cfgs = seededShuffle(exp.configurations, `${exp.seed}|cfg|${sc}|${rep}`);
        blocks.push(cfgs.map((c) => mk(sc, c, rep)));
      }
    }
    for (const b of seededShuffle(blocks, `${exp.seed}|blocks`)) out.push(...b);
  } else {
    for (const c of seededShuffle(exp.configurations, `${exp.seed}|blocked-cfg`)) {
      const units: Array<Omit<PlannedRun, "index">> = [];
      for (let rep = 0; rep < exp.repetitions; rep++) for (const sc of exp.scenarios) units.push(mk(sc, c, rep));
      out.push(...seededShuffle(units, `${exp.seed}|blocked|${c}`));
    }
  }
  return out.map((r, index) => ({ index, ...r }));
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function priceFor(pricing: PricingTable | undefined, cfg: Configuration | undefined): PricePerMTok | null {
  if (!pricing || !cfg) return null;
  const keys = [cfg.provider && cfg.model ? `${cfg.provider}/${cfg.model}` : null, cfg.model, cfg.id].filter((k): k is string => !!k);
  for (const k of keys) if (pricing[k]) return pricing[k]!;
  return null;
}

export function costFromTokens(price: PricePerMTok, totalTokens: number, inputShare = 0.8): number {
  return (totalTokens * inputShare * price.inputPerMTok + totalTokens * (1 - inputShare) * price.outputPerMTok) / 1e6;
}

export function planExperiment(exp: Experiment, o: PlanOptions = {}): Plan {
  const runs = expandRuns(exp);
  const warnings: string[] = [];
  const hist = o.history ?? [];
  const toks = hist.map((r) => r.telemetry.totalTokens).filter((x): x is number => x !== null);
  const secs = hist.map((r) => r.durationMs / 1000);
  const obsTokens = mean(toks);
  const tokensPerRun = Math.min(exp.limits.maxTokens, Math.round(obsTokens ?? o.defaultTokensPerRun ?? 60_000));
  const secPerRun = Math.min(exp.limits.timeoutSec, Math.round(mean(secs) ?? o.defaultSecPerRun ?? 120));
  const cfgById = new Map((o.configurations ?? []).map((c) => [c.id, c]));
  const obsCost = mean(hist.map((r) => r.telemetry.costUsd).filter((x): x is number => x !== null));

  let cost: number | null = 0;
  const costUnknownFor: string[] = [];
  const perCfg = new Map<string, number>();
  for (const r of runs) perCfg.set(r.configurationId, (perCfg.get(r.configurationId) ?? 0) + 1);
  for (const [cid, n] of perCfg) {
    const cfg = cfgById.get(cid);
    const price = priceFor(o.pricing, cfg);
    if (cfg && /^fake/.test(cfg.runner)) continue; // runners simulados: sin coste
    if (price) cost = (cost ?? 0) + n * costFromTokens(price, tokensPerRun, o.inputShare);
    else if (obsCost !== null) cost = (cost ?? 0) + n * obsCost;
    else { costUnknownFor.push(cid); cost = null; }
  }
  if (costUnknownFor.length) {
    // si alguna configuración es desconocida, el total no es fiable
    cost = null;
    warnings.push(`coste no estimable para: ${costUnknownFor.join(", ")} (sin precios ni historial)`);
  }
  if (exp.budget.maxRuns !== null && runs.length > exp.budget.maxRuns) {
    warnings.push(`el presupuesto maxRuns=${exp.budget.maxRuns} recortará el plan de ${runs.length} a ${exp.budget.maxRuns} runs`);
  }
  const wall = runs.length * secPerRun;
  if (exp.budget.maxWallSec !== null && wall > exp.budget.maxWallSec) {
    warnings.push(`tiempo estimado ${Math.round(wall)} s supera maxWallSec=${exp.budget.maxWallSec}`);
  }
  if (cost !== null && cost > exp.budget.maxCost) warnings.push(`coste estimado ${cost.toFixed(2)} USD supera maxCost=${exp.budget.maxCost}`);

  return {
    schemaVersion: "1",
    experimentId: exp.id,
    design: exp.design,
    seed: exp.seed,
    runs,
    estimate: {
      runs: runs.length,
      tokensPerRun,
      tokensTotal: tokensPerRun * runs.length,
      tokensBasis: obsTokens !== null ? "history" : "default",
      secPerRun,
      wallSecTotal: Math.round(wall / exp.concurrency),
      costUsdTotal: cost,
      costUsdPerRun: cost === null || runs.length === 0 ? null : cost / runs.length,
      costUnknownFor,
    },
    warnings,
  };
}
