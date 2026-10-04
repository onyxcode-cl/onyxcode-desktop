import { test } from "node:test";
import assert from "node:assert/strict";
import {
  wilson, mcnemarExact, holm, benjaminiHochberg, signFlipTest, wilcoxonSignedRank, passHatK, passAtK,
  bootstrapClusterMean, normQuantile, normCdf, mulberry32, stability, decideMetric, decideOverall,
} from "../../src/stats/index.ts";

const near = (a: number, b: number, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test("normal: cuantil y cdf", () => {
  near(normQuantile(0.975), 1.959964, 1e-5);
  near(normCdf(1.96), 0.9750021, 1e-6);
  near(normCdf(normQuantile(0.3)), 0.3, 1e-9);
});

test("Wilson 5/10 -> [0.2366, 0.7634]", () => {
  const w = wilson(5, 10);
  near(w.lo, 0.2366);
  near(w.hi, 0.7634);
  const z = wilson(0, 10);
  assert.equal(z.lo, 0);
});

test("McNemar exacto b=1,c=8 -> 0.0390625", () => {
  assert.equal(mcnemarExact(1, 8).p, 0.0390625);
  assert.equal(mcnemarExact(0, 0).p, 1);
  assert.equal(mcnemarExact(5, 5).p, 1);
});

test("Holm y BH", () => {
  const h = holm([0.01, 0.04, 0.03, 0.005]);
  [0.03, 0.06, 0.06, 0.02].forEach((v, i) => near(h[i]!, v, 1e-12));
  const bh = benjaminiHochberg([0.01, 0.04, 0.03, 0.005]);
  [0.02, 0.04, 0.04, 0.02].forEach((v, i) => near(bh[i]!, v, 1e-12));
});

test("sign-flip exacto: 5 diferencias positivas -> p=2/32", () => {
  const r = signFlipTest([1, 2, 3, 4, 5]);
  assert.equal(r.method, "exact");
  assert.equal(r.p, 2 / 32);
  assert.equal(signFlipTest([0, 0]).p, 1);
});

test("sign-flip Monte Carlo es determinista con semilla", () => {
  const d = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -0.1 : 0.2));
  const a = signFlipTest(d, { seed: 7, nResamples: 2000 });
  const b = signFlipTest(d, { seed: 7, nResamples: 2000 });
  assert.equal(a.method, "montecarlo");
  assert.equal(a.p, b.p);
});

test("Wilcoxon exacto: n=6 todo positivo -> p=2/64; con empates no revienta", () => {
  assert.equal(wilcoxonSignedRank([1, 2, 3, 4, 5, 6]).p, 2 / 64);
  const t = wilcoxonSignedRank([1, 1, -1, 2, 2, 3]);
  assert.ok(t.p > 0 && t.p <= 1);
  const big = wilcoxonSignedRank(Array.from({ length: 60 }, (_, i) => i + 1));
  assert.equal(big.method, "normal");
  assert.ok(big.p < 0.001);
});

test("pass^k y pass@k", () => {
  near(passHatK(3, 5, 2), (3 / 5) * (2 / 4), 1e-12);
  assert.equal(passHatK(1, 5, 2), 0);
  near(passAtK(1, 5, 2), 1 - (4 / 5) * (3 / 4), 1e-12);
  assert.ok(Number.isNaN(passHatK(1, 2, 3)));
});

test("estabilidad", () => {
  const s = stability([{ caseId: "a", successes: 5, runs: 5 }, { caseId: "b", successes: 0, runs: 5 }, { caseId: "c", successes: 2, runs: 4 }]);
  assert.equal(s.flakyCases, 1);
  near(s.consistency, 2 / 3, 1e-12);
});

test("bootstrap por clúster: determinista y cubre la media", () => {
  const v = [0.1, 0.2, 0.15, 0.3, 0.05, 0.25, 0.2, 0.1];
  const a = bootstrapClusterMean(v, { seed: 3, B: 2000 });
  const b = bootstrapClusterMean(v, { seed: 3, B: 2000 });
  assert.deepEqual(a, b);
  assert.ok(a.lo < a.estimate && a.estimate < a.hi);
  assert.ok(mulberry32(1)() !== mulberry32(2)());
});

test("decisión con MPE", () => {
  const m = 0.05;
  assert.equal(decideMetric({ estimate: 0.15, lo: 0.08, hi: 0.22, margin: m, direction: 1 }).veredicto, "MEJORA");
  assert.equal(decideMetric({ estimate: 0.03, lo: 0.01, hi: 0.04, margin: m, direction: 1 }).veredicto, "MEJORA MENOR");
  assert.equal(decideMetric({ estimate: 0, lo: -0.03, hi: 0.03, margin: m, direction: 1 }).veredicto, "EQUIVALENTE");
  assert.equal(decideMetric({ estimate: -0.15, lo: -0.2, hi: -0.08, margin: m, direction: 1 }).veredicto, "PEOR-REGRESIÓN");
  const wide = decideMetric({ estimate: 0.02, lo: -0.2, hi: 0.24, margin: m, direction: 1 });
  assert.equal(wide.veredicto, "SIN EVIDENCIA");
  assert.equal(wide.powered, false);
  // tokens: bajar es mejor
  assert.equal(decideMetric({ estimate: -0.3, lo: -0.4, hi: -0.2, margin: Math.log(1.1), direction: -1 }).veredicto, "MEJORA");
  assert.equal(decideOverall({ success: "EQUIVALENTE", tokens: "MEJORA" }), "MEJORA");
  assert.equal(decideOverall({ success: "MEJORA", tokens: "PEOR-REGRESIÓN" }), "PEOR-REGRESIÓN");
  assert.equal(decideOverall({ success: "SIN EVIDENCIA", tokens: "MEJORA" }), "SIN EVIDENCIA");
});
