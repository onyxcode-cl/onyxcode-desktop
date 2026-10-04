import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expandRuns, planExperiment } from "../../src/engine/planner.ts";
import { cfg, experiment } from "./helpers.ts";

const big = (over: Record<string, unknown> = {}) =>
  experiment({ scenarios: ["s1", "s2", "s3", "s4"], configurations: ["a", "b", "c"], repetitions: 4, seed: 7, ...over });

describe("planner", () => {
  test("cubre todas las combinaciones exactamente una vez", () => {
    const runs = expandRuns(big());
    assert.equal(runs.length, 4 * 3 * 4);
    assert.equal(new Set(runs.map((r) => r.key)).size, runs.length);
    assert.deepEqual(runs.map((r) => r.index), runs.map((_, i) => i));
  });

  test("determinista por semilla; semilla distinta => otro orden", () => {
    const a = expandRuns(big()).map((r) => r.key);
    assert.deepEqual(a, expandRuns(big()).map((r) => r.key));
    assert.notDeepEqual(a, expandRuns(big({ seed: 8 })).map((r) => r.key));
  });

  test("intercalado: cada bloque (escenario, repetición) contiene todas las configuraciones juntas", () => {
    const runs = expandRuns(big());
    for (let i = 0; i < runs.length; i += 3) {
      const blk = runs.slice(i, i + 3);
      assert.equal(new Set(blk.map((r) => `${r.scenarioId}|${r.repetition}`)).size, 1);
      assert.deepEqual(blk.map((r) => r.configurationId).sort(), ["a", "b", "c"]);
    }
    // el orden de configuraciones varía entre bloques (aleatorizado)
    const firsts = new Set(Array.from({ length: runs.length / 3 }, (_, k) => runs[k * 3]!.configurationId));
    assert.ok(firsts.size > 1);
  });

  test("blocked: una configuración entera tras otra", () => {
    const runs = expandRuns(big({ design: "blocked" }));
    const seq = runs.map((r) => r.configurationId);
    const changes = seq.filter((c, i) => i > 0 && c !== seq[i - 1]).length;
    assert.equal(changes, 2);
  });

  test("estimación: tokens, tiempo, coste con precios; null sin datos", () => {
    const e = experiment({ configurations: ["cfg-ref"], repetitions: 2 });
    const cfgs = [cfg("cfg-ref", "opencode", { model: "glm" })];
    const sin = planExperiment(e, { configurations: cfgs });
    assert.equal(sin.estimate.costUsdTotal, null);
    assert.ok(sin.warnings.some((w) => /coste no estimable/.test(w)));
    assert.equal(sin.estimate.runs, 6);
    const con = planExperiment(e, { configurations: cfgs, pricing: { glm: { inputPerMTok: 1, outputPerMTok: 5 } }, defaultTokensPerRun: 100_000 });
    // 100k tokens: 80k*1 + 20k*5 = 0.18 USD por run
    assert.ok(Math.abs(con.estimate.costUsdPerRun! - 0.18) < 1e-9);
    assert.ok(Math.abs(con.estimate.costUsdTotal! - 1.08) < 1e-9);
    assert.equal(con.estimate.tokensBasis, "default");
  });

  test("maxRuns y maxCost generan avisos", () => {
    const e = experiment({ budget: { maxCost: 0.01, maxRuns: 2 } });
    const p = planExperiment(e, { configurations: [cfg("cfg-ref", "opencode", { model: "m" }), cfg("cfg-cheat", "opencode", { model: "m" })], pricing: { m: { inputPerMTok: 10, outputPerMTok: 10 } } });
    assert.ok(p.warnings.some((w) => /maxRuns/.test(w)));
    assert.ok(p.warnings.some((w) => /maxCost/.test(w)));
  });
});
