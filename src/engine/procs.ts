import { spawnSync } from "node:child_process";
import { isAlive, killTree } from "../core/proc.ts";

/** Pids (distintos del actual) cuya línea de comandos cita `needle` (p. ej. el runRoot) y siguen vivos. */
export function procsCiting(needle: string): number[] {
  const r = spawnSync("ps", ["-A", "-ww", "-o", "pid=,command="], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
  const out: number[] = [];
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid !== process.pid && (m[2] ?? "").includes(needle) && isAlive(pid)) out.push(pid);
  }
  return out;
}

export interface SweepResult {
  /** pids a los que hubo que mandar señales */
  targeted: number[];
  /** supervivientes tras SIGTERM -> SIGKILL (idealmente []) */
  leftover: number[];
}

/**
 * Barrido del árbol del agente: mata (killTree) el pid conocido si sigue vivo y todo proceso cuya
 * línea de comandos cite alguno de los `roots`; verifica que no quede ninguno.
 */
export async function sweepTree(opts: { pid: number | null; roots: string[]; graceMs?: number }): Promise<SweepResult> {
  const graceMs = opts.graceMs ?? 1000;
  const candidates = new Set<number>();
  if (opts.pid !== null && isAlive(opts.pid)) candidates.add(opts.pid);
  for (const r of opts.roots) for (const p of procsCiting(r)) candidates.add(p);
  const targeted = [...candidates];
  for (const pid of targeted) {
    if (isAlive(pid)) await killTree(pid, { graceMs, verifyMs: 1000 });
  }
  const leftover = new Set<number>(targeted.filter(isAlive));
  for (const r of opts.roots) for (const p of procsCiting(r)) leftover.add(p);
  return { targeted, leftover: [...leftover] };
}

/** Parada de emergencia síncrona (segunda señal): SIGKILL a todo lo que cite los roots. */
export function emergencyKill(roots: string[]): number {
  let n = 0;
  for (const r of roots) {
    for (const pid of procsCiting(r)) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* no es líder */ }
      try { process.kill(pid, "SIGKILL"); n++; } catch { /* ya muerto */ }
    }
  }
  return n;
}
