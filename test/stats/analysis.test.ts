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
  // M1: infra_error no entra en tokens/duración ni siquiera en ITT.
  assert.equal(itt.tokens.nulls, 0);
  assert.equal(itt.tokens.n, 6);
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

// ---- Cambios tras la auditoría ----
import { dedupeRows, decideMetric, decideOverall, marginFor, marginLossFor, holm, benjaminiHochberg, normCdf, normSf, perCaseValues, wilcoxonSignedRank } from "../../src/stats/index.ts";

function flat(cases: number, reps: number, okA: boolean, okB: boolean): RunRow[] {
  const rows: RunRow[] = [];
  for (let c = 0; c < cases; c++) for (let r = 0; r < reps; r++) for (const [cfg, ok] of [["A", okA], ["B", okB]] as const) {
    rows.push({ caseId: `c${c}`, configId: cfg, success: ok, tokens: 1000, durationMs: 5000, outcome: "completed", rep: r });
  }
  return rows;
}

test("A8: todas las diferencias 0 (techo 100 %/100 %) no es EQUIVALENTE: IC con suelo intra-caso => SIN EVIDENCIA", () => {
  const c = compareConfigs(flat(10, 1, true, true), "A", "B", { B: 300 });
  const s = c.itt.metrics.success!;
  assert.equal(s.withinFloorApplied, true);
  assert.ok(s.ci.hi - s.ci.lo > 0.1);
  assert.equal(s.decision.veredicto, "SIN EVIDENCIA");
  assert.equal(c.itt.overall, "SIN EVIDENCIA");
});

test("A8: con pocos casos (3 x 1 rep) o menos de minCases: SIN EVIDENCIA y powered=false; minCases es configurable", () => {
  const few = compareConfigs(flat(3, 1, true, true), "A", "B", { B: 300 });
  assert.equal(few.itt.metrics.success!.decision.veredicto, "SIN EVIDENCIA");
  assert.equal(few.itt.metrics.success!.decision.powered, false);
  assert.match(few.itt.metrics.success!.decision.razon, /mínimo 10/);
  const rows = synth(3, 6, 5, 0.3, 0.9, 1000);
  assert.match(compareConfigs(rows, "A", "B", { B: 300 }).itt.metrics.success!.decision.razon, /mínimo 10/);
  const relaxed = compareConfigs(rows, "A", "B", { B: 300, minCases: 5 }).itt.metrics.success!.decision;
  assert.doesNotMatch(relaxed.razon, /mínimo/);
  // 10 casos con efecto claro sí dan MEJORA con el mínimo por defecto.
  assert.equal(compareConfigs(synth(3, 10, 5, 0.2, 0.95, 1000), "A", "B", { B: 300 }).itt.metrics.success!.decision.veredicto, "MEJORA");
});

test("A8: decideMetric con IC de ancho 0 no es EQUIVALENTE", () => {
  const d = decideMetric({ estimate: 0, lo: 0, hi: 0, margin: 0.05, direction: 1 });
  assert.equal(d.veredicto, "SIN EVIDENCIA");
  assert.equal(d.powered, false);
});

test("A9: duplicados por (caso, config, rep): se queda el último intento y se cuenta lo descartado", () => {
  const rows: RunRow[] = [];
  for (let c = 0; c < 4; c++) {
    rows.push({ caseId: `c${c}`, configId: "A", success: null, tokens: null, durationMs: 10, outcome: "infra_error", rep: 0, runId: "a", finishedAt: "2026-01-01T00:00:00Z" });
    rows.push({ caseId: `c${c}`, configId: "A", success: true, tokens: 100, durationMs: 1000, outcome: "completed", rep: 0, runId: "b", finishedAt: "2026-01-01T00:05:00Z" });
  }
  const dd = dedupeRows(rows);
  assert.equal(dd.discarded, 4);
  assert.equal(dd.rows.length, 4);
  assert.ok(dd.rows.every((r) => r.outcome === "completed"));
  // Orden de llegada invertido: gana igualmente el finishedAt más tardío.
  assert.equal(dedupeRows([...rows].reverse()).rows.every((r) => r.outcome === "completed"), true);
  assert.equal(summarizeConfig(rows, "A", "ITT").rate, 1);
  assert.equal(summarizeConfig(rows, "A", "ITT").runs, 4);
});

