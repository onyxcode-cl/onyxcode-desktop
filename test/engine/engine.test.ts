import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createManualClock } from "../../src/engine/clock.ts";
import { loadScenarios } from "../../src/engine/config.ts";
import { runExperiment } from "../../src/engine/engine.ts";
import type { EngineEvent, RunExperimentOptions } from "../../src/engine/engine.ts";
import { procsCiting } from "../../src/engine/procs.ts";
import { openStore } from "../../src/store/index.ts";
import type { Store } from "../../src/store/index.ts";
import { BENCH_ROOT, CASES, cfg, experiment, rmDir, routerRunner, tmpDir } from "./helpers.ts";
import type { RouterOptions } from "./helpers.ts";

const scenarios = loadScenarios(BENCH_ROOT, [...CASES]);
const dirs: string[] = [];

function env(): { store: Store; runBase: string } {
  const root = tmpDir();
  dirs.push(root);
  return { store: openStore(join(root, "results")), runBase: join(root, "r") };
}

function opts(e: { store: Store; runBase: string }, ro: RouterOptions, extra: Partial<RunExperimentOptions> = {}, runnerId = "fake"): RunExperimentOptions {
  return {
    store: e.store, runBase: e.runBase, benchRoot: BENCH_ROOT, scenarios, handleSignals: false,
    configurations: [cfg("cfg-ref", runnerId), cfg("cfg-cheat", runnerId)],
    runners: { [runnerId]: routerRunner({ id: runnerId, ...ro }) },
    ...extra,
  };
}

const byCfg = <T extends { configurationId: string }>(rs: T[], id: string): T[] => rs.filter((r) => r.configurationId === id);
const noRunDirsLeft = (runBase: string): boolean => !existsSync(runBase) || readdirSync(runBase).length === 0;

after(() => rmDir(...dirs));

describe("motor: ciclo completo con FakeRunner sobre casos node", () => {
  test("referencia pasa, tramposo falla; sin huérfanos ni workspaces; índice reconstruible", async () => {
    const e = env();
    const events: EngineEvent[] = [];
    // configuración "ref" aplica el parche de referencia; "cheat" el tramposo: dos runners por id de configuración
    const ref = routerRunner({ id: "fake", patch: "referencePatch" });
    const cheat = routerRunner({ id: "fake2", patch: "cheatPatch" });
    const sum = await runExperiment(experiment(), {
      store: e.store, runBase: e.runBase, benchRoot: BENCH_ROOT, scenarios, handleSignals: false,
      configurations: [cfg("cfg-ref", "fake"), cfg("cfg-cheat", "fake2")],
      runners: { fake: ref, fake2: cheat },
      onEvent: (x) => events.push(x),
    });
    assert.equal(sum.status, "completed");
    assert.equal(sum.results.length, 6);
    for (const r of byCfg(sum.results, "cfg-ref")) {
      assert.equal(r.outcome, "completed", r.error ?? "");
      assert.equal(r.success, true, JSON.stringify(r.evaluators.map((x) => [x.kind, x.passed, x.details.slice(0, 120)])));
      assert.ok(r.evaluators.some((x) => x.kind === "tests-hidden" && x.passed === true));
      assert.equal(r.orphans, 0);
      assert.ok(r.gitDiff && r.gitDiff.includes("diff --git"));
      assert.ok(r.telemetry.filesModified && r.telemetry.filesModified.length > 0);
      assert.equal(r.telemetry.costUsd, null); // no declarado => null, nunca 0
      assert.equal(r.telemetry.peakContext, null);
    }
    for (const r of byCfg(sum.results, "cfg-cheat")) {
      assert.equal(r.outcome, "completed");
      assert.equal(r.success, false, "el parche tramposo no debe pasar");
    }
    assert.deepEqual(procsCiting(e.runBase), []);
    assert.ok(noRunDirsLeft(e.runBase), "los workspaces se borran");
    // persistencia
    assert.equal(e.store.loadRuns("exp-test").length, 6);
    const rep = e.store.rebuildIndex();
    assert.equal(rep.runs, 6);
    assert.equal(e.store.queryRuns({ experimentId: "exp-test", success: true }).length, 3);
    // intercalado: los 6 runs agrupan configuraciones por bloque (escenario, rep)
    assert.equal(events.filter((x) => x.type === "run-start").length, 6);
    // reanudar no repite
    const again = await runExperiment(experiment(), {
      store: e.store, runBase: e.runBase, benchRoot: BENCH_ROOT, scenarios, handleSignals: false,
      configurations: [cfg("cfg-ref", "fake"), cfg("cfg-cheat", "fake2")], runners: { fake: ref, fake2: cheat },
    });
    assert.equal(again.skipped, 6);
    assert.equal(again.results.length, 0);
    assert.equal(again.attempts, 0);
  });

  test("los tests ocultos no están en el workspace del agente, solo en la copia de evaluación", async () => {
    const e = env();
    const seen: string[] = [];
    const runner = routerRunner({ patch: "referencePatch", onRun: () => { seen.push("run"); } });
    const exp = experiment({ scenarios: [CASES[0]], configurations: ["cfg-ref"] });
    const sum = await runExperiment(exp, { ...opts(e, { patch: "referencePatch" }), runners: { fake: runner }, keepRunDirs: true });
    assert.equal(sum.results[0]!.success, true);
    const root = join(e.runBase, readdirSync(e.runBase)[0]!);
    assert.ok(!existsSync(join(root, "ws", "test-hidden")), "ws sin ocultos");
    assert.ok(existsSync(join(root, "eval", "test-hidden")), "eval con ocultos");
  });

  test("agente que deja un huérfano: se barre, orphans 0, resultado válido", async () => {
    const e = env();
    const exp = experiment({ scenarios: [CASES[0]], configurations: ["cfg-ref"] });
    const sum = await runExperiment(exp, opts(e, { patch: "referencePatch", base: { failure: { kind: "orphan" }, children: 0 } }));
    const r = sum.results[0]!;
    assert.equal(r.orphans, 0);
    assert.equal(r.outcome, "completed");
    assert.equal(r.success, false); // el guion del huérfano sale antes de aplicar el parche
    assert.deepEqual(procsCiting(e.runBase), []);
  });

  test("hung => success false (evaluado), sin huérfanos", async () => {
    const e = env();
    const exp = experiment({ scenarios: [CASES[0]], configurations: ["cfg-ref"], limits: { timeoutSec: 20, inactivitySec: 1 } });
    const sum = await runExperiment(exp, opts(e, { patch: "referencePatch", base: { failure: { kind: "hang", atEvent: 1 } } }));
    assert.equal(sum.results[0]!.outcome, "hung");
    assert.equal(sum.results[0]!.success, false);
    assert.equal(sum.results[0]!.orphans, 0);
    assert.deepEqual(procsCiting(e.runBase), []);
  });
});

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

