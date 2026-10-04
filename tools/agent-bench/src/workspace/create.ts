import { mkdir, readdir } from "node:fs/promises";
import { ensureGitDirParent, git, gitArchiveTo } from "./git.ts";
import type { GitTree } from "./git.ts";

export interface CreatedWorkspace {
  dir: string;
  /** Commit inicial del repo fresco (no existe historia del fixture). Úsese como base del diff. */
  baseCommit: string;
  fixtureCommit: string;
  /** Presente si se pidió gitdir separado. */
  gitDir?: string;
}

/**
 * Inicializa el repo del banco sobre `dir` con un único commit "base" y devuelve su hash.
 * Con `gitDir` el repo vive fuera del workspace (el workspace no recibe `.git`).
 */
export async function initBaseRepo(dir: string, gitDir?: string): Promise<string> {
  if (gitDir) {
    ensureGitDirParent(gitDir);
    const tree: GitTree = { gitDir, workTree: dir };
    await git(dir, ["init", "-q", "-b", "main"], 60_000, tree);
    await git(dir, ["add", "-A"], 60_000, tree);
    await git(dir, ["-c", "user.name=agent-bench", "-c", "user.email=bench@localhost", "commit", "-q", "--allow-empty", "-m", "base"], 60_000, tree);
    return (await git(dir, ["rev-parse", "HEAD"], 60_000, tree)).trim();
  }
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["-c", "user.name=agent-bench", "-c", "user.email=bench@localhost", "commit", "-q", "--allow-empty", "-m", "base"]);
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

/**
 * Crea un workspace limpio: exporta el commit base del fixture con `git archive`
 * y hace `git init` fresco con un único commit inicial. `dir` debe no existir o estar vacío.
 * Con `gitDir` (recomendado con agentes reales) el repo queda fuera del área escribible por el agente.
 */
export async function createWorkspace(opts: { fixtureRepo: string; commit: string; dir: string; gitDir?: string }): Promise<CreatedWorkspace> {
  const { fixtureRepo, commit, dir, gitDir } = opts;
  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length > 0) throw new Error(`el workspace no está vacío: ${dir}`);
  const fixtureCommit = (await git(fixtureRepo, ["rev-parse", "--verify", `${commit}^{commit}`])).trim();
  await gitArchiveTo(fixtureRepo, fixtureCommit, dir);
  const baseCommit = await initBaseRepo(dir, gitDir);
  return { dir, baseCommit, fixtureCommit, ...(gitDir ? { gitDir } : {}) };
}
