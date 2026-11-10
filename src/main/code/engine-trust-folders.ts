/**
 * Code ↔ confianza del motor (lazunox.16). El renderer es quien guarda la confianza de Code (diálogo, huella aprobada); cuando una carpeta
 * pasa esa verificación en esta ejecución, main se la declara al motor (`POST /lazunox/trust`) ANTES de que el renderer le dé el foco y
 * empiece a pedirle cosas. Cuando la persona quita la confianza, se le quita también al motor (`DELETE`, que descarga la carpeta).
 *
 * Las copias de trabajo (worktrees) que la propia app creó para el repositorio (`<repo>/../.<repo>-worktrees/<rama>`) se declaran junto
 * con la carpeta: el motor NO hereda la confianza a las carpetas hijas, y sin esto las conversaciones que ya estaban en un árbol de
 * trabajo recibirían `403 folder_not_trusted` tras reiniciar. Un árbol de trabajo que la persona haya hecho a mano, fuera de esa carpeta,
 * no se declara solo (puede traer otra rama con su propio `.opencode`): se abre como cualquier carpeta.
 */
import { basename, dirname, join } from 'node:path'
import type { GitWorktreeDetailed } from '@shared/ipc-code'
import { listWorktrees } from '../git/service'
import { engineTrust, type TrustResult } from '../opencode/engine-trust'

export interface CodeTrustDeps {
  declare: (dir: string, opts?: { preload?: boolean }) => Promise<TrustResult>
  revoke: (dir: string) => Promise<TrustResult>
  worktrees: (dir: string) => Promise<GitWorktreeDetailed[]>
}

const realDeps: CodeTrustDeps = {
  declare: (d, opts) => engineTrust.declare(d, opts),
  revoke: (d) => engineTrust.revoke(d),
  worktrees: (d) => listWorktrees(d)
}

/** Árboles de trabajo creados por la app (en `.<repo>-worktrees` junto al repositorio principal), sin el principal. */
export function appWorktreesOf(list: readonly GitWorktreeDetailed[]): string[] {
  const main = list.find((w) => w.main)
  if (!main) return []
  const appDir = join(dirname(main.path), `.${basename(main.path)}-worktrees`)
  return list.filter((w) => !w.main && !w.bare && !w.prunable && dirname(w.path) === appDir).map((w) => w.path)
}

/** `true` si el motor quedó enterado (o no tiene la función: motor anterior). */
export async function declareCodeFolder(dir: string, deps: CodeTrustDeps = realDeps): Promise<boolean> {
  // Solo la carpeta que la persona acaba de confiar pide precarga; los árboles de trabajo (abajo) y la redeclaración al arrancar, no.
  const r = await deps.declare(dir, { preload: true })
  const ok = r === 'ok' || r === 'unsupported'
  if (ok) {
    // Los árboles de trabajo van aparte y sin bloquear: si git no responde, la carpeta ya quedó declarada.
    try {
      const wts = appWorktreesOf(await deps.worktrees(dir))
      await Promise.all(wts.map((w) => deps.declare(w)))
    } catch {
      /* sin git o sin repositorio: nada más que declarar */
    }
  }
  return ok
}

export async function revokeCodeFolder(dir: string, deps: CodeTrustDeps = realDeps): Promise<boolean> {
  let wts: string[] = []
  try {
    wts = appWorktreesOf(await deps.worktrees(dir))
  } catch {
    /* sin git */
  }
  const r = await deps.revoke(dir)
  await Promise.all(wts.map((w) => deps.revoke(w)))
  return r === 'ok' || r === 'unsupported'
}
