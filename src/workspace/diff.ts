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
export async function captureDiff(dir: string, base = "HEAD", opts: { gitDir?: string } = {}): Promise<WorkspaceDiff> {
  const tree = opts.gitDir ? { gitDir: opts.gitDir, workTree: dir } : undefined;
  const g = (args: string[]) => git(dir, args, 60_000, tree);
  await g(["add", "-A"]);
  const ns = await g(["diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--no-renames", base]);
  const parts = ns.split("\0").filter((p) => p.length > 0);
  const out: WorkspaceDiff = { created: [], modified: [], deleted: [], patch: "" };
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]!;
    const file = parts[i + 1]!;
    if (status.startsWith("A")) out.created.push(file);
    else if (status.startsWith("D")) out.deleted.push(file);
    else out.modified.push(file);
  }
  out.patch = await g(["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary", "--no-renames", base]);
  return out;
}

export function allChanged(d: WorkspaceDiff): string[] {
  return [...d.created, ...d.modified, ...d.deleted];
}
