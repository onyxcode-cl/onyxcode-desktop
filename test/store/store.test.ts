import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { emptyTelemetry, ExperimentSchema, RunResultSchema } from "../../src/core/schemas.ts";
import type { RunResult } from "../../src/core/schemas.ts";
import { ImmutableRecordError, openStore, readJsonl, writeImmutable } from "../../src/store/index.ts";
import { rmDir, tmpDir } from "../engine/helpers.ts";

const dirs: string[] = [];
const mk = (): string => { const d = tmpDir("ab-store-"); dirs.push(d); return d; };
after(() => rmDir(...dirs));

export function sampleRun(over: Partial<RunResult> = {}): RunResult {
  return RunResultSchema.parse({
    schemaVersion: "1", runId: "run-" + Math.random().toString(36).slice(2, 10), experimentId: "exp-a", scenarioId: "sc-1", configurationId: "cfg-1",
    runner: "fake", provider: null, model: "m", cliVersion: null, features: { skills: [], subagents: [] }, repetition: 0, seed: 1,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), outcome: "completed", success: true,
    telemetry: { ...emptyTelemetry(), totalTokens: 123 }, durationMs: 50, evaluators: [], score: { correctness: 1, quality: null, efficiency: null },
    orphans: 0, gitDiff: null, error: null,
    environment: { schemaVersion: "1", os: "darwin", arch: "arm64", nodeVersion: "22", gitVersion: null, cliVersion: null, ncpu: 8, totalMemBytes: 1e10, benchVersion: "0.1.0", isolation: "none" },
    ...over,
  });
}
const exp = ExperimentSchema.parse({ schemaVersion: "1", id: "exp-a", scenarios: ["sc-1"], configurations: ["cfg-1"], budget: { maxCost: 1 } });

describe("store", () => {
  test("escribe, lee, consulta; JSONL inmutable", () => {
    const s = openStore(join(mk(), "res"));
    s.writeExperiment(exp);
    s.writeExperiment(exp); // idempotente
    assert.throws(() => s.writeExperiment({ ...exp, seed: 99 }), ImmutableRecordError);
    const r = sampleRun();
    s.writeRun(r);
    assert.throws(() => s.writeRun({ ...r, success: false }), ImmutableRecordError, "no se reescribe un run");
    assert.deepEqual(s.readRun("exp-a", r.runId), r);
    assert.equal(s.queryRuns({ experimentId: "exp-a" }).length, 1);
    assert.equal(s.queryRuns({ success: false }).length, 0);
    assert.equal(s.sql<{ n: number }>("SELECT count(*) AS n FROM runs")[0]!.n, 1);
    assert.throws(() => s.sql("DELETE FROM runs"));
    assert.deepEqual(readdirSync(join(s.expDir("exp-a"), "runs")), [`${r.runId}.jsonl`], "sin temporales residuales");
    s.close();
  });

  test("redacta secretos antes de escribir", () => {
    const s = openStore(join(mk(), "res"));
    const r = sampleRun({ error: "falló con api_key=sk-abcdefghijklmnopqrstuvwx1234567890" });
    s.writeRun(r);
    const raw = readFileSync(s.runPath("exp-a", r.runId), "utf8");
    assert.ok(!raw.includes("sk-abcdefghijklmnop"));
    s.close();
  });

  test("rebuildIndex reconstruye desde cero (índice borrado) y reporta corruptos", () => {
    const root = join(mk(), "res");
    const s = openStore(root);
    s.writeExperiment(exp);
    const rs = [sampleRun(), sampleRun({ outcome: "timeout", success: false }), sampleRun({ experimentId: null })];
    for (const r of rs) s.writeRun(r);
    s.close();
    rmSync(join(root, "index.sqlite"));
    // un run corrupto no debe tumbar la reconstrucción
    writeFileSync(join(s.expDir("exp-a"), "runs", "roto.jsonl"), "{no es json\n");
    const s2 = openStore(root);
    const rep = s2.rebuildIndex();
    assert.equal(rep.runs, 3);
    assert.equal(rep.experiments, 1);
    assert.equal(rep.skipped.length, 1);
    assert.equal(s2.queryRuns().length, 3);
    assert.equal(s2.queryRuns({ outcome: "timeout" }).length, 1);
    s2.close();
  });

  test("índice ausente con datos existentes se deriva solo; los JSONL no cambian al reconstruir", () => {
    const root = join(mk(), "res");
    const s = openStore(root);
    const r = sampleRun();
    s.writeRun(r);
    s.close();
    const before = readFileSync(s.runPath("exp-a", r.runId), "utf8");
    rmSync(join(root, "index.sqlite"));
    const s2 = openStore(root);
    assert.equal(s2.queryRuns().length, 1);
    s2.rebuildIndex();
    assert.equal(readFileSync(s2.runPath("exp-a", r.runId), "utf8"), before);
    assert.ok(!readdirSync(root).some((f) => f.includes("rebuild")));
    s2.close();
  });

  test("diario append-only y rutas seguras", () => {
    const s = openStore(join(mk(), "res"));
    s.appendJournal("exp-a", { event: "a" });
    s.appendJournal("exp-a", { event: "b" });
    assert.deepEqual(s.readJournal("exp-a").map((x) => x.event), ["a", "b"]);
    assert.throws(() => s.runPath("exp-a", "../../etc/passwd"));
    assert.throws(() => s.expDir("../x"));
    s.close();
  });

  test("writeImmutable es atómico: sin parciales y sin sobrescritura", () => {
    const d = mk();
    const p = join(d, "x.jsonl");
    writeImmutable(p, '{"a":1}\n');
    assert.throws(() => writeImmutable(p, '{"a":2}\n'), ImmutableRecordError);
    assert.equal(readFileSync(p, "utf8"), '{"a":1}\n');
    assert.deepEqual(readdirSync(d), ["x.jsonl"]);
    appendFileSync(p, "basura sin cerrar");
    assert.equal(readJsonl(p).badLines.length, 1);
    assert.ok(existsSync(p));
  });
});