describe("motor: apagado limpio", () => {
  test("SIGINT cancela el run en curso, mata el árbol y no deja huérfanos", async () => {
    const e = env();
    const slow = { events: Array.from({ length: 30 }, () => ({ type: "tool_call" as const, name: "sleepy", delayMs: 1000 })), children: 2 };
    const exp = experiment();
    const t0 = Date.now();
    const before = process.listenerCount("SIGINT");
    const p = runExperiment(exp, { ...opts(e, { patch: "referencePatch", base: slow }), handleSignals: true });
    await new Promise((r) => setTimeout(r, 1200));
    process.emit("SIGINT");
    const sum = await p;
    assert.ok(Date.now() - t0 < 10_000, "apagado en <10 s");
    assert.equal(sum.status, "cancelled");
    assert.equal(sum.results.length, 1);
    assert.equal(sum.results[0]!.outcome, "cancelled");
    assert.equal(sum.results[0]!.success, null);
    assert.equal(sum.results[0]!.orphans, 0);
    assert.deepEqual(procsCiting(e.runBase), []);
    assert.ok(noRunDirsLeft(e.runBase));
    assert.equal(process.listenerCount("SIGINT"), before);
  });

  test("AbortSignal externo", async () => {
    const e = env();
    const ac = new AbortController();
    const slow = { events: Array.from({ length: 30 }, () => ({ type: "tool_call" as const, name: "sleepy", delayMs: 1000 })), children: 1 };
    const p = runExperiment(experiment(), { ...opts(e, { patch: "referencePatch", base: slow }), signal: ac.signal });
    await new Promise((r) => setTimeout(r, 800));
    ac.abort();
    const sum = await p;
    assert.equal(sum.status, "cancelled");
    assert.equal(sum.results[0]!.outcome, "cancelled");
    assert.deepEqual(procsCiting(e.runBase), []);
  });
});

describe("motor: aislamiento Seatbelt obligatorio para runners reales", () => {
  const sc = (e: ReturnType<typeof env>, runnerId: string, ro: RouterOptions) => runExperiment(experiment({ scenarios: [CASES[0]], repetitions: 1, budget: { maxCost: 5 } }), {
    ...opts(e, { patch: "referencePatch", cost: true, costUsd: 0.01, ...ro }, {}, runnerId),
  });

  test("runner real con Seatbelt: environment.isolation = seatbelt; fake: none", async () => {
    const real = await sc(env(), "realrunner", { isolation: "seatbelt" });
    assert.ok(real.results.length > 0);
    for (const r of real.results) assert.equal(r.environment.isolation, process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") ? "seatbelt" : "none");
  });

  test("runner real sin aislamiento => rehúsa (infra_error, sin ejecutar el runner)", async () => {
    let ran = 0;
    const sum = await sc(env(), "realrunner", { isolation: "none", onRun: () => { ran++; }, onPrepare: () => { ran++; } });
    assert.equal(ran, 0);
    assert.ok(sum.results.length > 0);
    for (const r of sum.results) {
      assert.equal(r.outcome, "infra_error");
      assert.equal(r.success, null);
      assert.match(r.error ?? "", /rehúso correr el runner real/);
      assert.equal(r.environment.isolation, "none");
    }
  });
});
