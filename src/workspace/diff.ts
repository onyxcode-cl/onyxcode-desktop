import { git } from "./git.ts";

export interface WorkspaceDiff {
  created: string[];
  modified: string[];
  deleted: string[];
  /** Parche unificado (binarios incluidos) contra el commit base. */
  patch: string;
}

/**
 * Captura el diff final contra `base` (por defecto HEAD del commit inicial).
 * Hace `git add -A` para incluir archivos nuevos y luego `git diff --cached --name-status`.
 */
export async function captureDiff(dir: string, base = "HEAD"): Promise<WorkspaceDiff> {
  await git(dir, ["add", "-A"]);
  const ns = await git(dir, ["diff", "--cached", "--name-status", "-z", "--no-renames", base]);
  const parts = ns.split("\0").filter((p) => p.length > 0);
  const out: WorkspaceDiff = { created: [], modified: [], deleted: [], patch: "" };
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]!;
    const file = parts[i + 1]!;
    if (status.startsWith("A")) out.created.push(file);
    else if (status.startsWith("D")) out.deleted.push(file);
    else out.modified.push(file);
  }
  out.patch = await git(dir, ["diff", "--cached", "--binary", "--no-renames", base]);
  return out;
}

export function allChanged(d: WorkspaceDiff): string[] {
  return [...d.created, ...d.modified, ...d.deleted];
}
