import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkspace, killTreeAndSignal, signalIfNoOrphans, TreeDeadSignal } from "../src/workspace/index.ts";
import { testsVisible, toCoreEvaluatorResult, notApplicable, infraError } from "../src/evaluators/index.ts";
import { EvaluatorResultSchema, RunResultSchema, emptyTelemetry, type RunResult } from "../src/core/schemas.ts";
import { runResultToRow } from "../src/stats/index.ts";
import { isAlive } from "../src/core/proc.ts";
import { cleanup, makeFixture, tmp } from "./helpers.ts";

test("tests-visible con baseCommit: restaura tests originales editados/borrados por el agente", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
    // El agente deja el código roto y reescribe el test para que pase siempre.
    const testFile = join(ws.dir, "test/add.test.js");
    writeFileSync(testFile, "import test from 'node:test';\ntest('add', () => {});\n");
    const ev = testsVisible({ timeoutMs: 30_000 });
    assert.equal((await ev.evaluate({ workspaceDir: ws.dir })).pass, true, "sin baseCommit el test tramposo engaña");
    const r = await ev.evaluate({ workspaceDir: ws.dir, baseCommit: ws.baseCommit });
    assert.equal(r.pass, false);
    assert.deepEqual((r.details as { tamperedTests: string[] }).tamperedTests, ["test/add.test.js"]);
    // El workspace del agente no se toca.
    assert.match(readFileSync(testFile, "utf8"), /test\('add', \(\) => \{\}\)/);
    // Borrado del test: también se restaura.
    rmSync(testFile);
    assert.equal((await ev.evaluate({ workspaceDir: ws.dir, baseCommit: ws.baseCommit })).pass, false);
    assert.equal(existsSync(testFile), false);
    // Con la corrección legítima del código pasa.
    writeFileSync(join(ws.dir, "src/add.js"), "export function add(a, b) { return a + b; }\n");
    const ok = await ev.evaluate({ workspaceDir: ws.dir, baseCommit: ws.baseCommit });
    assert.equal(ok.pass, true);
    assert.equal(ok.score, 1);
  } finally { cleanup(root); }
});

test("adaptador de evaluadores al esquema zod de core", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
    const r = await testsVisible({ timeoutMs: 30_000 }).evaluate({ workspaceDir: ws.dir });
    const c = toCoreEvaluatorResult(r);
    assert.doesNotThrow(() => EvaluatorResultSchema.parse(c));
    assert.equal(c.kind, "tests-visible");
    assert.equal(c.passed, false);
    assert.equal(c.testsTotal, 1);
    assert.equal(c.testsPassed, 0);
    const na = toCoreEvaluatorResult(notApplicable("build", "x"));
    assert.deepEqual([na.passed, na.score, na.durationMs], [null, null, null]);
    const ie = toCoreEvaluatorResult(infraError("tests-hidden", "boom", 12.6));
    assert.deepEqual([ie.passed, ie.durationMs], [null, 13]);
    assert.match(ie.details, /boom/);
    assert.throws(() => toCoreEvaluatorResult(notApplicable("inventado", "x")));
  } finally { cleanup(root); }
});

test("stats: RunResult -> RunRow (null si no hay tokens)", () => {
  const base = RunResultSchema.parse({
    schemaVersion: "1", runId: "r1", experimentId: null, scenarioId: "caso-1", configurationId: "cfg-a", runner: "fake",
    provider: null, model: null, cliVersion: null, features: { skills: [], subagents: [] }, repetition: 2, seed: null,
    startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", outcome: "completed", success: true,
    telemetry: emptyTelemetry(), durationMs: 1000, evaluators: [], score: { correctness: null, quality: null, efficiency: null },
    orphans: 0, gitDiff: null, error: null,
    environment: { schemaVersion: "1", os: "darwin", arch: "arm64", nodeVersion: "22", gitVersion: null, cliVersion: null, ncpu: 8, totalMemBytes: 1000000, benchVersion: "0.1.0", isolation: "none" },
  });
  const row = runResultToRow(base);
  assert.deepEqual(row, { caseId: "caso-1", configId: "cfg-a", success: true, tokens: null, durationMs: 1000, outcome: "completed", rep: 2 });
  assert.equal(runResultToRow({ ...base, telemetry: { ...base.telemetry, inputTokens: 10, outputTokens: 5 } }).tokens, 15);
  assert.equal(runResultToRow({ ...base, telemetry: { ...base.telemetry, totalTokens: 99, inputTokens: 10, outputTokens: 5 } }).tokens, 99);
});

test("TreeDeadSignal: killTreeAndSignal mata nieto con setsid y emite la señal solo sin huérfanos", async () => {
  const sig = new TreeDeadSignal();
  const child = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    const g = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
    console.log(g.pid);
    setInterval(()=>{},1000);
  `], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const grandchild = await new Promise<number>((res) => child.stdout!.once("data", (d: Buffer) => res(Number(d.toString().trim()))));
  assert.ok(isAlive(grandchild));
  // Antes de matar, signalIfNoOrphans no debe emitir.
  assert.equal(signalIfNoOrphans(new TreeDeadSignal(), [child.pid!, grandchild]).dead, false);
  const r = await killTreeAndSignal(child.pid!, sig, { graceMs: 500 });
  assert.equal(r.dead, true);
  assert.deepEqual(r.orphans, []);
  assert.equal(sig.dead, true);
  assert.equal(isAlive(grandchild), false);
  assert.equal(signalIfNoOrphans(new TreeDeadSignal(), [child.pid!, grandchild]).dead, true);
});
