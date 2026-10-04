// Capa de enlace entre el CLI y los módulos que escriben otros agentes (motor e informes).
// El CLI solo depende de estas interfaces; el cableado real se resuelve en tiempo de ejecución
// con import dinámico, así el CLI funciona (doctor, power, list, clean...) aunque falte un módulo.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Configuration, Experiment, RunResult } from "../core/schemas.ts";

// ---------- Motor ----------

export interface PlannedRun {
  scenarioId: string;
  configurationId: string;
  repetition: number;
  /** Posición en el orden de ejecución (0..n-1). */
  order: number;
}

export interface PlanRequest {
  experiment: Experiment;
  configurations: Configuration[];
  /** Directorio raíz de benchmarks (benchmarks/). */
  benchmarksDir: string;
}

export interface PlanResult {
  runs: PlannedRun[];
  seed: number;
  design: string;
}

export interface RunRequest extends PlanRequest {
  /** Raíz del almacén de resultados (results/ por defecto, o --out). */
  resultsDir: string;
  maxCost: number;
  maxRuns: number | null;
  maxWallSec: number | null;
  /** Ya acotada a 1..2. */
  concurrency: number;
  /** Sobrescribe limits.timeoutSec si no es null. */
  timeoutSec: number | null;
  /** Solo true si el usuario pasó --allow-real-runner y AGENT_BENCH_CONFIRM_REAL=yes. */
  allowRealRunner: boolean;
  signal: AbortSignal;
  onProgress?: (msg: string) => void;
}

export type StopReason = "done" | "max-cost" | "max-runs" | "max-wall" | "cancelled" | "error";

export interface RunSummary {
  experimentId: string;
  runsPlanned: number;
  runsFinished: number;
  runsSucceeded: number;
  costUsd: number | null;
  stoppedBy: StopReason;
  orphans: number;
}

export interface EngineApi {
  plan(req: PlanRequest): PlanResult | Promise<PlanResult>;
  run(req: RunRequest): Promise<RunSummary>;
}

export type Loaded<T> = { ok: true; api: T } | { ok: false; reason: string };

/**
 * Espera que src/engine/index.ts exporte `planExperiment(req)` y `runExperiment(req)` con las
 * formas PlanRequest/PlanResult y RunRequest/RunSummary de arriba. Si el motor expone otra forma,
 * se adapta AQUÍ (único punto de acoplamiento).
 */
export async function loadEngine(root: string): Promise<Loaded<EngineApi>> {
  const file = join(root, "src", "engine", "index.ts");
  if (!existsSync(file)) return { ok: false, reason: "src/engine/index.ts todavía no existe" };
  try {
    const m = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    const plan = m["planExperiment"];
    const run = m["runExperiment"];
    if (typeof plan !== "function" || typeof run !== "function") {
      return { ok: false, reason: "src/engine/index.ts no exporta planExperiment/runExperiment (ajustar src/cli/wiring.ts)" };
    }
    return {
      ok: true,
      api: {
        plan: plan as EngineApi["plan"],
        run: run as EngineApi["run"],
      },
    };
  } catch (e) {
    return { ok: false, reason: `no se pudo cargar el motor: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------- Informes ----------

export interface ReportRequest {
  runs: readonly RunResult[];
  outDir: string;
  baselineId?: string;
  alpha?: number;
  seed?: number;
  title?: string;
  inputRef?: string;
}

export interface AnalysisSummary {
  runs: number;
  cases: number;
  configs: number;
  baselineId: string;
  /** Una línea por configuración. */
  rows: { configId: string; successRate: number | null; tokensMedian: number | null; durationMedianMs: number | null }[];
  warnings: string[];
}

export interface ReportApi {
  /** Analiza sin escribir a disco. */
  summarize(req: Omit<ReportRequest, "outDir">): AnalysisSummary;
  /** Escribe analysis.json, claims.json, report.html y report.md. */
  write(req: ReportRequest): { files: string[] };
}

export async function loadReport(root: string): Promise<Loaded<ReportApi>> {
  const file = join(root, "src", "report", "index.ts");
  if (!existsSync(file)) return { ok: false, reason: "src/report/index.ts todavía no existe" };
  try {
    const m = (await import(pathToFileURL(file).href)) as {
      analyze: (runs: readonly RunResult[], o?: Record<string, unknown>) => {
        data: { runs: number; cases: number; configs: number };
        options: { baselineId: string };
        configs: { configId: string; itt: { successRate?: unknown }; tokens: { median: number | null }; duration: { median: number | null } }[];
        warnings: string[];
      };
      writeReport: (runs: readonly RunResult[], outDir: string, o?: Record<string, unknown>) => { files: string[] };
    };
    const opts = (r: Omit<ReportRequest, "outDir">): Record<string, unknown> => {
      const o: Record<string, unknown> = {};
      if (r.baselineId !== undefined) o["baselineId"] = r.baselineId;
      if (r.alpha !== undefined) o["alpha"] = r.alpha;
      if (r.seed !== undefined) o["seed"] = r.seed;
      if (r.title !== undefined) o["title"] = r.title;
      if (r.inputRef !== undefined) o["inputRef"] = r.inputRef;
      return o;
    };
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      ok: true,
      api: {
        summarize(req) {
          const a = m.analyze(req.runs, opts(req));
          return {
            runs: a.data.runs,
            cases: a.data.cases,
            configs: a.data.configs,
            baselineId: a.options.baselineId,
            rows: a.configs.map((c) => ({
              configId: c.configId,
              successRate: num((c.itt as Record<string, unknown>)["rate"] ?? (c.itt as Record<string, unknown>)["successRate"] ?? (c.itt as Record<string, unknown>)["mean"]),
              tokensMedian: num(c.tokens.median),
              durationMedianMs: num(c.duration.median),
            })),
            warnings: a.warnings,
          };
        },
        write(req) {
          return m.writeReport(req.runs, req.outDir, opts(req));
        },
      },
    };
  } catch (e) {
    return { ok: false, reason: `no se pudo cargar el módulo de informes: ${e instanceof Error ? e.message : String(e)}` };
  }
}
