import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { killTree, verifyNoOrphans } from "../core/proc.ts";

/** Variable de entorno con la que el banco marca TODO proceso de un run (la heredan los descendientes). */
export const RUN_MARKER = "AB_RUN_ROOT";

/**
 * pids marcados con `AB_RUN_ROOT=<root>` en su entorno (macOS: `ps -Eww` muestra el entorno de procesos propios).
 * Encuentra demonios con setsid/doble fork y cwd=/ que ni el árbol de procesos ni el cwd ni la línea de comandos delatan.
 * Un proceso que limpie su entorno antes de lanzar al hijo (`env -i`) elude esta marca; cwd y cmdline siguen aplicando.
 */
export function pidsWithMarker(root: string): number[] {
  const r = spawnSync("ps", ["-A", "-E", "-ww", "-o", "pid=,command="], { encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024 * 1024 });
  const needle = `${RUN_MARKER}=${root}`;
  const out: number[] = [];
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const rest = m[2] ?? "";
    const i = rest.indexOf(needle);
    if (pid !== process.pid && i >= 0 && (i + needle.length === rest.length || /\s/.test(rest[i + needle.length] ?? ""))) out.push(pid);
  }
  return [...new Set(out)];
}

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
  const swept = [...new Set([...pidsWithCwdUnder(root), ...pidsWithMarker(root)])];
  for (const pid of swept) await killTree(pid, { graceMs: 1000 });
  return { swept, survivors: verifyNoOrphans(swept) };
}
