import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../core/ids.ts";
import { redactDeep } from "../core/redact.ts";
import { ExperimentSchema, RunResultSchema } from "../core/schemas.ts";
import type { Experiment, RunResult } from "../core/schemas.ts";
import { appendLine, ImmutableRecordError, jsonLine, readJsonl, writeImmutable } from "./jsonl.ts";

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const ADHOC_EXPERIMENT = "adhoc";

function safe(part: string, what: string): string {
  if (!SAFE.test(part) || part.includes("..")) throw new Error(`${what} inválido para ruta: ${part}`);
  return part;
}

export interface RunFilter {
  experimentId?: string;
  scenarioId?: string;
  configurationId?: string;
  outcome?: string;
  success?: boolean;
}

export interface RebuildReport {
  experiments: number;
  runs: number;
  /** archivos o líneas ignorados (corruptos o inválidos) */
  skipped: string[];
}

/** Parámetros de ejecución: pueden cambiar al reanudar (el manifiesto guardado conserva los originales). */
const EXECUTION_PARAMS: Array<keyof Experiment> = ["budget", "concurrency", "limits", "seed"];

const DDL = `
CREATE TABLE experiments (id TEXT PRIMARY KEY, created_at TEXT, path TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY, experiment_id TEXT, scenario_id TEXT NOT NULL, configuration_id TEXT NOT NULL,
  runner TEXT NOT NULL, model TEXT, repetition INTEGER NOT NULL, seed INTEGER,
  started_at TEXT NOT NULL, finished_at TEXT NOT NULL, outcome TEXT NOT NULL, success INTEGER,
  duration_ms INTEGER NOT NULL, total_tokens INTEGER, cost_usd REAL, orphans INTEGER, error TEXT,
  path TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX runs_exp ON runs(experiment_id);
CREATE INDEX runs_sc_cfg ON runs(scenario_id, configuration_id);
`;

function insertRun(db: DatabaseSync, r: RunResult, path: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    r.runId, r.experimentId, r.scenarioId, r.configurationId, r.runner, r.model, r.repetition, r.seed,
    r.startedAt, r.finishedAt, r.outcome, r.success === null ? null : r.success ? 1 : 0,
    r.durationMs, r.telemetry.totalTokens, r.telemetry.costUsd, r.orphans, r.error, path, JSON.stringify(r),
  );
}

function insertExperiment(db: DatabaseSync, e: Experiment, path: string, createdAt: string | null): void {
  db.prepare(`INSERT OR IGNORE INTO experiments VALUES (?,?,?,?)`).run(e.id, createdAt, path, JSON.stringify(e));
}

/**
 * Almacén de resultados. Fuente de verdad: JSONL inmutable
 *   <root>/<expId>/experiment.jsonl, <root>/<expId>/runs/<runId>.jsonl, <root>/<expId>/journal.jsonl (append-only)
 * El índice <root>/index.sqlite es DERIVADO: se puede borrar y reconstruir con rebuildIndex().
 * Los registros nunca se editan: reescribir uno existente lanza ImmutableRecordError.
 */
