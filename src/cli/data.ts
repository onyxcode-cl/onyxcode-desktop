// Carga de experimentos, configuraciones y casos desde el árbol del proyecto.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { ConfigurationSchema, ExperimentSchema, type Configuration, type Experiment } from "../core/schemas.ts";

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

export interface ScenarioInfo {
  id: string;
  category: string | null;
  difficulty: string | null;
  suite: string;
  dir: string;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new DataError(`no se pudo leer ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const dirs = (p: string): string[] =>
  existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];

export function listScenarios(root: string): ScenarioInfo[] {
  const out: ScenarioInfo[] = [];
  const base = join(root, "benchmarks");
  for (const suite of dirs(base)) {
    // Casos node: benchmarks/<suite>/<id>/case.json; onyx: benchmarks/<suite>/cases/<id>/case.json
    const candidates = [join(base, suite), join(base, suite, "cases")];
    for (const c of candidates) {
      for (const d of dirs(c)) {
        const f = join(c, d, "case.json");
        if (!existsSync(f)) continue;
        const j = readJson(f) as Record<string, unknown>;
        out.push({
          id: typeof j["id"] === "string" ? j["id"] : d,
          category: typeof j["category"] === "string" ? j["category"] : null,
          difficulty: typeof j["difficulty"] === "string" ? j["difficulty"] : null,
          suite,
          dir: join(c, d),
        });
      }
    }
  }
  return out;
}

export function listConfigurations(root: string): Configuration[] {
  const out: Configuration[] = [];
  const base = join(root, "configurations");
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) {
        const r = ConfigurationSchema.safeParse(readJson(p));
        if (!r.success) throw new DataError(`configuración inválida ${p}: ${r.error.issues[0]?.message ?? "?"}`);
        out.push(r.data);
      }
    }
  };
  walk(base);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function listExperimentFiles(root: string): string[] {
  const d = join(root, "experiments");
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => join(d, f)) : [];
}

/** `ref` = ruta a un .json o id de experiments/<id>.json. `maxCost` completa budget.maxCost si falta. */
export function loadExperiment(root: string, ref: string, over: { maxCost?: number | undefined; seed?: number | undefined; timeoutSec?: number | undefined; maxRuns?: number | undefined; maxWallSec?: number | undefined; concurrency?: number | undefined }): Experiment {
  const candidates = ref.endsWith(".json") ? [isAbsolute(ref) ? ref : resolve(ref)] : [join(root, "experiments", `${ref}.json`)];
  const file = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  if (!file) throw new DataError(`no se encontró el experimento "${ref}" (probé ${candidates.join(", ")})`);
  const raw = readJson(file) as Record<string, unknown>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new DataError(`${file} no es un objeto JSON`);
  const budget: Record<string, unknown> = { ...((raw["budget"] as Record<string, unknown> | undefined) ?? {}) };
  if (over.maxCost !== undefined) budget["maxCost"] = over.maxCost;
  if (over.maxRuns !== undefined) budget["maxRuns"] = over.maxRuns;
  if (over.maxWallSec !== undefined) budget["maxWallSec"] = over.maxWallSec;
  if (budget["maxCost"] === undefined) budget["maxCost"] = 0;
  const limits: Record<string, unknown> = { ...((raw["limits"] as Record<string, unknown> | undefined) ?? {}) };
  if (over.timeoutSec !== undefined) limits["timeoutSec"] = Math.ceil(over.timeoutSec);
  const merged: Record<string, unknown> = { schemaVersion: "1", ...raw, budget, limits };
  if (over.seed !== undefined) merged["seed"] = over.seed;
  if (over.concurrency !== undefined) merged["concurrency"] = over.concurrency;
  const r = ExperimentSchema.safeParse(merged);
  if (!r.success) {
    throw new DataError(`experimento inválido (${file}): ${r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`);
  }
  return r.data;
}
