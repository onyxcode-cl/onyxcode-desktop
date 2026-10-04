import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { cleanTargets, latestMtimeMs } from "../../src/cli/commands.ts";
import { isAlive } from "../../src/core/proc.ts";
import { emptyTelemetry } from "../../src/core/schemas.ts";
import { loadScenarios } from "../../src/engine/config.ts";
import { runExperiment } from "../../src/engine/engine.ts";
import { sweepTree } from "../../src/engine/procs.ts";
import { OpenCodeRunner } from "../../src/runners/opencode/index.ts";
import { ImmutableRecordError, openStore } from "../../src/store/index.ts";
import { BENCH_ROOT, cfg, experiment, rmDir, tmpDir } from "../engine/helpers.ts";
import { actRunner } from "./harness.ts";

const dirs: string[] = [];
const pids: number[] = [];
after(() => { for (const p of pids) { try { process.kill(-p, "SIGKILL"); } catch { /* ya muerto */ } try { process.kill(p, "SIGKILL"); } catch { /* ya muerto */ } } rmDir(...dirs); });
const mk = () => { const d = tmpDir(); dirs.push(d); return d; };

describe("M5: clean no borra runs vivos ni con escrituras recientes dentro de ws/", () => {
  test("mtime recursivo: un directorio viejo con un archivo reciente dentro NO es viejo", () => {
    const home = mk();
    const run = join(home, "ab", "r", "abcdef12");
    mkdirSync(join(run, "ws"), { recursive: true });
    writeFileSync(join(run, "ws", "x.txt"), "x");
    const old = new Date(Date.now() - 3 * 3600_000);
    utimesSync(run, old, old);
    utimesSync(join(run, "ws"), old, old);
    // el archivo interior sigue reciente: antes se miraba solo el mtime del directorio del run (viejo)
    assert.ok(Date.now() - latestMtimeMs(run) < 60_000);
    const t = cleanTargets(home, false, Date.now(), () => false);
    const e = t.flatMap((x) => x.entries).find((x) => x.path === run)!;
    assert.equal(e.skipped, true);
  });

  test("un run con un proceso vivo que cita su ruta no se borra, ni con --force", async () => {
    const home = mk();
    const run = join(home, "ab", "r", "deadbeef");
    mkdirSync(run, { recursive: true });
    const old = new Date(Date.now() - 3 * 3600_000);
    utimesSync(run, old, old);
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)", run], { detached: true, stdio: "ignore" });
    child.unref();
    pids.push(child.pid!);
    await new Promise((r) => setTimeout(r, 400));
    const e = cleanTargets(home, true).flatMap((x) => x.entries).find((x) => x.path === run)!;
    assert.equal(e.skipped, true);
    assert.equal(e.inUse, true);
    process.kill(child.pid!, "SIGKILL");
    await new Promise((r) => setTimeout(r, 300));
    const e2 = cleanTargets(home, true).flatMap((x) => x.entries).find((x) => x.path === run)!;
    assert.equal(e2.skipped, false);
  });
});

describe("M6: el barrido encuentra procesos marcados por entorno aunque no citen el runRoot", () => {
  test("demonio desligado con cwd=/ y marca AB_RUN_ROOT muere con sweepTree", async () => {
    const root = realpathSync(mk());
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], {
      cwd: "/", detached: true, stdio: "ignore", env: { PATH: process.env.PATH ?? "", AB_RUN_ROOT: root },
    });
    child.unref();
    pids.push(child.pid!);
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(isAlive(child.pid!));
    const r = await sweepTree({ pid: null, roots: [root], graceMs: 300 });
    assert.ok(r.targeted.includes(child.pid!), "no lo encontró por la marca de entorno");
    assert.deepEqual(r.leftover, []);
    assert.equal(isAlive(child.pid!), false);
  });

  test("OpenCodeRunner expone el pid del servidor en raw", async () => {
    const { makeCtx, cfg: rcfg, limits } = await import("../runners-real/helpers.ts");
    const { ctx, done } = makeCtx();
    try {
      const runner = new OpenCodeRunner();
      const p = await runner.prepare(ctx, rcfg("opencode", "fake-opencode.ts", "ok"));
      const raw = await runner.run(p, { scenarioId: "s", prompt: "x" }, limits(), new AbortController().signal);
      assert.equal(typeof (raw.raw as { pid?: unknown }).pid, "number");
      await runner.cleanup(p);
    } finally { done(); }
  });
});

