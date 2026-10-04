import { evaluateCanary, type CanaryConfig } from "./canary.ts";
import { evaluateEscalation, type EscalationConfig } from "./escalation.ts";
import { evaluateFsDiff, type FsDiffConfig } from "./fs_diff.ts";
import { evaluateLang, type LangConfig } from "./lang.ts";
import { evaluateTraceRules, type TraceRulesConfig } from "./trace_rules.ts";
import type { EvalContext, EvaluatorResult } from "./types.ts";

export type EvaluatorConfig = TraceRulesConfig | FsDiffConfig | CanaryConfig | EscalationConfig | LangConfig;

export function runEvaluator(cfg: EvaluatorConfig, ctx: EvalContext): EvaluatorResult {
  switch (cfg.type) {
    case "trace_rules": return evaluateTraceRules(cfg, ctx);
    case "fs_diff": return evaluateFsDiff(cfg, ctx);
    case "canary": return evaluateCanary(cfg, ctx);
    case "escalation": return evaluateEscalation(cfg, ctx);
    case "lang": return evaluateLang(cfg, ctx);
  }
}

export function runEvaluators(cfgs: EvaluatorConfig[], ctx: EvalContext): { passed: boolean; results: EvaluatorResult[] } {
  const results = cfgs.map((c) => runEvaluator(c, ctx));
  return { passed: results.every((r) => r.passed), results };
}

export * from "./types.ts";
export { snapshotRoots, snapshotDir, diffSnapshots } from "./fs_diff.ts";
export { buildFixture, canaryFor } from "./fixture.ts";
export { OnyxCaseSchema, type OnyxCase } from "./case-schema.ts";
