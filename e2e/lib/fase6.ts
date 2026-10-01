// Ayudantes del spec `fase6.e2e.ts` (checklist manual de la Fase 6). Solo test: no tocan código de la app.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { ElectronApplication } from 'playwright-core'
import { FakeClient } from './fake'
import { ROOT, type E2EApp } from './launch'
import { MODE_LABELS } from '../../src/shared/labels'
import { stubDialog } from './dialogs'
import { storeState } from './stores'

/** Directorio de Chat tal como lo ve el renderer (`connection.chatDirectory`). */
export async function chatDirectory(app: E2EApp): Promise<string> {
  await expect.poll(() => storeState<string | undefined>(app.page, 'useServer', 'connection.chatDirectory'), { timeout: 30_000 }).toBeTruthy()
  return (await storeState<string>(app.page, 'useServer', 'connection.chatDirectory'))!
}

/** Carpeta temporal con `git init` y un commit (realpath: /var → /private/var en macOS). */
export function makeGitRepo(prefix = 'onyx-e2e-repo-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const git = (...a: string[]): void => void execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'e2e')
  writeFileSync(join(dir, 'README.md'), '# e2e\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

/** `Session` mínima válida para emitir `session.created`/`session.updated` desde el falso. */
export function sessionInfo(id: string, directory: string, title: string): Record<string, unknown> {
  const now = Date.now()
  return { id, slug: id, projectID: 'proj_fake', directory, title, version: '1.18.32', time: { created: now, updated: now } }
}

/** `AssistantMessage` mínimo para `message.updated`. */
export function assistantInfo(id: string, sessionID: string, directory: string, completed = false): Record<string, unknown> {
  const now = Date.now()
  return {
    id,
    sessionID,
    role: 'assistant',
    time: completed ? { created: now, completed: now } : { created: now },
    parentID: 'msg_user_x',
    modelID: 'fake-model',
    providerID: 'fake',
    mode: 'build',
    agent: 'build',
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  }
}

/** Llama al servidor falso como lo haría el SDK (Basic auth + `directory`). Para abortar/consultar rutas reales. */
export async function fakeApi(app: E2EApp, method: string, path: string, directory?: string, body?: unknown): Promise<unknown> {
  const { baseUrl, authorization } = app.fake.conn
  const url = new URL(baseUrl + path)
  if (directory) url.searchParams.set('directory', directory)
  const res = await fetch(url, {
    method,
    headers: { authorization, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return res.json().catch(() => null)
}

/**
 * Cuenta las invocaciones de un canal `ipcMain.handle` envolviendo su handler en main (API interna
 * `ipcMain._invokeHandlers`, estable en Electron 3x-4x). Devuelve funciones para leer/reiniciar el contador.
 */
export async function countIpc(electronApp: ElectronApplication, channel: string): Promise<{ count(): Promise<number>; reset(): Promise<void> }> {
  await electronApp.evaluate(({ ipcMain }, ch) => {
    const g = globalThis as unknown as { __e2eIpcCount?: Record<string, number>; __e2eIpcWrapped?: Record<string, boolean> }
    g.__e2eIpcCount ??= {}
    g.__e2eIpcWrapped ??= {}
    g.__e2eIpcCount[ch] = 0
    if (g.__e2eIpcWrapped[ch]) return
    const map = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
    const orig = map.get(ch)
    if (!orig) throw new Error(`countIpc: canal sin handler: ${ch}`)
    g.__e2eIpcWrapped[ch] = true
    map.set(ch, (...a: unknown[]) => {
      g.__e2eIpcCount![ch]++
      return orig(...a)
    })
  }, channel)
  return {
    count: () => electronApp.evaluate((_e, ch) => (globalThis as unknown as { __e2eIpcCount: Record<string, number> }).__e2eIpcCount[ch] ?? 0, channel),
    reset: () => electronApp.evaluate((_e, ch) => void ((globalThis as unknown as { __e2eIpcCount: Record<string, number> }).__e2eIpcCount[ch] = 0), channel)
  }
}

/** Abre Chat, crea una conversación desde la UI y envía `text`; encola antes `script` en el falso si se da. Devuelve el id de sesión. */
export async function newChatAndSend(app: E2EApp, text: string, script?: Record<string, unknown>): Promise<string> {
  if (script) await app.fake.script(script)
  await app.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
  await app.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
  const box = app.page.getByPlaceholder('Escribe un mensaje…')
  await box.fill(text)
  await app.page.getByRole('button', { name: 'Enviar' }).click()
  await expect.poll(() => storeState<string | null>(app.page, 'useChat', 'activeSessionId'), { timeout: 15_000 }).toBeTruthy()
  return (await storeState<string>(app.page, 'useChat', 'activeSessionId'))!
}

/** Consume (quita de `app.errors`) los errores esperados que casen `re`; devuelve cuántos quitó. Los demás siguen contando. */
export function consumeErrors(app: E2EApp, re: RegExp): number {
  const keep = app.errors.filter((e) => !re.test(e.text))
  const n = app.errors.length - keep.length
  app.errors.splice(0, app.errors.length, ...keep)
  return n
}

/** Abre `dir` como proyecto de Code por la UI: `stubDialog` para el selector nativo y confirmación de confianza. */
export async function openCodeProject(app: E2EApp, dir: string): Promise<void> {
  await stubDialog(app.electronApp, { openPaths: [dir] })
  await app.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Code' }).click()
  const current = await storeState<string | null>(app.page, 'useCode', 'directory')
  if (current !== dir) {
    await app.page.getByRole('button', { name: /Abrir carpeta/ }).first().click()
    const trust = app.page.getByRole('button', { name: 'Confiar y continuar' })
    await expect.poll(() => trust.isVisible(), { timeout: 15_000 }).toBe(true)
    await trust.click()
  }
  await expect.poll(() => storeState<string | null>(app.page, 'useCode', 'directory'), { timeout: 15_000 }).toBe(dir)
}

// ───────────── Tareas real (sidecar sandboxeado + OpenCode falso propio) ─────────────

/**
 * Copia del falso fuera de userData: el sandbox de Tareas (`sandbox-exec`) niega leer userData, donde el harness deja
 * el `opencode` falso. Devuelve el `OPENCODE_BIN` para `useApp({ env })` y la limpieza.
 */
export function prepareFakeBin(): { env: Record<string, string>; cleanup: () => void } {
  const dir = mkdtempSync(join('/private/tmp', 'onyx-e2e-f6bin-'))
  for (const f of ['opencode', 'server.mjs']) cpSync(join(ROOT, 'e2e', 'fake-opencode', f), join(dir, f))
  return { env: { OPENCODE_BIN: join(dir, 'opencode') }, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Carpeta temporal DENTRO del home (Tareas rechaza `/private`, `/tmp`… como carpeta del sistema). */
export function makeHomeFolder(): { path: string; cleanup: () => void } {
  const path = realpathSync(mkdtempSync(join(homedir(), '.onyx-e2e-f6-')))
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) }
}

export interface TasksConn {
  folder: string
  baseUrl: string
  authorization: string
}

/** Espera a que Tareas esté lista (`phase === 'ready'`) tras elegir la carpeta y aceptar el permiso a mano. */
export async function connectTasksFolderReady(app: E2EApp): Promise<{ conn: TasksConn; fake: FakeClient }> {
  await expect.poll(() => storeState(app.page, 'useTasks', 'phase'), { timeout: 60_000, message: 'Tareas phase' }).toBe('ready')
  const conn = await storeState<TasksConn>(app.page, 'useTasks', 'conn')
  return { conn, fake: new FakeClient(conn) }
}

/** Elige la carpeta en Tareas por la UI (diálogo stubbeado), acepta el permiso y espera a `phase === 'ready'`. */
export async function connectTasksFolder(app: E2EApp, folder: string): Promise<{ conn: TasksConn; fake: FakeClient }> {
  await stubDialog(app.electronApp, { openPaths: [folder] })
  await app.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: MODE_LABELS.tasks }).click()
  await app.page.getByRole('button', { name: 'Elegir carpeta' }).first().click()
  await app.page.getByRole('button', { name: 'Permitir' }).click()
  await expect.poll(() => storeState(app.page, 'useTasks', 'phase'), { timeout: 60_000, message: 'Tareas phase' }).toBe('ready')
  const conn = await storeState<TasksConn>(app.page, 'useTasks', 'conn')
  return { conn, fake: new FakeClient(conn) }
}

/** Escribe entradas de localStorage y recarga la ventana; espera ganchos y barra de modos (solo dev). */
export async function setLocalAndReload(app: E2EApp, entries: Record<string, string | null>): Promise<void> {
  await app.page.evaluate((e) => {
    for (const [k, v] of Object.entries(e)) {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    }
  }, entries)
  await app.page.reload({ waitUntil: 'domcontentloaded' })
  await app.page.waitForFunction(() => Boolean((window as unknown as { __onyxE2E?: object }).__onyxE2E), undefined, { timeout: 60_000 })
  await app.page.locator('nav[aria-label="Modo"]').waitFor()
}
