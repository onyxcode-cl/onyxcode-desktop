import { test } from "node:test";
import assert from "node:assert/strict";
import { compareConfigs, summarizeConfig, estimatePower, minimumDetectableEffect, mulberry32 } from "../../src/stats/index.ts";
import type { RunRow } from "../../src/stats/index.ts";

function synth(seed: number, cases: number, reps: number, pA: number, pB: number, tokB: number): RunRow[] {
  const rng = mulberry32(seed);
  const rows: RunRow[] = [];
  for (let c = 0; c < cases; c++) {
    for (let r = 0; r < reps; r++) {
      for (const [cfg, p, tok] of [["A", pA, 1000], ["B", pB, tokB]] as const) {
        const ok = rng() < p;
        rows.push({ caseId: `c${c}`, configId: cfg, success: ok, tokens: tok * (0.8 + 0.4 * rng()), durationMs: 5000 * (0.8 + 0.4 * rng()), outcome: "completed", rep: r });
      }
    }
  }
  return rows;
}

test("comparación: mejora grande de éxito y ahorro de tokens", () => {
  const rows = synth(11, 20, 4, 0.3, 0.9, 700);
  const cmp = compareConfigs(rows, "A", "B", { B: 2000, seed: 5 });
  assert.equal(cmp.itt.metrics.success?.decision.veredicto, "MEJORA");
  assert.equal(cmp.itt.metrics.tokens?.decision.veredicto, "MEJORA");
  assert.equal(cmp.itt.overall, "MEJORA");
  assert.ok((cmp.itt.metrics.tokens?.pctChange ?? 0) < -0.2);
  assert.ok((cmp.itt.metrics.success?.mcnemar?.p ?? 1) < 0.05);
});

test("configuraciones idénticas con muchos datos: no hay mejora ni regresión", () => {
  const rows = synth(3, 20, 5, 0.6, 0.6, 1000);
  const cmp = compareConfigs(rows, "A", "B", { B: 2000, seed: 5 });
  assert.ok(["EQUIVALENTE", "SIN EVIDENCIA"].includes(cmp.itt.overall), cmp.itt.overall);
});

test("ITT vs PP: infra_error cuenta como fallo en ITT y se excluye en PP; null no es 0", () => {
  const rows: RunRow[] = [];
  for (let c = 0; c < 6; c++) {
    rows.push({ caseId: `c${c}`, configId: "A", success: true, tokens: 100, durationMs: 1000, outcome: "completed" });
    rows.push({ caseId: `c${c}`, configId: "A", success: null, tokens: null, durationMs: null, outcome: "infra_error" });
  }
  const itt = summarizeConfig(rows, "A", "ITT");
  const pp = summarizeConfig(rows, "A", "PP");
  assert.equal(itt.rate, 0.5);
  assert.equal(pp.rate, 1);
  assert.equal(itt.tokens.nulls, 6);
  assert.ok(Math.abs(itt.tokens.geoMean - 100) < 1e-9);
});

test("potencia Monte Carlo: respeta topes y es determinista", () => {
  const spec = { nCases: 20, reps: 3, baseRate: 0.5, delta: 0.3 };
  const a = estimatePower(spec, { sims: 400, seed: 2 });
  const b = estimatePower(spec, { sims: 400, seed: 2 });
  assert.equal(a.power, b.power);
  assert.ok(a.power > 0.5);
  assert.equal(estimatePower(spec, { sims: 999999, seed: 2, maxMs: 1, now: (() => { let t = 0; return () => (t += 10); })() }).truncated, true);
  const nul = estimatePower({ ...spec, delta: 0 }, { sims: 400, seed: 2 });
  assert.ok(nul.power < 0.15);
});

test("MDE: delta mayor con menos casos", () => {
  const few = minimumDetectableEffect({ nCases: 6, reps: 2, baseRate: 0.5 }, { sims: 600, seed: 1 });
  const many = minimumDetectableEffect({ nCases: 30, reps: 5, baseRate: 0.5 }, { sims: 600, seed: 1 });
  assert.ok((many.mde ?? 1) <= (few.mde ?? 1));
  assert.ok(many.simsTotal <= 5000);
});
