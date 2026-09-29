// Ayudantes del spec del LRU de `messages` (docs/LRU-PLAN.md): chats por UI, claves de `messages`, peticiones al falso.
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { Page } from 'playwright-core'
import { stubDialog } from './dialogs'
import { FakeClient, type FakeConnection, type FakeRequest } from './fake'
import { ROOT, type E2EApp } from './launch'
import { MODE_LABELS } from '../../src/shared/labels'
import { storeState } from './stores'
import { expectVisible } from './wait'

/** Cambia a un modo por la barra de modos (clic real). */
export async function gotoMode(page: Page, name: 'Chat' | 'Code' | 'Tareas' | 'Rutinas'): Promise<void> {
  await page.locator('nav[aria-label="Modo"]').getByRole('button', { name }).click()
}

/** Encola un guion en el falso que responde a un prompt que case con `^prompt$`. */
export async function scriptFor(fake: FakeClient, prompt: string, reply: string, extra: Record<string, unknown> = {}): Promise<void> {
  await fake.script({ match: `^${prompt}$`, steps: [{ type: 'text', text: reply }], ...extra })
}

/** Crea una conversación NUEVA en Chat enviando `prompt` por el compositor y espera su respuesta en pantalla. */
export async function newChatVia(page: Page, prompt: string, waitText?: string): Promise<string> {
  await gotoMode(page, 'Chat')
  await page.getByRole('button', { name: 'Nueva conversación' }).first().click()
  const box = page.getByPlaceholder('Escribe un mensaje…')
  await box.fill(prompt)
  await page.getByRole('button', { name: 'Enviar' }).click()
  if (waitText) await expectVisible(page.getByText(waitText, { exact: false }), 30_000)
  await expect.poll(() => storeState<string | null>(page, 'useChat', 'activeSessionId'), { message: 'sesión activa tras enviar' }).toBeTruthy()
  const id = (await storeState<string | null>(page, 'useChat', 'activeSessionId')) as string
  if (waitText) await waitIdle(page, id)
  return id
}

/** Claves de `useSessions.messages`. */
export async function messageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys((window as any).__onyxE2E.useSessions.getState().messages))
}

/** Nº de veces que la app pidió `GET /session/<id>/message` al falso (opcionalmente solo la sesión `id`). */
export async function messageFetches(fake: FakeClient, id?: string): Promise<number> {
  const list = await fake.requests({ limit: 5000, method: 'GET' })
  return list.filter((r) => matchesMessageList(r, id)).length
}

export function matchesMessageList(r: FakeRequest, id?: string): boolean {
  const m = /^\/session\/([^/]+)\/message$/.exec(r.path)
  return !!m && (id === undefined || m[1] === id)
}

/** Texto de la respuesta del asistente en el servidor (concatena las partes de texto de la sesión). */
export async function serverText(conn: FakeConnection, id: string): Promise<string> {
  const res = await fetch(`${conn.baseUrl}/session/${id}/message`, { headers: { authorization: conn.authorization } })
  const list = (await res.json()) as { info: { role: string }; parts: { type: string; text?: string }[] }[]
  return list
    .filter((m) => m.info.role === 'assistant')
    .flatMap((m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text ?? ''))
    .join('')
}

/** Texto del asistente de la sesión tal como está en el store del renderer. */
export async function storeAssistantText(page: Page, id: string): Promise<string> {
  return page.evaluate((sid) => {
    const list = ((window as any).__onyxE2E.useSessions.getState().messages[sid] ?? []) as { info: { role: string }; parts: { type: string; text?: string }[] }[]
    return list
      .filter((m) => m.info.role === 'assistant')
      .flatMap((m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text ?? ''))
      .join('')
  }, id)
}

/** Espera a que el store tenga `messages[id]` cargado (`loaded[id]`). */
export async function waitLoaded(page: Page, id: string, timeout = 15_000): Promise<void> {
  await expect
    .poll(() => page.evaluate((sid) => Boolean((window as any).__onyxE2E.useSessions.getState().loaded[sid]), id), { timeout, message: `loaded[${id}]` })
    .toBe(true)
}

/** Recarga la ventana (para releer `lruMax()`/flags de localStorage) y espera a los ganchos + barra de modos. */
export async function setLocalAndReload(app: E2EApp, entries: Record<string, string | null>): Promise<void> {
  await app.page.evaluate((e) => {
    for (const [k, v] of Object.entries(e)) {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    }
  }, entries)
  await app.page.reload({ waitUntil: 'domcontentloaded' })
  await app.page.waitForFunction(() => Boolean((window as any).__onyxE2E), undefined, { timeout: 60_000 })
  await app.page.locator('nav[aria-label="Modo"]').waitFor()
}