describe("M7: un fallo interno en un worker detiene a los demás y no deja runs sin control", () => {
  test("writeRun lanza con concurrencia 2: se detiene (error), sin procesos vivos y con aviso", async () => {
    const root = mk();
    const store = openStore(join(root, "results"));
    let calls = 0;
    const real = store.writeRun.bind(store);
    store.writeRun = (r) => { if (++calls === 1) throw new Error("disco lleno simulado"); return real(r); };
    const scenarios = loadScenarios(BENCH_ROOT, ["node-l1-002-leap-year", "node-l1-003-slugify"]);
    const sum = await runExperiment(
      experiment({ scenarios: ["node-l1-002-leap-year", "node-l1-003-slugify"], configurations: ["cfg-a"], repetitions: 3, concurrency: 2 }),
      { store, runBase: join(root, "r"), benchRoot: BENCH_ROOT, scenarios, handleSignals: false, configurations: [cfg("cfg-a")], runners: { fake: actRunner({ act: async () => { await new Promise((r) => setTimeout(r, 150)); } }) } },
    );
    assert.equal(sum.stopReason, "error");
    assert.equal(sum.status, "stopped");
    assert.ok(sum.warnings.some((w) => /fallo interno/.test(w)));
    assert.ok(sum.pending > 0);
    store.close();
  });
});

describe("M11: reanudar con otros límites no lanza ImmutableRecordError", () => {
  test("cambiar maxCost/timeout/seed/concurrencia se anota en el diario; cambiar repeticiones sí falla con detalle", () => {
    const store = openStore(join(mk(), "results"));
    const base = experiment({ budget: { maxCost: 1 } });
    store.writeExperiment(base);
    store.writeExperiment(experiment({ budget: { maxCost: 5 }, limits: { timeoutSec: 99, inactivitySec: 10 }, seed: 99 }));
    const j = store.readJournal(base.id).find((x) => x.event === "params-changed");
    assert.ok(j, "debe anotar el cambio de parámetros");
    assert.deepEqual((j!.fields as string[]).sort(), ["budget", "limits", "seed"]);
    assert.equal(store.readExperiment(base.id)!.budget.maxCost, 1, "el manifiesto original no se reescribe");
    assert.throws(() => store.writeExperiment(experiment({ repetitions: 9 })), (e: unknown) => e instanceof ImmutableRecordError && /repetitions/.test((e as Error).message));
    store.close();
  });
});

describe("M10: la sqlite del run (escribible por el agente) no puede falsear los tokens observados por el SSE", () => {
  test("sqlite con tokens a 0 vs step-finish observados en el SSE: manda el SSE y se anota", async () => {
    const root = mk();
    const xdg = join(root, "data");
    mkdirSync(join(xdg, "opencode"), { recursive: true });
    const db = new DatabaseSync(join(xdg, "opencode", "opencode.db"));
    db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, title TEXT);
CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
    db.prepare("INSERT INTO session VALUES (?,?,?)").run("ses_main", null, "main");
    const zero = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    db.prepare("INSERT INTO message VALUES (?,?,?,?)").run("m1", "ses_main", 1, JSON.stringify({ sessionID: "ses_main", role: "assistant", cost: 0, tokens: zero }));
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?)").run("p1", "m1", "ses_main", 2, JSON.stringify({ sessionID: "ses_main", messageID: "m1", type: "step-finish", tokens: zero }));
    db.close();
    const real = { input: 1000, output: 200, reasoning: 0, cache: { read: 0, write: 0 } };
    const runner = new OpenCodeRunner();
    const raw = {
      verdict: "completed", stopReason: "idle", sessionId: "ses_main", baseUrl: null, messages: [], diff: [], retries: [], sweptOrphans: [],
      stepFinishCount: 1, eventCount: 1, eventTypes: {}, errorMessage: null, serverOrphans: [], unverified: [], observedSteps: { p1: { tokens: real } },
    };
    const prepared = { ctx: {}, configuration: {}, state: { xdgData: xdg } } as never;
    const c = await runner.collect(prepared, { outcome: "completed", exitCode: 0, durationMs: 1, artifacts: [], error: null, raw: raw as never });
    assert.equal(c.telemetry.totalTokens, 1200);
    assert.equal((c.telemetry.extra.telemetryIntegrity as { status: string }).status, "sqlite_mismatch");
    void emptyTelemetry; void readFileSync; void rmSync; void mkdtempSync; void tmpdir; void spawnSync;
  });
});

describe("ExperimentalWarning de node:sqlite", () => {
  test("el lanzador bin/agent-bench no lo imprime", () => {
    const res = join(mk(), "res");
    mkdirSync(res);
    const r = spawnSync(process.execPath, [join(BENCH_ROOT, "bin", "agent-bench"), "list", "runs", "--results", res], { encoding: "utf8", timeout: 30_000, cwd: BENCH_ROOT });
    assert.match(r.stdout, /Runs: 0/);
    assert.ok(!/ExperimentalWarning/.test(r.stderr), r.stderr);
  });
});
