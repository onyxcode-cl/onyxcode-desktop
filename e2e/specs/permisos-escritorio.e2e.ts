// Tarjetas de permiso de ESCRITORIO (ND): teclado seguro, armado de 600 ms, retirada del 1/2/3 de Code y sin doble
// envío. Tareas solo en Mac (el modo no existe en Windows); Code en Mac y Windows. OpenCode falso con pasos `permission`.
// Capturas con ND_PERM_SHOTS_DIR.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import type { Page } from 'playwright-core'
import { runAxe, SERIOUS, summarize } from '../lib/axe'
import { connectTasksFolder, makeGitRepo, makeHomeFolder, openCodeProject, prepareFakeBin } from '../lib/fase6'
import { useApp } from '../lib/harness'
import { MODE, type E2EApp } from '../lib/launch'
import { IS_WIN } from '../lib/proc'
import { shot } from '../lib/shots'
import { expectCount, expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.ND_PERM_SHOTS_DIR
// ⌘↵ en macOS, Ctrl+↵ en Windows (lo resuelve `decidePermKey` con `mac`).
const CONFIRM = IS_WIN ? 'Control+Enter' : 'Meta+Enter'

/** axe sobre la página (claro y oscuro); falla con violaciones serias/críticas/moderadas. */
async function clean(page: Page, view: string): Promise<void> {
  const v = await runAxe(page)
  const bad = [...v.light, ...v.dark].filter((x) => x.impact && SERIOUS.has(x.impact))
  expect(bad, `${view}\n${summarize(v)}`).toEqual([])
}

/** Respuestas de permiso que el falso ha recibido desde que arrancó (acumulado de TODA la app del describe). */
async function totalReplies(app: E2EApp): Promise<number> {
  const reqs = await app.fake.requests({ limit: 1000, method: 'POST' })
  return reqs.filter((r) => /\/permission\/[^/]+\/reply$/.test(r.path)).length
}

/**
 * Cuenta las respuestas de permiso enviadas al falso DENTRO del test en curso (doble clic rápido → exactamente una).
 * El falso y la app viven todo el `describe`, así que el contador del falso es acumulado: la línea base se toma en
 * `beforeEach` (si no, las respuestas legítimas de tests anteriores hacían fallar las aserciones de «0 respuestas»).
 */
function repliesCounter(app: () => E2EApp): () => Promise<number> {
  let base = 0
  beforeEach(async () => {
    base = await totalReplies(app())
  })
  return async () => (await totalReplies(app())) - base
}

// ───────────────────────────── Code ─────────────────────────────

describe.skipIf(!DEV)('permisos de escritorio (ND): Code', () => {
  const dir = makeGitRepo()
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const app = useApp()
  const permissionReplies = repliesCounter(app)

  const card = (a: E2EApp) => a.page.locator('[role="alertdialog"][id^="perm-"]').first()
  const once = (a: E2EApp) => a.page.getByRole('button', { name: /Permitir una vez/ }).first()
  const box = (a: E2EApp) => a.page.getByPlaceholder(/Pide un cambio en el código/)

  async function ask(a: E2EApp, command = 'npm install', match = 'pide permiso nd'): Promise<void> {
    await openCodeProject(a, dir)
    await a.fake.script({
      match,
      steps: [
        { type: 'text', text: 'Necesito ejecutar un comando.' },
        { type: 'permission', permission: 'bash', patterns: [command], metadata: { command, description: 'Comando de prueba.' } }
      ]
    })
    await box(a).fill(match)
    await box(a).press('Enter')
    await expectVisible(once(a), 30_000)
  }

  /** Espera a que «Permitir una vez» esté armado (600 ms de visibilidad continua). */
  async function armed(a: E2EApp): Promise<void> {
    await expect.poll(() => once(a).isEnabled(), { timeout: 5_000, message: 'Permitir armado' }).toBe(true)
  }

  it('⌘↵ con el foco fuera de la tarjeta no responde (la tarjeta no roba el foco)', async () => {
    const a = app()
    await ask(a, 'npm install', 'permiso foco afuera')
    expect(await card(a).evaluate((el) => el.contains(document.activeElement))).toBe(false)
    await a.page.keyboard.press(CONFIRM)
    await a.page.waitForTimeout(400)
    await expectVisible(card(a))
    expect(await permissionReplies()).toBe(0)
  })

  it('foco en la tarjeta + ⌘↵ permite una vez', async () => {
    const a = app()
    await ask(a, 'npm install', 'permiso permite una vez')
    await card(a).focus()
    await armed(a)
    await a.page.keyboard.press(CONFIRM)
    await expectCount(card(a), 0)
    expect(await permissionReplies()).toBe(1)
  })

  it('Enter sobre «Permitir una vez» no permite', async () => {
    const a = app()
    await ask(a, 'npm install', 'permiso enter no permite')
    await once(a).focus()
    await armed(a)
    await a.page.keyboard.press('Enter')
    await a.page.waitForTimeout(400)
    await expectVisible(card(a))
    expect(await permissionReplies()).toBe(0)
  })

  it('Esc rechaza', async () => {
    const a = app()
    await ask(a, 'npm install', 'permiso esc rechaza')
    await card(a).focus()
    await a.page.keyboard.press('Escape')
    await expectCount(card(a), 0)
  })

  it('«2» no responde (retirado el 1/2/3 global)', async () => {
    const a = app()
    await ask(a, 'npm install', 'permiso tecla dos')
    await card(a).focus()
    await a.page.keyboard.press('2')
    await a.page.waitForTimeout(400)
    await expectVisible(card(a))
    expect(await permissionReplies()).toBe(0)
  })

  it('doble clic rápido en «Permitir una vez» envía una sola respuesta', async () => {
    const a = app()
    await ask(a, 'npm install', 'permiso doble clic')
    await armed(a)
    await once(a).dblclick()
    await expectCount(card(a), 0)
    expect(await permissionReplies()).toBe(1)
  })

  it('comando de 300 líneas visible entero (con aviso del total)', async () => {
    const a = app()
    const cmd = Array.from({ length: 300 }, (_, i) => `echo linea_${String(i).padStart(3, '0')}`).join('\n')
    await ask(a, cmd, 'permiso comando largo')
    await expectVisible(a.page.getByText('El comando sigue: 300 líneas en total'))
    // El comando no se recorta: la última línea está en el DOM (accesible con scroll).
    await expectVisible(a.page.getByText('echo linea_299', { exact: false }))
    if (SHOTS) await shot(a, SHOTS, 'code-permiso-largo')
  })

  it('tarjeta de permiso sin violaciones axe', async () => {
    const a = app()
    await ask(a, 'npm install', 'permiso axe')
    await clean(a.page, 'code:permiso')
  })
})

// ───────────────────────────── Tareas (solo Mac) ─────────────────────────────

describe.skipIf(!DEV || IS_WIN)('permisos de escritorio (ND): Tareas', () => {
  const bin = prepareFakeBin()
  const res = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    res.cleanup()
  })
  const app = useApp({ env: bin.env })

  const card = (a: E2EApp) => a.page.locator('[role="alertdialog"][id^="perm-"]')
  const once = (a: E2EApp) => a.page.getByRole('button', { name: /Permitir una vez/ }).first()

  async function send(a: E2EApp, text: string): Promise<void> {
    await a.page.getByRole('button', { name: /^Nueva tarea/ }).first().click()
    await a.page.getByPlaceholder('Describe la tarea que quieres delegar…').fill(text)
    await a.page.getByRole('button', { name: 'Enviar' }).first().click()
  }

  async function ask(a: E2EApp, command: string, match: string): Promise<void> {
    const { fake } = await connectTasksFolder(a, res.path)
    await fake.script({
      match,
      steps: [
        { type: 'text', text: 'Necesito ejecutar un comando.' },
        { type: 'permission', permission: 'bash', patterns: [command], metadata: { command } }
      ]
    })
    await send(a, match)
    await expectVisible(once(a), 30_000)
  }

  it('⌘↵ permite una vez y Esc rechaza', async () => {
    const a = app()
    await ask(a, 'npm test', 'tarea permiso permite')
    await card(a).first().focus()
    await expect.poll(() => once(a).isEnabled(), { timeout: 5_000 }).toBe(true)
    await a.page.keyboard.press(CONFIRM)
    await expectCount(card(a), 0)

    await ask(a, 'npm run build', 'tarea permiso rechaza')
    await card(a).first().focus()
    await a.page.keyboard.press('Escape')
    await expectCount(card(a), 0)
  })

  it('dos permisos: al resolver el primero el foco queda en el contenedor del segundo (no en un botón)', async () => {
    const a = app()
    const { fake } = await connectTasksFolder(a, res.path)
    await fake.script({
      match: 'dos permisos',
      steps: [
        { type: 'text', text: 'Necesito dos aprobaciones.' },
        { type: 'permission', permission: 'bash', patterns: ['echo primero'], metadata: { command: 'echo primero' } }
      ]
    })
    await send(a, 'dos permisos')
    await expectCount(card(a), 1)
    // Una segunda petición llega mientras la primera sigue pendiente: se añade al final (key=id). No es resoluble
    // por el falso (no vive en state.permissions), solo sirve para comprobar el reparto de foco al resolver la primera.
    const status = (await fake.status()) as { pendingPermissions: Array<{ sessionID: string }> }
    const sessionID = status.pendingPermissions[0]?.sessionID
    expect(sessionID).toBeTruthy()
    await fake.emit({
      type: 'permission.asked',
      directory: res.path,
      properties: { id: 'per_ghost_nd', sessionID, permission: 'bash', patterns: ['echo segundo'], metadata: { command: 'echo segundo' }, always: [] }
    })
    await expectCount(card(a), 2)

    // Resolver la primera: el foco pasa al contenedor de la segunda, nunca a un botón Permitir.
    await card(a).first().focus()
    await expect.poll(() => once(a).isEnabled(), { timeout: 5_000 }).toBe(true)
    await a.page.keyboard.press(CONFIRM)
    await expectCount(card(a), 1)
    const next = card(a).first()
    await expect.poll(() => next.evaluate((el) => el === document.activeElement), { timeout: 5_000 }).toBe(true)
    expect(await next.getAttribute('role')).toBe('alertdialog')
  })

  it('tarjeta de permiso sin violaciones axe', async () => {
    const a = app()
    await ask(a, 'npm test', 'tarea permiso axe')
    await clean(a.page, 'tareas:permiso')
  })
})