test("M1: tokens y duración excluyen infra_error, cancelled y rate_limited también en ITT", () => {
  const rows: RunRow[] = [];
  for (const [i, o] of (["completed", "infra_error", "cancelled", "rate_limited"] as const).entries()) {
    rows.push({ caseId: "c0", configId: "A", success: o === "completed" ? true : null, tokens: o === "completed" ? 100 : 5, durationMs: o === "completed" ? 1000 : 1, outcome: o, rep: i });
  }
  assert.ok(Math.abs(perCaseValues(rows, "tokens").get("c0")! - Math.log(100)) < 1e-12);
  assert.ok(Math.abs(perCaseValues(rows, "duration").get("c0")! - Math.log(1000)) < 1e-12);
  const itt = summarizeConfig(rows, "A", "ITT");
  assert.equal(itt.rate, 0.25); // ITT sí cuenta el fallo de éxito
  assert.ok(Math.abs(itt.duration.geoMean - 1000) < 1e-9);
  assert.equal(itt.tokens.n, 1);
});

test("M2: Holm degrada una MEJORA cuyo p ajustado no supera alpha y lo reporta", () => {
  // 10 casos: 4 con mejora fuerte y 6 sin cambio => IC bootstrap sobre 0, pero sign-flip exacto sobre 4 pares: p=0.125.
  const rows: RunRow[] = [];
  for (let c = 0; c < 10; c++) {
    rows.push({ caseId: `c${c}`, configId: "A", success: false, tokens: 100, durationMs: 100, outcome: "completed", rep: 0 });
    rows.push({ caseId: `c${c}`, configId: "B", success: c < 4, tokens: 100, durationMs: 100, outcome: "completed", rep: 0 });
  }
  const s = compareConfigs(rows, "A", "B", { B: 2000, mpe: { success: 0.01, tokens: 0.1, duration: 0.15 } }).itt.metrics.success!;
  assert.ok(s.pSignFlipHolm >= 0.125 - 1e-9);
  assert.notEqual(s.decision.veredicto, "MEJORA");
  assert.notEqual(s.decision.veredicto, "MEJORA MENOR");
  // Con efecto claro en las 3 métricas, p ajustado <= alpha y se conserva el veredicto.
  const big = compareConfigs(synth(5, 20, 3, 0.2, 0.95, 400), "A", "B", { B: 500 });
  assert.equal(big.itt.metrics.success!.holmDowngraded, false);
  assert.equal(big.itt.metrics.success!.decision.veredicto, "MEJORA");
  assert.ok(big.itt.metrics.tokens!.pSignFlipHolm >= big.itt.metrics.tokens!.pSignFlip);
});

test("M3: la potencia simula la regla IC>MPE (menor que IC>0) y avisa del recorte de pB", () => {
  const spec = { nCases: 20, reps: 5, baseRate: 0.5, delta: 0.1 };
  const real = estimatePower(spec, { sims: 300, seed: 4 });
  const zero = estimatePower({ ...spec, rule: "zero" }, { sims: 300, seed: 4 });
  assert.equal(real.rule, "mpe");
  assert.ok(real.power < zero.power, `${real.power} < ${zero.power}`);
  assert.ok(estimatePower({ ...spec, delta: 0 }, { sims: 300, seed: 4 }).power <= 0.1);
  const nearTop = estimatePower({ nCases: 20, reps: 5, baseRate: 0.95, delta: 0.2 }, { sims: 100, seed: 4 });
  assert.equal(nearTop.deltaClipped, true);
  assert.ok(nearTop.effectiveDelta < 0.19);
  assert.equal(estimatePower(spec, { sims: 50, seed: 4 }).deltaClipped, false);
  assert.equal(estimatePower({ ...spec, nCases: 5 }, { sims: 50, seed: 4 }).power, 0); // < minCases
});