export class Store {
  readonly root: string;
  #db: DatabaseSync | null = null;
  /** secretos exactos (credenciales del run y sus campos) que se redactan en todo lo que se persiste */
  #secrets: string[] = [];

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  /** Registra secretos para redactarlos en runs y diario (A1). Los valores cortos (<6) se ignoran. */
  addSecrets(secrets: readonly string[]): void {
    for (const s of secrets) if (s.length >= 6 && !this.#secrets.includes(s)) this.#secrets.push(s);
  }

  get indexPath(): string { return join(this.root, "index.sqlite"); }
  expDir(experimentId: string | null): string { return join(this.root, safe(experimentId ?? ADHOC_EXPERIMENT, "experimentId")); }
  runPath(experimentId: string | null, runId: string): string { return join(this.expDir(experimentId), "runs", `${safe(runId, "runId")}.jsonl`); }
  journalPath(experimentId: string | null): string { return join(this.expDir(experimentId), "journal.jsonl"); }

  #index(): DatabaseSync {
    if (this.#db) return this.#db;
    if (!existsSync(this.indexPath)) {
      if (this.#listExpIds().length) this.rebuildIndex(); // hay datos sin índice: derivarlo
      else {
        const fresh = new DatabaseSync(this.indexPath);
        fresh.exec(DDL);
        this.#db = fresh;
        return fresh;
      }
    }
    const db = new DatabaseSync(this.indexPath);
    db.exec("PRAGMA busy_timeout=5000;");
    this.#db = db;
    return db;
  }

  #listExpIds(): string[] {
    return readdirSync(this.root, { withFileTypes: true }).filter((d) => d.isDirectory() && SAFE.test(d.name)).map((d) => d.name);
  }

  /**
   * Guarda el manifiesto del experimento. Idempotente si el contenido es idéntico. Se separa lo INMUTABLE (qué se
   * mide: casos, configuraciones, repeticiones, diseño, alpha) de los PARÁMETROS DE EJECUCIÓN (tope de coste/runs/tiempo,
   * concurrencia, límites por run, semilla): reanudar con otros parámetros no falla; el cambio se anota en el diario.
   * Si cambia lo inmutable, lanza ImmutableRecordError indicando los campos.
   */
  writeExperiment(exp: Experiment): void {
    const e = ExperimentSchema.parse(exp);
    const path = join(this.expDir(e.id), "experiment.jsonl");
    const rec = readJsonl(path).records[0];
    if (rec !== undefined) {
      const { _createdAt: _c, ...rest } = rec as Record<string, unknown>;
      const prev = ExperimentSchema.parse(rest);
      if (canonicalJson(prev) === canonicalJson(e)) return;
      const diff = (Object.keys(e) as Array<keyof Experiment>).filter((k) => !EXECUTION_PARAMS.includes(k) && canonicalJson(prev[k]) !== canonicalJson(e[k]));
      if (diff.length) throw new ImmutableRecordError(path, `cambian campos inmutables del experimento: ${diff.join(", ")}`);
      const changed = EXECUTION_PARAMS.filter((k) => canonicalJson(prev[k]) !== canonicalJson(e[k]));
      this.appendJournal(e.id, { event: "params-changed", fields: changed, from: Object.fromEntries(changed.map((k) => [k, prev[k]])), to: Object.fromEntries(changed.map((k) => [k, e[k]])) });
      return;
    }
    writeImmutable(path, jsonLine({ ...e, _createdAt: new Date().toISOString() }));
    insertExperiment(this.#index(), e, path, new Date().toISOString());
  }

  readExperiment(experimentId: string): Experiment | null {
    const r = readJsonl(join(this.expDir(experimentId), "experiment.jsonl")).records[0];
    if (r === undefined) return null;
    const { _createdAt: _c, ...rest } = r as Record<string, unknown>;
    return ExperimentSchema.parse(rest);
  }

  /** Persiste un RunResult (validado y redactado). Atómico e inmutable. */
  writeRun(result: RunResult): RunResult {
    const clean = RunResultSchema.parse(redactDeep(result, this.#secrets));
    const path = this.runPath(clean.experimentId, clean.runId);
    writeImmutable(path, jsonLine(clean));
    insertRun(this.#index(), clean, path);
    return clean;
  }

  readRun(experimentId: string | null, runId: string): RunResult | null {
    const r = readJsonl(this.runPath(experimentId, runId)).records[0];
    return r === undefined ? null : RunResultSchema.parse(r);
  }

  /** Lee los runs de un experimento desde los JSONL (fuente de verdad, sin depender del índice). */
  loadRuns(experimentId: string | null): RunResult[] {
    const dir = join(this.expDir(experimentId), "runs");
    if (!existsSync(dir)) return [];
    const out: RunResult[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
      const rec = readJsonl(join(dir, f)).records[0];
      const p = RunResultSchema.safeParse(rec);
      if (p.success) out.push(p.data);
    }
    return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  listExperimentIds(): string[] { return this.#listExpIds(); }

  /** Diario append-only de eventos del motor (reintentos, pausas, paradas). */
  appendJournal(experimentId: string | null, record: Record<string, unknown>): void {
    appendLine(this.journalPath(experimentId), redactDeep({ at: new Date().toISOString(), ...record }, this.#secrets));
  }

  readJournal(experimentId: string | null): Record<string, unknown>[] {
    return readJsonl(this.journalPath(experimentId)).records as Record<string, unknown>[];
  }

  /** Consulta vía índice sqlite. */
  queryRuns(f: RunFilter = {}): RunResult[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    const add = (col: string, v: string | number | undefined): void => { if (v !== undefined) { where.push(`${col} = ?`); args.push(v); } };
    add("experiment_id", f.experimentId); add("scenario_id", f.scenarioId);
    add("configuration_id", f.configurationId); add("outcome", f.outcome);
    if (f.success !== undefined) add("success", f.success ? 1 : 0);
    const sql = `SELECT json FROM runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY started_at, run_id`;
    const rows = this.#index().prepare(sql).all(...args) as Array<{ json: string }>;
    return rows.map((r) => RunResultSchema.parse(JSON.parse(r.json)));
  }

  /** SQL de solo lectura sobre el índice (para informes ad hoc). */
  sql<T = Record<string, unknown>>(query: string, ...args: Array<string | number | null>): T[] {
    if (!/^\s*select\b/i.test(query)) throw new Error("solo SELECT");
    return this.#index().prepare(query).all(...args) as T[];
  }

  /**
   * Reconstruye el índice desde cero a partir de los JSONL (construye en un archivo temporal y lo
   * renombra: atómico). Ignora y reporta registros corruptos; jamás modifica los JSONL.
   */
  rebuildIndex(): RebuildReport {
    this.#db?.close();
    this.#db = null;
    const tmp = join(this.root, `index.sqlite.rebuild-${process.pid}`);
    for (const s of ["", "-wal", "-shm"]) rmSync(tmp + s, { force: true });
    const db = new DatabaseSync(tmp);
    db.exec(DDL);
    const report: RebuildReport = { experiments: 0, runs: 0, skipped: [] };
    db.exec("BEGIN");
    try {
      for (const id of this.#listExpIds()) {
        const dir = this.expDir(id);
        const ePath = join(dir, "experiment.jsonl");
        const er = readJsonl(ePath).records[0];
        if (er !== undefined) {
          const { _createdAt, ...rest } = er as Record<string, unknown>;
          const p = ExperimentSchema.safeParse(rest);
          if (p.success) { insertExperiment(db, p.data, ePath, typeof _createdAt === "string" ? _createdAt : null); report.experiments++; }
          else report.skipped.push(`${ePath}: experimento inválido`);
        }
        const runsDir = join(dir, "runs");
        if (!existsSync(runsDir)) continue;
        for (const f of readdirSync(runsDir).filter((n) => n.endsWith(".jsonl")).sort()) {
          const path = join(runsDir, f);
          const { records, badLines } = readJsonl(path);
          if (badLines.length) report.skipped.push(`${path}: líneas corruptas ${badLines.join(",")}`);
          const p = RunResultSchema.safeParse(records[0]);
          if (p.success) { insertRun(db, p.data, path); report.runs++; }
          else if (records.length) report.skipped.push(`${path}: run inválido`);
        }
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      db.close();
      throw e;
    }
    db.exec("PRAGMA journal_mode=DELETE");
    db.close();
    for (const s of ["-wal", "-shm"]) { rmSync(this.indexPath + s, { force: true }); rmSync(tmp + s, { force: true }); }
    renameSync(tmp, this.indexPath);
    return report;
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }
}

export function openStore(root: string): Store {
  return new Store(root);
}
