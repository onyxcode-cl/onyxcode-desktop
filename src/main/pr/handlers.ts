/**
 * Canales IPC `pr:*` (rama → subir → pull request → revisión). Solo la ventana principal (no están en `CHANNEL_ROLES`) y el
 * celular los tiene prohibidos (clase X). Cada carpeta debe ser un proyecto abierto en la ventana o reciente; los argumentos ya
 * llegan validados por `IPC_SCHEMAS` y main los vuelve a comprobar.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { CodeInvokeContract } from '@shared/ipc-code'
import { makeInvokeHandler } from '../ipc/handle'
import { createPr, ghInfo, postReview, reviewInfo, viewBranchPr } from './gh'
import { branchChanges, createBranch, workingDiff, listRemotes, push, pushPlan, repoRootOf, repoStatus } from './git'
import { PrError } from './exec'

const on = makeInvokeHandler<CodeInvokeContract>({ withCode: true, silent: (err) => err instanceof PrError })

export interface PrHandlerDeps {
  /** Lanza si `cwd` no es un proyecto abierto en la ventana que llama (o reciente). */
  assertProject: (cwd: string, event: IpcMainInvokeEvent) => void
}

export function registerPrHandlers(ipcMain: IpcMain, deps: PrHandlerDeps): void {
  const ok = (cwd: string, event: IpcMainInvokeEvent): string => {
    deps.assertProject(cwd, event)
    return cwd
  }
  on(ipcMain, 'pr:status', (r, event) => repoStatus(ok(r.cwd, event)))
  on(ipcMain, 'pr:gh', async (r, event) => {
    const cwd = ok(r.cwd, event)
    let host: string | null = 'github.com'
    if (r.remote) {
      const root = await repoRootOf(cwd)
      host = (await listRemotes(root)).find((x) => x.name === r.remote)?.host ?? null
    }
    return ghInfo(cwd, host)
  })
  on(ipcMain, 'pr:createBranch', (r, event) => createBranch(ok(r.cwd, event), r.name))
  on(ipcMain, 'pr:pushPlan', (r, event) => pushPlan(ok(r.cwd, event), r.remote))
  on(ipcMain, 'pr:push', (r, event) => push({ ...r, cwd: ok(r.cwd, event) }))
  on(ipcMain, 'pr:changes', (r, event) => branchChanges(ok(r.cwd, event), r.remote, r.base))
  on(ipcMain, 'pr:workDiff', (r, event) => workingDiff(ok(r.cwd, event), r.staged))
  on(ipcMain, 'pr:view', (r, event) => viewBranchPr(ok(r.cwd, event), r.remote, r.branch))
  on(ipcMain, 'pr:create', (r, event) => createPr({ ...r, cwd: ok(r.cwd, event) }))
  on(ipcMain, 'pr:reviewInfo', (r, event) => reviewInfo(ok(r.cwd, event), r.remote, r.ref))
  on(ipcMain, 'pr:postReview', (r, event) => postReview({ ...r, cwd: ok(r.cwd, event) }))
}
