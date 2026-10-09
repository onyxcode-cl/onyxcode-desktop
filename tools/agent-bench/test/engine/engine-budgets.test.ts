import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createManualClock } from "../../src/engine/clock.ts";
import { loadScenarios } from "../../src/engine/config.ts";
import type { EngineEvent, RunExperimentOptions } from "../../src/engine/engine.ts";
import { procsCiting } from "../../src/engine/procs.ts";
import { openStore } from "../../src/store/index.ts";
import type { Store } from "../../src/store/index.ts";
import { BENCH_ROOT, CASES, cfg, experiment, rmDir, routerRunner, tmpDir } from "./helpers.ts";
import type { RouterOptions } from "./helpers.ts";
import { byCfg, env, noRunDirsLeft, opts, scenarios } from "./engine-shared.ts";
import { runExperimentHermetic as runExperiment } from "./helpers.ts";

describe("motor: presupuestos y reintentos", () => {
  test("dry-run no escribe ni ejecuta", async () => {
    const e = env();
    let ran = 0;
    const sum = await runExperiment(experiment(), { ...opts(e, { patch: "referencePatch", onRun: () => { ran++; } }), dryRun: true });
    assert.equal(sum.status, "dry-run");
    assert.equal(sum.plan.runs.length, 6);
    assert.equal(ran, 0);
    assert.deepEqual(e.store.listExperimentIds(), []);
  });

  test("maxRuns corta el experimento", async () => {
    const e = env();
    const sum = await runExperiment(experiment({ budget: { maxCost: 0, maxRuns: 2 } }), opts(e, { patch: "referencePatch" }));
    assert.equal(sum.status, "stopped");
    assert.equal(sum.stopReason, "budget_runs");
    assert.equal(sum.results.length, 2);
    assert.equal(sum.pending, 4);
  });

  test("maxCost: para cuando el siguiente run proyecta pasarse", async () => {
    const e = env();
    const sum = await runExperiment(experiment({ budget: { maxCost: 1.0 } }), opts(e, { patch: "referencePatch", cost: true, costUsd: 0.5 }, {}, "costly"));
    assert.equal(sum.stopReason, "budget_cost");
    assert.equal(sum.results.length, 2);
    assert.ok(sum.spentUsd <= 1.0 + 1e-9);
  });

  test("coste no controlable y sin maxRuns => rechazado antes de ejecutar", async () => {
    const e = env();
    let ran = 0;
    const sum = await runExperiment(experiment(), opts(e, { patch: "referencePatch", cost: false, onRun: () => { ran++; } }, {}, "opaque"));
    assert.equal(sum.status, "refused");
    assert.match(sum.refusal ?? "", /coste no controlable/);
    assert.equal(ran, 0);
  });

  test("estimación > maxCost => rechazado", async () => {
    const e = env();
    const sum = await runExperiment(experiment({ budget: { maxCost: 0.01 } }), opts(e, { patch: "referencePatch", cost: true }, { pricing: { "m-cfg-ref": { inputPerMTok: 3, outputPerMTok: 15 }, "m-cfg-cheat": { inputPerMTok: 3, outputPerMTok: 15 } } }, "costly"));
    assert.equal(sum.status, "refused");
    assert.match(sum.refusal ?? "", /coste estimado/);
  });

  test("maxWall con reloj inyectado", async () => {
    const e = env();
    const clock = createManualClock();
    const sum = await runExperiment(experiment({ budget: { maxCost: 0, maxWallSec: 10 } }), opts(e, { patch: "referencePatch", onRun: () => clock.advance(6000) }, { clock }));
    assert.equal(sum.stopReason, "budget_wall");
    assert.equal(sum.results.length, 2);
  });

  test("rate_limited: reintenta hasta 3 veces con backoff exponencial + jitter y persiste el último", async () => {
    const e = env();
    const clock = createManualClock(undefined, () => 0.5);
    const exp = experiment({ scenarios: [CASES[0]], configurations: ["cfg-ref"] });
    const sum = await runExperiment(exp, opts(e, { patch: "referencePatch", base: { failure: { kind: "rate_limit", atEvent: 1 } } }, { clock }));
    assert.equal(sum.results.length, 1);
    assert.equal(sum.results[0]!.outcome, "rate_limited");
    assert.equal(sum.results[0]!.success, null);
    assert.equal(sum.attempts, 4);
    assert.equal(sum.retries, 3);
    assert.deepEqual(clock.sleeps, [1500, 3000, 6000]); // base 2000 * 2^n, mitad fija + mitad aleatoria (0.5)
    assert.equal(e.store.loadRuns("exp-test").length, 1);
  });

  test("rate_limited que se recupera: queda el intento bueno", async () => {
    const e = env();
    const clock = createManualClock();
    const exp = experiment({ scenarios: [CASES[0]], configurations: ["cfg-ref"] });
    const sum = await runExperiment(exp, opts(e, { patch: "referencePatch", outcomeFor: (n) => (n <= 2 ? "rate_limited" : null) }, { clock }));
    assert.equal(sum.attempts, 3);
    assert.equal(sum.results[0]!.outcome, "completed");
    assert.equal(sum.results[0]!.success, true);
  });

  test("parada anticipada por >20 % de infra_error", async () => {
    const e = env();
    const exp = experiment({ repetitions: 2 }); // 12 runs
    const runner = routerRunner({ patch: "referencePatch", onPrepare: () => { throw new Error("disco lleno simulado"); } });
    const sum = await runExperiment(exp, { ...opts(e, { patch: null }), runners: { fake: runner } });
    assert.equal(sum.stopReason, "infra_errors");
    assert.equal(sum.results.length, 5);
    assert.ok(sum.results.every((r) => r.outcome === "infra_error" && r.success === null));
    assert.ok(sum.infraErrorRate > 0.2);
  });

  test("parada por daño (huérfanos tras cleanup)", async () => {
    const e = env();
    const sum = await runExperiment(experiment(), opts(e, { patch: "referencePatch", cleanupOrphans: 1 }));
    assert.equal(sum.stopReason, "damage");
    assert.equal(sum.results.length, 1);
    assert.equal(sum.results[0]!.orphans, 1);
  });

  test("load gate: pausa y reanuda con el reloj inyectado", async () => {
    const e = env();
    const clock = createManualClock();
    let n = 0;
    const events: EngineEvent[] = [];
    const gate = () => (n++ < 2
      ? { schemaVersion: "1" as const, status: "pausa" as const, reason: "carga 0.9/cpu", metrics: { loadPerCpu: 0.9, ncpu: 8, freeMemMB: 4000, thermal: "nominal" as const } }
      : { schemaVersion: "1" as const, status: "ok" as const, metrics: { loadPerCpu: 0.1, ncpu: 8, freeMemMB: 4000, thermal: "nominal" as const } });
    const exp = experiment({ scenarios: [CASES[0]], configurations: ["cfg-ref"] });
    const sum = await runExperiment(exp, opts(e, { patch: "referencePatch" }, { clock, gate, gatePollMs: 5000, onEvent: (x) => events.push(x) }));
    assert.equal(sum.status, "completed");
    assert.equal(sum.pausedMs, 10_000);
    assert.equal(events.filter((x) => x.type === "gate-pause").length, 2);
  });

  test("concurrencia 2 funciona y respeta el límite", async () => {
    const e = env();
    let live = 0, peak = 0;
    const exp = experiment({ concurrency: 2 });
    const sum = await runExperiment(exp, opts(e, { patch: "referencePatch", onRun: () => { live++; peak = Math.max(peak, live); setTimeout(() => { live--; }, 300); } }));
    assert.equal(sum.results.length, 6);
    assert.ok(peak <= 2);
    assert.deepEqual(procsCiting(e.runBase), []);
  });
});

