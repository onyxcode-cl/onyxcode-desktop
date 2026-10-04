import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { killTree, verifyNoOrphans } from "../core/proc.ts";

/** pids cuyo directorio de trabajo está bajo `root` (vía lsof; excluye este proceso). */
export function pidsWithCwdUnder(rootIn: string): number[] {
  let real = rootIn;
  try {
    real = realpathSync(rootIn); // macOS: /var -> /private/var
  } catch {
    /* ya borrado: nada que barrer */
  }
  const roots = new Set([rootIn, real]);
  const r = spawnSync("lsof", ["-w", "-d", "cwd", "-Fpn"], { encoding: "utf8", timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
  const out: number[] = [];
  let pid = -1;
  for (const line of (r.stdout ?? "").split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid > 0 && pid !== process.pid) {
      const p = line.slice(1);
      for (const root of roots) if (p === root || p.startsWith(root + "/")) out.push(pid);
    }
  }
  return [...new Set(out)];
}

/**
 * Barrido de huérfanos que sobrevivieron a su líder (reparentados a init, por lo que
 * el árbol de procesos ya no los ve): mata los procesos con cwd bajo el runRoot.
 */
export async function sweepRunRoot(root: string): Promise<{ swept: number[]; survivors: number[] }> {
  const swept = pidsWithCwdUnder(root);
  for (const pid of swept) await killTree(pid, { graceMs: 1000 });
  return { swept, survivors: verifyNoOrphans(swept) };
}
