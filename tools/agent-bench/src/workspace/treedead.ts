import { killTree, verifyNoOrphans, type KillOptions } from "../core/proc.ts";
import type { TreeDeadSignal } from "./evalcopy.ts";

export interface EnsureTreeDeadResult {
  /** true si la señal se emitió (cero procesos vivos verificados). */
  dead: boolean;
  /** pids que siguen vivos tras matar y verificar (vacío si dead). */
  orphans: number[];
  targeted: number[];
}

/**
 * Mata el árbol de procesos del agente (killTree) y verifica con verifyNoOrphans.
 * Solo marca la señal como muerta si NO queda ningún proceso: así los tests ocultos
 * nunca se inyectan mientras algo del agente siga vivo.
 */
export async function killTreeAndSignal(rootPid: number, signal: TreeDeadSignal, opts: KillOptions = {}): Promise<EnsureTreeDeadResult> {
  const r = await killTree(rootPid, opts);
  const orphans = verifyNoOrphans(r.targeted);
  if (orphans.length === 0) signal.markDead();
  return { dead: orphans.length === 0, orphans, targeted: r.targeted };
}

/**
 * Para cuando el supervisor (supervise) ya terminó y limpió: re-verifica los pids conocidos
 * y emite la señal solo si no hay sobrevivientes.
 */
export function signalIfNoOrphans(signal: TreeDeadSignal, knownPids: readonly number[]): EnsureTreeDeadResult {
  const orphans = verifyNoOrphans(knownPids);
  if (orphans.length === 0) signal.markDead();
  return { dead: orphans.length === 0, orphans, targeted: [...knownPids] };
}
