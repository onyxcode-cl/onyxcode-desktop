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

