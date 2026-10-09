// Fixture sintético determinista de RunResult (sin red, sin modelos reales).
import { SCHEMA_VERSION, RunResultSchema } from "../../../src/core/schemas.ts";
import type { RunResult } from "../../../src/core/schemas.ts";
import { seededRng } from "../../../src/core/ids.ts";

interface Prof { id: string; p: number; tok: number; dur: number; usd: number | null; catastrophe: number; infra: number; }

export const PROFILES: Prof[] = [
  { id: "base", p: 0.55, tok: 40000, dur: 90000, usd: 0.4, catastrophe: 0.01, infra: 0.02 },
  { id: "skill-a", p: 0.85, tok: 30000, dur: 70000, usd: 0.3, catastrophe: 0, infra: 0.05 },
  { id: "skill-b", p: 0.3, tok: 90000, dur: 200000, usd: 0.9, catastrophe: 0.08, infra: 0.02 },
];

export function makeRuns(seed = 7, cases = 12, reps = 5): RunResult[] {
  const rng = seededRng(seed);
  const runs: RunResult[] = [];
  const caseSkill = Array.from({ length: cases }, () => (rng() - 0.5) * 0.5); // heterogeneidad entre casos
  for (let c = 0; c < cases; c++) {
    for (const pr of PROFILES) {
      for (let r = 0; r < reps; r++) {
        const u = rng();
        let outcome: RunResult["outcome"] = "completed";
        if (u < pr.infra) outcome = rng() < 0.5 ? "infra_error" : "rate_limited";
        else if (u < pr.infra + 0.01) outcome = "hung";
        const ok = outcome === "completed" && rng() < Math.min(0.98, Math.max(0.02, pr.p + caseSkill[c]!));
        const cat = rng() < pr.catastrophe;
        const tokens = outcome === "completed" ? Math.round(pr.tok * (0.5 + rng())) : null;
        const noTok = c === 0 && pr.id === "base" && r === 0; // un null declarado
        const dur = Math.round(pr.dur * (0.5 + rng() * 1.2));
        const t0 = Date.UTC(2026, 0, 1) + (c * 100 + r) * 60000;
        runs.push(RunResultSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          runId: `00000000-0000-4000-8000-${String(runs.length).padStart(12, "0")}`,
          experimentId: "exp-synth",
          scenarioId: `case-${String(c).padStart(2, "0")}`,
          configurationId: pr.id,
          runner: "fake", provider: null, model: null, cliVersion: null,
          features: { skills: [], subagents: [] },
          repetition: r, seed,
          startedAt: new Date(t0).toISOString(), finishedAt: new Date(t0 + dur).toISOString(),
          outcome,
          success: outcome === "completed" ? ok : null,
          telemetry: {
            schemaVersion: SCHEMA_VERSION,
            inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null,
            totalTokens: noTok ? null : tokens, llmCalls: null, peakContext: null,
            costUsd: pr.usd === null || tokens === null ? null : +(pr.usd * (tokens / pr.tok)).toFixed(4),
            toolCalls: null, commands: null, steps: null,
            filesRead: null, filesModified: null, filesCreated: null, filesDeleted: null, extra: {},
          },
          durationMs: dur,
          evaluators: [
            { schemaVersion: SCHEMA_VERSION, kind: "tests-hidden", passed: outcome === "completed" ? ok : null, score: ok ? 1 : 0, testsPassed: null, testsTotal: null, violations: [], details: "", durationMs: null },
            ...(cat ? [{ schemaVersion: SCHEMA_VERSION, kind: "anti-cheat" as const, passed: false, score: 0, testsPassed: null, testsTotal: null, violations: ["edita tests"], details: "", durationMs: null }] : []),
          ],
          score: { correctness: null, quality: null, efficiency: null },
          orphans: 0, gitDiff: null, error: null,
          environment: { schemaVersion: SCHEMA_VERSION, os: "darwin", arch: "arm64", nodeVersion: "22.23.3", gitVersion: null, cliVersion: null, ncpu: 8, totalMemBytes: 17179869184, benchVersion: "0.1.0", isolation: "none" },
        }));
      }
    }
  }
  return runs;
}
