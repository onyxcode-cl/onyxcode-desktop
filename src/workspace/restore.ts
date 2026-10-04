import { git } from "./git.ts";

/** Archivos versionados en `commit` (rutas relativas, orden estable). */
export async function listBaseFiles(dir: string, commit: string): Promise<string[]> {
  const out = await git(dir, ["ls-tree", "-r", "-z", "--name-only", commit]);
  return out.split("\0").filter((p) => p.length > 0).sort();
}

/**
 * Restaura `paths` al contenido exacto de `commit` (deshace ediciones y borrados del agente).
 * Opera sobre `dir`: úsese sobre una copia, no sobre el workspace del agente.
 */
export async function restoreFromBase(dir: string, commit: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  // Se escribe el índice y el árbol de trabajo desde el commit, ignorando lo que haya hecho el agente.
  await git(dir, ["checkout", "-q", "-f", commit, "--", ...paths]);
}
