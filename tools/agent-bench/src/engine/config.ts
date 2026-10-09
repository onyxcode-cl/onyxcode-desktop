import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { ConfigurationSchema, ExperimentSchema, ScenarioSchema } from "../core/schemas.ts";
import type { Configuration, EvaluatorKind, Experiment, Scenario } from "../core/schemas.ts";
import { parseYamlLite, YamlLiteError } from "./yaml-lite.ts";

export class ConfigError extends Error {
  readonly issues: string[];
  readonly file: string | null;
  constructor(message: string, issues: string[] = [], file: string | null = null) {
    super(issues.length ? `${message}\n  - ${issues.join("\n  - ")}` : message);
    this.name = "ConfigError";
    this.issues = issues;
    this.file = file;
  }
}

export function formatZodIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.length ? i.path.join(".") : "(raíz)"}: ${i.message}`);
}

/** Parsea JSON (si empieza por { o [) o YAML-lite. */
export function parseConfigText(text: string, file: string | null = null): unknown {
  const t = text.trim();
  try {
    if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
    return parseYamlLite(text);
  } catch (e) {
    const msg = e instanceof YamlLiteError || e instanceof SyntaxError ? e.message : String(e);
    throw new ConfigError(`no se pudo leer ${file ?? "la configuración"}`, [msg], file);
  }
}

function readText(file: string): string {
  try { return readFileSync(file, "utf8"); }
  catch (e) { throw new ConfigError(`no se puede leer ${file}`, [(e as Error).message], file); }
}

function withSchemaVersion(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && !("schemaVersion" in raw)) return { schemaVersion: "1", ...(raw as object) };
  return raw;
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, what: string, file: string | null): T {
  const r = schema.safeParse(withSchemaVersion(raw));
  if (!r.success) throw new ConfigError(`${what} inválido${file ? ` (${file})` : ""}`, formatZodIssues(r.error), file);
  return r.data;
}

export interface Validation<T> { ok: boolean; value: T | null; errors: string[]; warnings: string[] }

function validation<T>(fn: () => { value: T; warnings: string[] }): Validation<T> {
  try {
    const { value, warnings } = fn();
    return { ok: true, value, errors: [], warnings };
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, value: null, errors: e.issues.length ? e.issues : [e.message], warnings: [] };
    throw e;
  }
}

// ---------- Configuration ----------

export function parseConfiguration(raw: unknown, file: string | null = null): Configuration {
  return parseWith(ConfigurationSchema, raw, "Configuration", file);
}

/** Avisos (no errores): rutas de skills/prompts/subagentes que no existen (relativas al archivo). */
export function configurationWarnings(cfg: Configuration, baseDir: string | null): string[] {
  const w: string[] = [];
  if (!baseDir) return w;
  for (const [kind, list] of [["skills", cfg.skills], ["subagents", cfg.subagents], ["prompts", cfg.prompts]] as const) {
    for (const f of list) {
      if (f.path === null) continue;
      const p = isAbsolute(f.path) ? f.path : resolve(baseDir, f.path);
      if (!existsSync(p)) w.push(`${kind}.${f.name}@${f.version}: la ruta no existe (${p})`);
    }
  }
  return w;
}

export function loadConfiguration(file: string): Configuration {
  return parseConfiguration(parseConfigText(readText(file), file), file);
}

export function validateConfigurationFile(file: string): Validation<Configuration> {
  return validation(() => {
    const value = loadConfiguration(file);
    return { value, warnings: configurationWarnings(value, dirname(resolve(file))) };
  });
}

/** Carga todas las configuraciones (.json/.yaml/.yml) de un directorio (recursivo). Ids duplicados = error. */
export function loadConfigurations(dir: string): Configuration[] {
  const out: Configuration[] = [];
  const seen = new Map<string, string>();
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(json|ya?ml)$/.test(e.name)) {
        const c = loadConfiguration(p);
        const prev = seen.get(c.id);
        if (prev) throw new ConfigError(`id de configuración duplicado: ${c.id}`, [prev, p]);
        seen.set(c.id, p);
        out.push(c);
      }
    }
  };
  walk(dir);
  return out;
}

// ---------- Experiment ----------

export function parseExperiment(raw: unknown, file: string | null = null): Experiment {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (r && (!r.budget || typeof r.budget !== "object" || (r.budget as Record<string, unknown>).maxCost === undefined || (r.budget as Record<string, unknown>).maxCost === null)) {
    throw new ConfigError(`Experiment inválido${file ? ` (${file})` : ""}`, ["budget.maxCost: obligatorio (tope de coste en USD; 0 = solo runs sin coste)"], file);
  }
  return parseWith(ExperimentSchema, raw, "Experiment", file);
}

export function loadExperiment(file: string): Experiment {
  return parseExperiment(parseConfigText(readText(file), file), file);
}

/** Referencias cruzadas: escenarios/configuraciones existentes y runners disponibles. Devuelve errores. */
export function checkExperimentRefs(
  exp: Experiment,
  scenarios: readonly Scenario[],
  configurations: readonly Configuration[],
  runnerIds: readonly string[] | null = null,
): string[] {
  const errs: string[] = [];
  const sc = new Set(scenarios.map((s) => s.id));
  const cf = new Map(configurations.map((c) => [c.id, c]));
  for (const id of exp.scenarios) if (!sc.has(id)) errs.push(`escenario desconocido: ${id}`);
  for (const id of exp.configurations) {
    const c = cf.get(id);
    if (!c) errs.push(`configuración desconocida: ${id}`);
    else if (runnerIds && !runnerIds.includes(c.runner)) errs.push(`configuración ${id}: runner no disponible (${c.runner})`);
  }
  if (new Set(exp.scenarios).size !== exp.scenarios.length) errs.push("escenarios duplicados en el experimento");
  if (new Set(exp.configurations).size !== exp.configurations.length) errs.push("configuraciones duplicadas en el experimento");
  return errs;
}

export interface BudgetOverrides {
  maxCost?: number;
  maxRuns?: number | null;
  maxWallSec?: number | null;
  concurrency?: number;
  timeoutSec?: number;
  repetitions?: number;
}

/** Aplica flags del CLI (--max-cost, --max-runs, --max-wall, --max-concurrency, --timeout) y revalida. */
export function applyOverrides(exp: Experiment, o: BudgetOverrides): Experiment {
  return ExperimentSchema.parse({
    ...exp,
    ...(o.repetitions !== undefined ? { repetitions: o.repetitions } : {}),
    ...(o.concurrency !== undefined ? { concurrency: o.concurrency } : {}),
    limits: { ...exp.limits, ...(o.timeoutSec !== undefined ? { timeoutSec: o.timeoutSec } : {}) },
    budget: {
      maxCost: o.maxCost ?? exp.budget.maxCost,
      maxRuns: o.maxRuns !== undefined ? o.maxRuns : exp.budget.maxRuns,
      maxWallSec: o.maxWallSec !== undefined ? o.maxWallSec : exp.budget.maxWallSec,
    },
  });
}

// ---------- Scenario (case.json de benchmarks/*) ----------

const CASE_KIND: Record<string, EvaluatorKind> = {
  "tests-visible": "tests-visible", "tests-hidden": "tests-hidden", build: "build", typecheck: "typecheck",
  git_diff: "git_diff", restrictions: "restrictions", "anti-cheat": "anti-cheat",
  trace_rules: "trace_rules", fs_diff: "fs_diff", canary: "canary", escalation: "escalation", lang: "lang", plan_order: "plan_order",
};

/** Convierte el case.json de benchmarks/node (o un Scenario nativo) en Scenario. Rutas relativas a benchRoot. */
export function scenarioFromCase(raw: unknown, caseDir: string, benchRoot: string, file: string | null = null): Scenario {
  const r = raw as Record<string, unknown> | null;
  if (r && typeof r === "object" && "fixture" in r) return parseWith(ScenarioSchema, raw, "Scenario", file);
  if (!r || typeof r !== "object" || typeof r.id !== "string") throw new ConfigError(`case inválido${file ? ` (${file})` : ""}`, ["falta id"], file);
  const rel = (p: unknown): string | null => (typeof p === "string" ? relative(benchRoot, join(caseDir, p)) : null);
  const files = (r.files ?? {}) as { allowed?: string[]; forbidden?: string[] };
  const evaluators = ((r.evaluators ?? []) as Array<Record<string, unknown>>).map((e) => {
    const { type, kind, command, timeoutSec, weight, ...params } = e;
    const k = CASE_KIND[String(kind ?? type)];
    if (!k) throw new ConfigError(`evaluador desconocido: ${String(kind ?? type)}`, [], file);
    return { kind: k, ...(Array.isArray(command) ? { command } : {}), ...(typeof timeoutSec === "number" ? { timeoutSec } : {}), ...(typeof weight === "number" ? { weight } : {}), params };
  });
  const scenario = {
    schemaVersion: "1",
    id: r.id,
    description: String(r.title ?? r.description ?? r.id),
    category: String(r.language ? "node" : r.category ?? "node"),
    difficulty: r.difficulty,
    fixture: { path: rel(r.repo ?? "repo"), commit: null },
    task: r.task,
    constraints: { allowedPaths: files.allowed ?? [], forbiddenPaths: files.forbidden ?? [], maxChangedFiles: null },
    evaluators,
    hiddenTests: rel(r.hiddenDir),
    referencePatch: rel(r.referencePatch),
    cheatPatch: rel(r.cheatPatch),
    metadata: {
      hiddenInject: r.hiddenInject ?? null, language: r.language ?? null, relevantFiles: r.relevantFiles ?? [],
      seed: r.seed ?? null, suiteCategory: r.category ?? null, notes: r.constraints ?? [],
    },
  };
  return parseWith(ScenarioSchema, scenario, "Scenario", file);
}

function relative(from: string, to: string): string {
  const a = resolve(from).split("/").filter(Boolean);
  const b = resolve(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || ".";
}

/** Busca benchRoot/benchmarks/<suite>/<id>/case.json para cada id. */
export function loadScenarios(benchRoot: string, ids?: readonly string[]): Scenario[] {
  const base = join(benchRoot, "benchmarks");
  const found = new Map<string, Scenario>();
  if (existsSync(base)) {
    for (const suite of readdirSync(base, { withFileTypes: true })) {
      if (!suite.isDirectory()) continue;
      for (const d of readdirSync(join(base, suite.name), { withFileTypes: true })) {
        const dir = join(base, suite.name, d.name);
        const f = join(dir, "case.json");
        if (!d.isDirectory() || !existsSync(f) || !statSync(f).isFile()) continue;
        if (ids && !ids.includes(d.name)) continue;
        const raw = parseConfigText(readText(f), f);
        const sc = scenarioFromCase(raw, dir, benchRoot, f);
        found.set(sc.id, sc);
      }
    }
  }
  if (ids) {
    const missing = ids.filter((i) => !found.has(i));
    if (missing.length) throw new ConfigError("escenarios no encontrados", missing.map((m) => `${m} (en ${base})`));
    return ids.map((i) => found.get(i)!);
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

