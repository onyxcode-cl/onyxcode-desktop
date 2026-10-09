import { git } from "./git.ts";
import type { GitTree } from "./git.ts";

export interface RestoreOpts {
  /** gitdir separado del run: la copia no necesita (ni debe tener) su propio .git. */
  gitDir?: string;
  /** índice temporal para no pisar el del run (solo con gitDir). */
  indexFile?: string;
}

function treeOf(dir: string, o: RestoreOpts): GitTree | undefined {
  return o.gitDir ? { gitDir: o.gitDir, workTree: dir, ...(o.indexFile ? { indexFile: o.indexFile } : {}) } : undefined;
}

/** Con índice temporal: lo puebla desde el commit (read-tree) la primera vez, sin tocar el índice del run. */
const primed = new Set<string>();
async function prime(dir: string, commit: string, o: RestoreOpts): Promise<void> {
  if (!o.gitDir || !o.indexFile || primed.has(o.indexFile)) return;
  await git(dir, ["read-tree", commit], 60_000, treeOf(dir, o));
  primed.add(o.indexFile);
}

/** Archivos versionados en `commit` (rutas relativas, orden estable). */
export async function listBaseFiles(dir: string, commit: string, o: RestoreOpts = {}): Promise<string[]> {
  const out = await git(dir, ["ls-tree", "-r", "-z", "--name-only", commit], 60_000, treeOf(dir, o));
  return out.split("\0").filter((p) => p.length > 0).sort();
}

/** Rutas (de `paths`) cuyo contenido en `dir` difiere de `commit`. */
export async function diffAgainstBase(dir: string, commit: string, paths: string[], o: RestoreOpts = {}): Promise<string[]> {
  if (paths.length === 0) return [];
  await prime(dir, commit, o);
  const d = await git(dir, ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", commit, "--", ...paths], 60_000, treeOf(dir, o));
  return d.split("\0").filter((p) => p.length > 0).sort();
}

/**
 * Restaura `paths` al contenido exacto de `commit` (deshace ediciones y borrados del agente).
 * Opera sobre `dir`: úsese sobre una copia, no sobre el workspace del agente.
 */
export async function restoreFromBase(dir: string, commit: string, paths: string[], o: RestoreOpts = {}): Promise<void> {
  if (paths.length === 0) return;
  await prime(dir, commit, o);
  // Se escribe el índice y el árbol de trabajo desde el commit, ignorando lo que haya hecho el agente.
  await git(dir, ["checkout", "-q", "-f", commit, "--", ...paths], 60_000, treeOf(dir, o));
}
