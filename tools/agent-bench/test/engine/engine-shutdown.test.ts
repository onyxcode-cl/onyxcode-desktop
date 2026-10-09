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
  const sc = (e: ReturnType<typeof env>, runnerId: string, ro: Partial<RouterOptions>) => runExperiment(experiment({ scenarios: [CASES[0]], repetitions: 1, budget: { maxCost: 5 } }), {
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
