/**
 * Handlers IPC del modo Code (pty, git, dialog) según `shared/ipc-code.ts`.
 * Registrar DESPUÉS de `registerAllHandlers` para reemplazar los placeholders `NOT_IMPLEMENTED`.
 */
import { app, BrowserWindow, webContents, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '@shared/ipc'
import {
  CODE_EVENTS,
  type CodeEventChannel,
  type CodeEventContract,
  type CodeInvokeChannel,
  type CodeRequest,
  type CodeResponse
} from '@shared/ipc-code'
import * as git from '../git/service'
import { GitError } from '../git/service'
import * as dialogService from '../dialog/service'
import { PtyService } from '../pty/service'
import { settingsStore } from '../store'
import { guardInvoke, IpcGuardError } from './guard'

type Handler<C extends CodeInvokeChannel> = (
  req: CodeRequest<C>,
  event: IpcMainInvokeEvent
) => CodeResponse<C> | Promise<CodeResponse<C>>

function on<C extends CodeInvokeChannel>(ipcMain: IpcMain, channel: C, handler: Handler<C>): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<CodeResponse<C>>> => {
    try {
      const req = guardInvoke(event, channel, args) as CodeRequest<C>
      return { ok: true, data: await handler(req, event) }
    } catch (err) {
      if (err instanceof IpcGuardError) return { ok: false, code: err.kind, error: err.message }
      if (!(err instanceof GitError)) console.error(`[ipc] ${channel}:`, err)
      return { ok: false, code: 'ERROR', error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function sendToId<C extends CodeEventChannel>(wcId: number, channel: C, payload: CodeEventContract[C]): void {
  const wc = webContents.fromId(wcId)
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

function req<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) throw new Error(`Falta el parámetro "${name}"`)
  return value
}

let ptyService: PtyService | null = null

/** Servicio de terminales (singleton) — útil para matar todo al salir. */
export function getPtyService(): PtyService | null {
  return ptyService
}

export function registerCodeHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  // ---- pty ----
  const owners = new Map<string, number>()
  const pty = new PtyService({
    onData: (id, data) => {
      const wcId = owners.get(id)
      if (wcId !== undefined) sendToId(wcId, CODE_EVENTS.ptyData, { id, data })
    },
    onExit: (id, exitCode) => {
      const wcId = owners.get(id)
      owners.delete(id)
      if (wcId !== undefined) sendToId(wcId, CODE_EVENTS.ptyExit, { id, exitCode })
    }
  })
  ptyService = pty
  const trackedSenders = new Set<number>()

  const assertOwner = (id: string, event: IpcMainInvokeEvent): void => {
    if (typeof id !== 'string' || !pty.isOwner(id, event.sender.id)) throw new Error(`Terminal no encontrada: ${String(id)}`)
  }

  on(ipcMain, 'pty:available', () => pty.availability())
  on(ipcMain, 'pty:create', (r, event) => {
    const sender = event.sender
    const info = pty.create(req(r, 'req'), sender.id)
    owners.set(info.id, sender.id)
    if (!trackedSenders.has(sender.id)) {
      trackedSenders.add(sender.id)
      const senderId = sender.id
      sender.once('destroyed', () => {
        trackedSenders.delete(senderId)
        pty.killOwner(senderId)
        for (const [id, owner] of owners) if (owner === senderId) owners.delete(id)
      })
    }
    return info
  })
  on(ipcMain, 'pty:write', (r, event) => {
    assertOwner(r?.id, event)
    pty.write(r.id, r.data)
  })
  on(ipcMain, 'pty:resize', (r, event) => {
    assertOwner(r?.id, event)
    pty.resize(r.id, r.cols, r.rows)
  })
  on(ipcMain, 'pty:kill', (r, event) => {
    if (!r?.id || !pty.isOwner(r.id, event.sender.id)) return
    pty.kill(r.id)
  })
  on(ipcMain, 'pty:list', (_r, event) => pty.list(event.sender.id))

  const killAll = (): void => pty.killAll()
  app.on('will-quit', killAll)
  process.on('exit', killAll)

  // ---- git ----
  on(ipcMain, 'git:isRepo', (r) => git.isRepo(req(r, 'req').cwd))
  on(ipcMain, 'git:status', (r) => git.status(req(r, 'req').cwd))
  on(ipcMain, 'git:diff', (r) => git.diff(req(r, 'req')))
  on(ipcMain, 'git:branches', (r) => git.branches(req(r, 'req').cwd))
  on(ipcMain, 'git:currentBranch', (r) => git.currentBranch(req(r, 'req').cwd))
  on(ipcMain, 'git:worktrees', (r) => git.listWorktrees(req(r, 'req').cwd))
  on(ipcMain, 'git:createWorktree', (r) => git.createWorktree(req(r, 'req').cwd, r.branch, r.base))
  on(ipcMain, 'git:removeWorktree', (r) => git.removeWorktree(req(r, 'req').cwd, r.path, r.force === true))
  on(ipcMain, 'git:commit', (r) => git.commit(req(r, 'req').cwd, r.message, r.stageAll === true))
  on(ipcMain, 'git:log', (r) => git.log(req(r, 'req').cwd, r.n))

  // ---- dialog ----
  on(ipcMain, 'dialog:openFolder', async (r, event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    const path = await dialogService.openFolder(parent, r ?? {})
    if (path) settingsStore.addRecentFolder(path)
    return path
  })
  on(ipcMain, 'dialog:revealInFinder', (r) => dialogService.revealInFinder(req(r, 'req').path))
  on(ipcMain, 'dialog:openInEditor', (r) => dialogService.openInEditor(req(r, 'req').path))
}
