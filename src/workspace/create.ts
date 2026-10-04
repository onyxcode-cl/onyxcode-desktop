import { mkdir, readdir } from "node:fs/promises";
import { git, gitArchiveTo } from "./git.ts";

export interface CreatedWorkspace {
  dir: string;
  /** Commit inicial del repo fresco (no existe historia del fixture). */
  baseCommit: string;
  fixtureCommit: string;
}

/**
 * Crea un workspace limpio: exporta el commit base del fixture con `git archive`
 * y hace `git init` fresco con un único commit inicial. `dir` debe no existir o estar vacío.
 */
export async function createWorkspace(opts: { fixtureRepo: string; commit: string; dir: string }): Promise<CreatedWorkspace> {
  const { fixtureRepo, commit, dir } = opts;
  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length > 0) throw new Error(`el workspace no está vacío: ${dir}`);
  const fixtureCommit = (await git(fixtureRepo, ["rev-parse", "--verify", `${commit}^{commit}`])).trim();
  await gitArchiveTo(fixtureRepo, fixtureCommit, dir);
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["-c", "user.name=agent-bench", "-c", "user.email=bench@localhost", "commit", "-q", "--allow-empty", "-m", "base"]);
  const baseCommit = (await git(dir, ["rev-parse", "HEAD"])).trim();
  return { dir, baseCommit, fixtureCommit };
}
