/**
 * Handlers IPC del modo Code (pty, git, dialog) según `shared/ipc-code.ts`.
 * Canales propios de Code (ya no comparten nombre con `shared/ipc.ts`).
 */
import { app, BrowserWindow, shell, webContents, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { CODE_EVENTS, type CodeEventChannel, type CodeEventContract, type CodeInvokeContract } from '@shared/ipc-code'
import * as git from '../git/service'
import { GitError } from '../git/service'
import * as dialogService from '../dialog/service'
import { PtyService } from '../pty/service'
import { shouldKillOnNavigation } from '../pty/lifecycle'
import { settingsStore } from '../store'
import { resolveE2eTrashDir, trashToDir } from '../tasks/trash'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readdirSync } from 'node:fs'
import { t } from '@shared/i18n'
import { FileWatchHub } from '../files/watcher'
import { createEntry, FileOpError, projectRoot, renameEntry, trashEntry } from '../files/fs-ops'
import { resolveE2eEditors, type EditorEnv } from '../editors/catalog'
import { EditorError, listInstalled, openWithEditor, type EditorsDeps } from '../editors/service'
import { extrasPrefs } from '../extras/prefs'
import { makeInvokeHandler } from './handle'

const on = makeInvokeHandler<CodeInvokeContract>({
  withCode: true,
  silent: (err) => err instanceof GitError || err instanceof FileOpError || err instanceof EditorError
})

function sendToId<C extends CodeEventChannel>(wcId: number, channel: C, payload: CodeEventContract[C]): void {
  const wc = webContents.fromId(wcId)
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

/** Ruta real de la carpeta del proyecto (así `open -a` recibe siempre una ruta canónica y existente). */
function projectDir(cwd: string): string {
  return projectRoot(cwd)
}

function req<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) throw new Error(`Falta el parámetro "${name}"`)
  return value
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
      const release = (): void => {
        pty.killOwner(senderId)
        for (const [id, owner] of owners) if (owner === senderId) owners.delete(id)
      }
      sender.once('destroyed', () => {
        trackedSenders.delete(senderId)
        release()
      })
      // Recarga de la ventana / renderer caído: el webContents sigue vivo pero sus terminales ya no existen.
      sender.on('did-start-navigation', (details) => {
        if (shouldKillOnNavigation(details)) release()
      })
      sender.on('render-process-gone', release)
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
  // Descartar cambios: siempre a la Papelera para lo nuevo; el contenido previo queda en una copia
  // (userData/code-discard) para «Rehacer». Solo ventana principal (no está en CHANNEL_ROLES).
  const testTrash = resolveE2eTrashDir({ isPackaged: app.isPackaged, env: process.env })
  const discardDeps = (): git.DiscardDeps => ({
    trash: testTrash ? trashToDir(testTrash) : (p) => shell.trashItem(p),
    backupDir: join(app.getPath('userData'), 'code-discard')
  })
  on(ipcMain, 'git:discard', (r) =>
    git.discardChanges(req(r, 'req').cwd, r.paths, discardDeps(), r.scope === 'unstaged' ? 'unstaged' : 'all')
  )
  on(ipcMain, 'git:discardHunk', (r) => git.discardHunk(req(r, 'req').cwd, r.path, r.index, r.hunk, discardDeps()))
  on(ipcMain, 'git:discardUndo', (r) => git.undoDiscard(req(r, 'req').cwd, r.undoId, discardDeps()))

  // ---- dialog ----
  on(ipcMain, 'dialog:openFolder', async (r, event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    const path = await dialogService.openFolder(parent, r ?? {})
    if (path) settingsStore.addRecentFolder(path)
    return path
  })
  on(ipcMain, 'dialog:revealInFinder', (r) => dialogService.revealInFinder(req(r, 'req').path))
  on(ipcMain, 'dialog:openInEditor', (r) => dialogService.openInEditor(req(r, 'req').path))

  // ---- archivos del proyecto: vigilante (fs.watch, sin polling), gestor y «Abrir en…» ----
  // Solo la ventana principal (ninguno de estos canales está en CHANNEL_ROLES). El «proyecto activo» de una ventana
  // es la carpeta que su panel de archivos tiene suscrita: el gestor y «Abrir en…» solo actúan sobre ella.
  const hub = new FileWatchHub((wcId, ev) => sendToId(wcId, CODE_EVENTS.filesChanged, ev))
  const watchedSenders = new Set<number>()
  app.on('will-quit', () => hub.closeAll())
  const active = (cwd: string, event: IpcMainInvokeEvent): void => {
    if (!hub.isActive(event.sender.id, cwd)) throw new FileOpError(t('common.files.notActive'))
  }
  on(ipcMain, 'files:watch', (r, event) => {
    const sender = event.sender
    const res = hub.subscribe(sender.id, req(r, 'req').folder, r.subId)
    if (!watchedSenders.has(sender.id)) {
      watchedSenders.add(sender.id)
      const senderId = sender.id
      const release = (): void => hub.releaseSender(senderId)
      sender.once('destroyed', () => {
        watchedSenders.delete(senderId)
        release()
      })
      sender.on('did-start-navigation', (details) => {
        if (shouldKillOnNavigation(details)) release()
      })
      sender.on('render-process-gone', release)
    }
    return res
  })
  on(ipcMain, 'files:setDirs', (r, event) => hub.setDirs(event.sender.id, req(r, 'req').subId, r.dirs))
  on(ipcMain, 'files:unwatch', (r, event) => hub.unsubscribe(event.sender.id, req(r, 'req').subId))
  on(ipcMain, 'files:create', (r, event) => {
    active(req(r, 'req').cwd, event)
    return createEntry(r.cwd, r.parent, r.name, r.kind)
  })
  on(ipcMain, 'files:rename', (r, event) => {
    active(req(r, 'req').cwd, event)
    return renameEntry(r.cwd, r.path, r.name)
  })
  on(ipcMain, 'files:trash', (r, event) => {
    active(req(r, 'req').cwd, event)
    return trashEntry(r.cwd, r.path, testTrash ? trashToDir(testTrash) : (p) => shell.trashItem(p))
  })
  const editorEnv = (): EditorEnv => ({
    platform: process.platform,
    env: process.env,
    home: homedir(),
    exists: (p) => existsSync(p),
    readdir: (p) => readdirSync(p)
  })
  const editorsDeps = (): EditorsDeps => ({
    env: editorEnv(),
    launch: (spec) => dialogService.tryLaunch(spec.cmd, spec.args),
    openPath: (folder) => shell.openPath(folder),
    e2e: resolveE2eEditors({ isPackaged: app.isPackaged, env: process.env })
  })
  on(ipcMain, 'editors:list', (r, event) => {
    active(req(r, 'req').cwd, event)
    const editors = listInstalled(editorsDeps())
    const last = extrasPrefs.get().lastEditor
    return { editors, last: editors.some((e) => e.id === last) ? (last as (typeof editors)[number]['id']) : null }
  })
  on(ipcMain, 'editors:open', async (r, event) => {
    active(req(r, 'req').cwd, event)
    await openWithEditor(projectDir(r.cwd), r.id, editorsDeps())
    if (extrasPrefs.get().lastEditor !== r.id) extrasPrefs.set({ lastEditor: r.id })
  })
}
