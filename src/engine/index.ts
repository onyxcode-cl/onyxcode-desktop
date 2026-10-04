// API estable del motor de agent-bench (la usa el CLI).
export { runExperiment, validateBudget, BudgetError } from "./engine.ts";
export type { RunExperimentOptions, ExperimentSummary, ExperimentStatus, StopReason, EngineEvent } from "./engine.ts";
export { planExperiment, expandRuns, runKey, runKeyOf, priceFor, costFromTokens } from "./planner.ts";
export type { Plan, PlannedRun, PlanEstimate, PlanOptions, PricingTable, PricePerMTok } from "./planner.ts";
export {
  loadConfiguration, loadConfigurations, loadExperiment, loadScenarios, parseConfiguration, parseExperiment, parseConfigText,
  validateConfigurationFile, checkExperimentRefs, applyOverrides, scenarioFromCase, configurationWarnings, ConfigError, formatZodIssues,
} from "./config.ts";
export type { Validation, BudgetOverrides } from "./config.ts";
export { parseYamlLite, YamlLiteError } from "./yaml-lite.ts";
export { realClock, createManualClock } from "./clock.ts";
export type { Clock, ManualClock } from "./clock.ts";
export { adaptLegacyRunner } from "./legacy.ts";
export { runEvaluators, builtinEvaluators, scoreSummary, toCoreResult } from "./evaluate.ts";
export type { EvaluatorFactory, EvalOutcome } from "./evaluate.ts";
export { executeCycle, buildEnvironment } from "./cycle.ts";
export { sweepTree, procsCiting } from "./procs.ts";
