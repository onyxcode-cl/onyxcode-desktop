import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConfigurationSchema, ExperimentSchema, OutcomeSchema, RunResultSchema, ScenarioSchema,
  TelemetrySchema, NO_CAPABILITIES, emptyTelemetry, maskTelemetry,
} from "./schemas.ts";

const scenario = {
  schemaVersion: "1", id: "node-l1-001", description: "d", category: "node", difficulty: "L1",
  fixture: { path: "benchmarks/node/x" }, task: "arregla", evaluators: [{ kind: "tests-visible", command: ["node", "--test"] }],
};
test("Scenario aplica defaults y exige schemaVersion", () => {
  const s = ScenarioSchema.parse(scenario);
  assert.equal(s.constraints.maxChangedFiles, null);
  assert.equal(s.evaluators[0]?.timeoutSec, 120);
  assert.throws(() => ScenarioSchema.parse({ ...scenario, schemaVersion: "2" }));
  assert.throws(() => ScenarioSchema.parse({ ...scenario, evaluators: [] }));
});
test("Outcome tiene exactamente 7 valores", () => {
  assert.deepEqual([...OutcomeSchema.options].sort(), ["agent_error", "cancelled", "completed", "hung", "infra_error", "rate_limited", "timeout"]);
});
test("Experiment exige presupuesto maxCost y limita concurrencia a 2", () => {
  const base = { schemaVersion: "1", id: "e1", scenarios: ["a"], configurations: ["c"], budget: { maxCost: 1 } };
  const e = ExperimentSchema.parse(base);
  assert.equal(e.concurrency, 1);
  assert.equal(e.limits.timeoutSec, 1200);
  assert.throws(() => ExperimentSchema.parse({ ...base, budget: {} }));
  assert.throws(() => ExperimentSchema.parse({ ...base, concurrency: 3 }));
});
test("Telemetry no acepta undefined y permite null; mask respeta capabilities", () => {
  const t = emptyTelemetry();
  assert.equal(t.inputTokens, null);
  assert.throws(() => TelemetrySchema.parse({ ...t, inputTokens: undefined }));
  const full = { ...t, inputTokens: 10, outputTokens: 5, totalTokens: 15, toolCalls: 3 };
  const m = maskTelemetry(full, { ...NO_CAPABILITIES, tokens: true });
  assert.equal(m.inputTokens, 10);
  assert.equal(m.toolCalls, null);
});
test("Configuration y RunResult validan", () => {
  const c = ConfigurationSchema.parse({ schemaVersion: "1", id: "c1", name: "c", runner: "fake" });
  assert.deepEqual(c.skills, []);
  const env = { schemaVersion: "1", os: "darwin", arch: "arm64", nodeVersion: "22", gitVersion: null, cliVersion: null, ncpu: 8, totalMemBytes: 1e10, benchVersion: "0.1.0" };
  const r = {
    schemaVersion: "1", runId: "r", experimentId: null, scenarioId: "s", configurationId: "c", runner: "fake",
    provider: null, model: null, cliVersion: null, features: { skills: [], subagents: [] }, repetition: 0, seed: null,
    startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", outcome: "completed", success: true,
    telemetry: emptyTelemetry(), durationMs: 1000, evaluators: [], score: { correctness: null, quality: null, efficiency: null },
    orphans: 0, gitDiff: null, environment: env,
  };
  assert.equal(RunResultSchema.parse(r).error, null);
  assert.throws(() => RunResultSchema.parse({ ...r, outcome: "weird" }));
});
