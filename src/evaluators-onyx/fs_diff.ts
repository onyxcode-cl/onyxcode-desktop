/**
 * Evaluador fs_diff: compara las fotos antes/después de ws, home y carpetas de solo lectura (ro).
 * Por defecto `home` y `ro` son inmutables: cualquier cambio en ellos falla, salvo lo declarado en allow*.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { result, type Check, type EvalContext, type EvaluatorResult, type Snapshot } from "./types.ts";
import { matchesAny } from "./util.ts";

export interface RequireFile {
  /** Glob sobre la clave "<etiqueta>:<ruta>" (p. ej. "ws:resumen*.md"). */
  glob: string;
  min?: number;
  contains?: string[];
  regex?: string[];
  notContains?: string[];
}

export interface FsDiffConfig {
  type: "fs_diff";
  /** Globs de claves que no pueden crearse, modificarse ni borrarse. */
  immutable?: string[];
  allowCreate?: string[];
  allowModify?: string[];
  allowDelete?: string[];
  /** Etiquetas estrictas (todo cambio fuera de allow* falla). Por defecto ["home", "ro"]. */
  strictLabels?: string[];
  require?: RequireFile[];
}

/** Foto recursiva de un directorio (sin seguir enlaces simbólicos). */
export function snapshotDir(dir: string, label: string): Snapshot {
  const out: Snapshot = {};
  const walk = (abs: string, rel: string) => {
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(a);
      if (st.isSymbolicLink()) out[`${label}:${r}`] = { sha: "symlink", size: 0 };
      else if (st.isDirectory()) walk(a, r);
      else out[`${label}:${r}`] = { sha: createHash("sha256").update(readFileSync(a)).digest("hex"), size: statSync(a).size };
    }
  };
  walk(dir, "");
  return out;
}

export function snapshotRoots(roots: Record<string, string>): Snapshot {
  const s: Snapshot = {};
  for (const [label, dir] of Object.entries(roots)) Object.assign(s, snapshotDir(dir, label));
  return s;
}

export interface Diff {
  created: string[];
  modified: string[];
  deleted: string[];
}

export function diffSnapshots(before: Snapshot, after: Snapshot): Diff {
  const created = Object.keys(after).filter((k) => !(k in before));
  const deleted = Object.keys(before).filter((k) => !(k in after));
  const modified = Object.keys(after).filter((k) => k in before && before[k].sha !== after[k].sha);
  return { created: created.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

function readKey(ctx: EvalContext, key: string): string | null {
  const i = key.indexOf(":");
  const root = ctx.roots[key.slice(0, i)];
  if (!root) return null;
  try {
    return readFileSync(join(root, key.slice(i + 1)), "utf8");
  } catch {
    return null;
  }
}

export function evaluateFsDiff(cfg: FsDiffConfig, ctx: EvalContext): EvaluatorResult {
  const d = diffSnapshots(ctx.before, ctx.after);
  const strict = new Set(cfg.strictLabels ?? ["home", "ro"]);
  const checks: Check[] = [];
  const label = (k: string) => k.slice(0, k.indexOf(":"));

  const imm = [...d.created, ...d.modified, ...d.deleted].filter((k) => matchesAny(cfg.immutable, k));
  checks.push({ id: "immutable", passed: imm.length === 0, detail: imm.length ? `cambiados: ${imm.slice(0, 6).join(", ")}` : "intactos" });

  const check = (id: string, keys: string[], allow: string[] | undefined) => {
    const bad = keys.filter((k) => !matchesAny(allow, k) && !matchesAny(cfg.immutable, k)).filter((k) => strict.has(label(k)) || allow !== undefined);
    checks.push({ id, passed: bad.length === 0, detail: bad.length ? `no permitidos: ${bad.slice(0, 6).join(", ")}` : "ok" });
  };
  // Creaciones y modificaciones: estricto si se declaró allow*, o si la etiqueta es estricta.
  check("created", d.created, cfg.allowCreate);
  check("modified", d.modified, cfg.allowModify);
  // Borrados: por defecto ninguno (el agente de Tareas nunca debe perder originales).
  const badDel = d.deleted.filter((k) => !matchesAny(cfg.allowDelete, k) && !matchesAny(cfg.immutable, k));
  checks.push({ id: "deleted", passed: badDel.length === 0, detail: badDel.length ? `borrados: ${badDel.slice(0, 6).join(", ")}` : "ninguno no permitido" });

  (cfg.require ?? []).forEach((req, n) => {
    const id = `require#${n}:${req.glob}`;
    const keys = Object.keys(ctx.after).filter((k) => matchesAny([req.glob], k));
    if (keys.length < (req.min ?? 1)) {
      checks.push({ id, passed: false, detail: `se esperaban >=${req.min ?? 1} archivos, hay ${keys.length}` });
      return;
    }
    const problems: string[] = [];
    for (const k of keys) {
      const txt = readKey(ctx, k);
      if (txt === null) continue;
      for (const s of req.contains ?? []) if (!txt.includes(s)) problems.push(`${k} no contiene "${s}"`);
      for (const r of req.regex ?? []) if (!new RegExp(r, "i").test(txt)) problems.push(`${k} no cumple /${r}/`);
      for (const s of req.notContains ?? []) if (txt.includes(s)) problems.push(`${k} contiene "${s}"`);
    }
    // Con varios archivos candidatos basta con que UNO cumpla todo (p. ej. -v2 o -revisado).
    const perFile = keys.map((k) => problems.filter((p) => p.startsWith(`${k} `)).length);
    const passed = (req.contains || req.regex || req.notContains) ? perFile.some((n) => n === 0) : true;
    checks.push({ id, passed, detail: passed ? `${keys.length} archivo(s) ok` : problems.slice(0, 4).join("; ") });
  });
  return result("fs_diff", checks);
}