// ───────────── Tareas real (sidecar sandboxeado + OpenCode falso propio) ─────────────

/**
 * Copia del falso FUERA de userData (el sandbox de Tareas niega leer userData, y el `opencode` del harness vive ahí).
 * Devuelve el `OPENCODE_BIN` para `useApp({ env })` y la función de limpieza.
 */
export function prepareFakeBin(): { env: Record<string, string>; cleanup: () => void } {
  const dir = mkdtempSync(join('/private/tmp', 'onyx-e2e-fakebin-'))
  for (const f of ['opencode', 'server.mjs']) cpSync(join(ROOT, 'e2e', 'fake-opencode', f), join(dir, f))
  return { env: { OPENCODE_BIN: join(dir, 'opencode') }, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Carpeta temporal DENTRO del home (Tareas rechaza `/private`, `/tmp`… como «carpeta del sistema»). */
export function makeHomeFolder(): { path: string; cleanup: () => void } {
  const path = realpathSync(mkdtempSync(join(homedir(), '.onyx-e2e-lru-')))
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) }
}

export interface CoworkConn {
  folder: string
  baseUrl: string
  authorization: string
}

/** Elige la carpeta por la UI (diálogo nativo stubbeado), acepta el permiso y espera a que Tareas esté listo. */
export async function connectCowork(app: E2EApp, folder: string): Promise<{ conn: CoworkConn; fake: FakeClient }> {
  const { page, electronApp } = app
  await stubDialog(electronApp, { openPaths: [folder] })
  await gotoMode(page, MODE_LABELS.tasks)
  await page.getByRole('button', { name: 'Elegir carpeta' }).first().click()
  await page.getByRole('button', { name: 'Permitir' }).click()
  await expect.poll(() => storeState(page, 'useCowork', 'phase'), { timeout: 60_000, message: 'Tareas phase' }).toBe('ready')
  const conn = await storeState<CoworkConn>(page, 'useCowork', 'conn')
  return { conn, fake: new FakeClient(conn) }
}

/** Crea una tarea nueva desde el hero (Nueva tarea → compositor → Enviar). Devuelve su id (ya en reposo). */
export async function newTaskVia(page: Page, prompt: string, waitText: string): Promise<string> {
  await page.getByRole('button', { name: /^Nueva tarea/ }).first().click()
  await page.getByPlaceholder('Describe la tarea que quieres delegar…').fill(prompt)
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expectVisible(page.getByText(waitText, { exact: false }).first(), 30_000)
  const id = await storeState<string | null>(page, 'useCowork', 'activeTaskId')
  if (!id) throw new Error('newTaskVia: sin tarea activa')
  await waitIdle(page, id)
  return id
}

/** Espera a que la sesión no esté busy/retry en `useSessions.status`. */
export async function waitIdle(page: Page, id: string, timeout = 30_000): Promise<void> {
  await expect
    .poll(() => page.evaluate((sid) => ((window as any).__onyxE2E.useSessions.getState().status[sid] ?? 'idle') === 'idle', id), { timeout, message: `idle[${id}]` })
    .toBe(true)
}

/** Emite `n` sesiones «ajenas» (que la app no tiene abiertas) con un mensaje suelto cada una, en el directorio dado. */
export async function emitGhostSessions(fake: FakeClient, directory: string, n: number, prefix = 'ses_ghost_'): Promise<string[]> {
  const ids: string[] = []
  const events: unknown[] = []
  for (let i = 0; i < n; i++) {
    const sid = `${prefix}${Date.now().toString(36)}_${i}`
    ids.push(sid)
    events.push({
      type: 'message.updated',
      directory,
      properties: {
        sessionID: sid,
        info: { id: `msg_${sid}`, sessionID: sid, role: 'user', time: { created: Date.now() }, agent: 'build', model: { providerID: 'fake', modelID: 'fake-model' } }
      }
    })
    events.push({
      type: 'message.part.updated',
      directory,
      properties: { sessionID: sid, time: Date.now(), part: { id: `prt_${sid}`, sessionID: sid, messageID: `msg_${sid}`, type: 'text', text: `texto suelto ${sid}` } }
    })
  }
  await fake.emit({ events })
  return ids
}
