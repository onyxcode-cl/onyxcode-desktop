import { SCHEMA_VERSION } from "../core/schemas.ts";
import type { EvaluatorKind, EvaluatorResult, EvaluatorSpec, Scenario } from "../core/schemas.ts";
import { antiCheat, buildCheck, gitDiff, restrictions, testsHidden, testsVisible } from "../evaluators/index.ts";
import type { EvalContext, Evaluator, EvaluatorResult as LocalResult } from "../evaluators/index.ts";

export type EvaluatorFactory = (scenario: Scenario, spec: EvaluatorSpec) => Evaluator;

const strArr = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined);

/** Fábricas de los evaluadores del núcleo. Los demás kinds (suite onyx) se inyectan con `extra`. */
export function builtinEvaluators(): Partial<Record<EvaluatorKind, EvaluatorFactory>> {
  return {
    "tests-visible": (_s, spec) => testsVisible({ timeoutMs: spec.timeoutSec * 1000 }),
    "tests-hidden": (_s, spec) => testsHidden({ timeoutMs: spec.timeoutSec * 1000 }),
    build: (_s, spec) => buildCheck({ id: "build", ...(spec.command ? { command: spec.command } : {}), timeoutMs: spec.timeoutSec * 1000 }),
    typecheck: (_s, spec) => buildCheck({ id: "typecheck", ...(spec.command ? { command: spec.command } : {}), timeoutMs: spec.timeoutSec * 1000 }),
    git_diff: (s) => gitDiff(s.constraints.maxChangedFiles !== null ? { maxFiles: s.constraints.maxChangedFiles } : {}),
    restrictions: (s, spec) => {
      const allowed = strArr(spec.params.allowed) ?? (s.constraints.allowedPaths.length ? s.constraints.allowedPaths : undefined);
      const forbidden = strArr(spec.params.forbidden) ?? (s.constraints.forbiddenPaths.length ? s.constraints.forbiddenPaths : undefined);
      return restrictions({ ...(allowed ? { allowed } : {}), ...(forbidden ? { forbidden } : {}) });
    },
    "anti-cheat": (_s, spec) => {
      const p = strArr(spec.params.protectedPaths) ?? strArr(spec.params.testPatterns);
      return antiCheat(p ? { testPatterns: p } : {});
    },
  };
}

/** Traduce el resultado local del evaluador al EvaluatorResult del contrato core. */
export function toCoreResult(kind: EvaluatorKind, r: LocalResult): EvaluatorResult {
  const d = r.details as Record<string, unknown>;
  const summary = d.summary as { pass?: number; total?: number } | null | undefined;
  const violations: string[] = [];
  if (Array.isArray(d.violations)) for (const v of d.violations as Array<Record<string, unknown>>) violations.push(`${String(v.rule ?? "violación")}: ${String(v.file ?? "")}`);
  if (Array.isArray(d.findings)) for (const f of d.findings as Array<Record<string, unknown>>) violations.push(`${String(f.kind ?? "hallazgo")}: ${String(f.file ?? "")}`);
  const applicable = r.applicable && !r.error;
  return {
    schemaVersion: SCHEMA_VERSION,
    kind,
    passed: applicable ? r.pass : null,
    score: applicable ? r.score : null,
    testsPassed: typeof summary?.pass === "number" ? summary.pass : null,
    testsTotal: typeof summary?.total === "number" ? summary.total : null,
    violations,
    details: r.error ? `error: ${r.error}` : !r.applicable ? `no aplica: ${String(d.reason ?? "")}` : JSON.stringify(r.details).slice(0, 4000),
    durationMs: r.durationMs !== null ? Math.round(r.durationMs) : null,
  };
}

export interface EvalOutcome {
  results: EvaluatorResult[];
  /** true si algún evaluador con peso>0 aplicable falló */
  failed: boolean;
  /** true si algún evaluador con peso>0 quedó indeterminado (error de infra, kind no soportado) */
  indeterminate: boolean;
}

export const CORRECTNESS_KINDS: readonly EvaluatorKind[] = ["tests-visible", "tests-hidden", "build", "typecheck"];

export async function runEvaluators(
  scenario: Scenario,
  ctx: EvalContext,
  extra: Partial<Record<EvaluatorKind, EvaluatorFactory>> = {},
): Promise<EvalOutcome> {
  const factories = { ...builtinEvaluators(), ...extra };
  const results: EvaluatorResult[] = [];
  let failed = false;
  let indeterminate = false;
  for (const spec of scenario.evaluators) {
    const factory = factories[spec.kind];
    let res: EvaluatorResult;
    if (!factory) {
      res = { schemaVersion: SCHEMA_VERSION, kind: spec.kind, passed: null, score: null, testsPassed: null, testsTotal: null, violations: [], details: `evaluador no soportado por el motor: ${spec.kind}`, durationMs: null };
    } else {
      try { res = toCoreResult(spec.kind, await factory(scenario, spec).evaluate(ctx)); }
      catch (e) {
        res = { schemaVersion: SCHEMA_VERSION, kind: spec.kind, passed: null, score: null, testsPassed: null, testsTotal: null, violations: [], details: `error: ${String(e)}`, durationMs: null };
      }
    }
    results.push(res);
    // "no aplica" (sin tests ocultos, sin comando) llega con passed null y sin error: no cuenta
    const notApplicable = res.details.startsWith("no aplica");
    if (spec.weight > 0 && !notApplicable) {
      if (res.passed === false) failed = true;
      else if (res.passed === null) indeterminate = true;
    }
  }
  return { results, failed, indeterminate };
}

/** Puntuaciones por familia, ponderadas por weight; null si no hay datos. */
export function scoreSummary(scenario: Scenario, results: EvaluatorResult[]): { correctness: number | null; quality: number | null; efficiency: null } {
  const agg = (pred: (k: EvaluatorKind) => boolean): number | null => {
    let w = 0, s = 0;
    results.forEach((r, i) => {
      const weight = scenario.evaluators[i]?.weight ?? 1;
      if (r.score === null || weight <= 0 || !pred(r.kind)) return;
      w += weight; s += weight * r.score;
    });
    return w > 0 ? s / w : null;
  };
  return { correctness: agg((k) => CORRECTNESS_KINDS.includes(k)), quality: agg((k) => !CORRECTNESS_KINDS.includes(k)), efficiency: null };
}