test("M4: margen log asimétrico, POSIBLE-REGRESIÓN y decideOverall exige éxito >= EQUIVALENTE", () => {
  const mpe = { success: 0.05, tokens: 0.1, duration: 0.15 };
  assert.ok(Math.abs(marginFor("tokens", mpe) - -Math.log(0.9)) < 1e-12);
  assert.ok(Math.abs(marginLossFor("tokens", mpe) - Math.log(1.1)) < 1e-12);
  // Una reducción del 9,1 % (ln 0,909 = -0,0953) ya no cuenta como 10 %: el IC completo en -9,1 % no es MEJORA.
  const lr = Math.log(1 - 0.091);
  const d9 = decideMetric({ estimate: lr, lo: lr - 0.001, hi: lr + 0.001, margin: marginFor("tokens", mpe), marginLoss: marginLossFor("tokens", mpe), direction: -1 });
  assert.equal(d9.veredicto, "MEJORA MENOR");
  const lr11 = Math.log(0.88);
  assert.equal(decideMetric({ estimate: lr11, lo: lr11 - 0.001, hi: lr11 + 0.001, margin: marginFor("tokens", mpe), marginLoss: marginLossFor("tokens", mpe), direction: -1 }).veredicto, "MEJORA");
  // IC entre -margen y 0: POSIBLE-REGRESIÓN (antes EQUIVALENTE o SIN EVIDENCIA).
  assert.equal(decideMetric({ estimate: -0.03, lo: -0.04, hi: -0.01, margin: 0.05, direction: 1 }).veredicto, "POSIBLE-REGRESIÓN");
  assert.equal(decideMetric({ estimate: -0.05, lo: -0.09, hi: -0.01, margin: 0.05, direction: 1 }).veredicto, "POSIBLE-REGRESIÓN");
  assert.equal(decideOverall({ success: "POSIBLE-REGRESIÓN", tokens: "MEJORA" }), "POSIBLE-REGRESIÓN");
  assert.equal(decideOverall({ success: "EQUIVALENTE", tokens: "MEJORA" }), "MEJORA");
  assert.equal(decideOverall({ success: "EQUIVALENTE", tokens: "POSIBLE-REGRESIÓN" }), "POSIBLE-REGRESIÓN");
  assert.equal(decideOverall({ success: "MEJORA", tokens: "POSIBLE-REGRESIÓN" }), "MEJORA");
  assert.equal(decideOverall({ success: "PEOR-REGRESIÓN", tokens: "MEJORA" }), "PEOR-REGRESIÓN");
});

test("B2: McNemar a nivel de caso excluye empates exactos (tasa 0.5) y los cuenta", () => {
  const rows: RunRow[] = [];
  for (let c = 0; c < 10; c++) for (let r = 0; r < 2; r++) {
    rows.push({ caseId: `c${c}`, configId: "A", success: c < 4 ? r === 0 : true, tokens: 1, durationMs: 1, outcome: "completed", rep: r });
    rows.push({ caseId: `c${c}`, configId: "B", success: c < 4 ? r === 0 : false, tokens: 1, durationMs: 1, outcome: "completed", rep: r });
  }
  const mc = compareConfigs(rows, "A", "B", { B: 200 }).itt.metrics.success!.mcnemar!;
  assert.deepEqual({ b: mc.b, c: mc.c, ties: mc.ties }, { b: 6, c: 0, ties: 4 });
});

test("B3: normCdf conserva precisión relativa en colas y Holm/BH ignoran NaN", () => {
  assert.ok(Math.abs(normCdf(-6) / 9.865876450376946e-10 - 1) < 1e-9);
  assert.ok(Math.abs(normCdf(-10) / 7.619853024160527e-24 - 1) < 1e-9);
  assert.ok(normCdf(-9) > 0 && normCdf(-9) < 1e-18);
  assert.ok(Math.abs(normSf(8.5) / 9.479534822203318e-18 - 1) < 1e-9);
  assert.ok(Math.abs(normCdf(2.999999) + normCdf(-2.999999) - 1) < 1e-14);
  assert.ok(Math.abs(normCdf(0.5) - 0.6914624612740131) < 1e-14);
  assert.ok(wilcoxonSignedRank(Array.from({ length: 60 }, (_, i) => i + 1)).p < 1e-9);
  const h = holm([0.01, NaN, 0.04, 0.03, 0.005]);
  assert.deepEqual(h.filter(Number.isFinite).map((x) => +x.toFixed(10)), [0.03, 0.06, 0.06, 0.02]);
  assert.ok(Number.isNaN(h[1]));
  const b = benjaminiHochberg([0.01, NaN, 0.04]);
  assert.ok(Number.isNaN(b[1]) && b[0]! <= 0.02 + 1e-12);
  assert.deepEqual(holm([0.01, 0.04, 0.03, 0.005]).map((x) => +x.toFixed(10)), [0.03, 0.06, 0.06, 0.02]);
});
