// F8-B46: atajos de teclado configurables. Ajustes › Atajos: cambiar un atajo y que funcione, conflicto, combinación reservada,
// desactivar, buscar, restablecer uno y todos; persistencia tras reiniciar con el mismo userData; y los atajos por defecto de
// siempre siguen funcionando (barra lateral, paneles de Code, Shift+Tab en el compositor).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { startApp, type E2EApp } from '../lib/launch'
import { makeGitRepo, openCodeProject } from '../lib/fase6'
import { setMode, storeCall, storeState } from '../lib/stores'
import { expectAttr, expectCount, expectVisible } from '../lib/wait'
import { shot } from '../lib/shots'

const SHOTS = process.env.MY_SHOTS_DIR
const apps: E2EApp[] = []
const dirs: string[] = []

const newDir = (prefix: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}

async function launch(userData: string): Promise<E2EApp> {
  const app = await startApp({ userData, keepUserData: true, settings: { onboarded: true } })
  apps.push(app)
  await setMode(app.page, 'chat')
  return app
}

async function restart(app: E2EApp, userData: string): Promise<E2EApp> {
  await app.stop()
  apps.splice(apps.indexOf(app), 1)
  return launch(userData)
}

const disk = (userData: string): Record<string, string | null> => {
  try {
    return JSON.parse(readFileSync(join(userData, 'extras.json'), 'utf8')).keybindings ?? {}
  } catch {
    return {}
  }
}

async function openShortcuts(page: Page): Promise<void> {
  await storeCall(page, 'useUi', 'openSettings', true)
  const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
  await expectVisible(nav)
  await nav.getByRole('button', { name: 'Atajos', exact: true }).click()
  await expectVisible(page.getByTestId('keybindings-list'))
}

const row = (page: Page, id: string): ReturnType<Page['locator']> => page.locator(`[data-action="${id}"]`)
const bindingOf = async (page: Page, id: string): Promise<string | null> => {
  const el = row(page, id).locator('[data-binding]')
  return (await el.count()) === 0 ? null : el.first().getAttribute('data-binding')
}
const rec = (page: Page, action: string): ReturnType<Page['getByRole']> =>
  page.getByRole('button', { name: `Cambiar el atajo de «${action}»` })
const mode = (page: Page): Promise<string> => storeState<string>(page, 'useUi', 'mode')

/** Graba un atajo: pulsa «cambiar», espera el estado de grabación y pulsa la combinación. */
async function record(page: Page, action: string, combo: string): Promise<void> {
  await rec(page, action).click()
  await expectAttr(rec(page, action), 'aria-pressed', 'true')
  await page.keyboard.press(combo)
}

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
})
afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('atajos configurables', () => {
  const userData = newDir('onyx-e2e-atajos-')
  let app: E2EApp

  it('Ajustes › Atajos: lista agrupada con los atajos por defecto y buscador', async () => {
    app = await launch(userData)
    const { page } = app
    await openShortcuts(page)
    expect(await bindingOf(page, 'palette.toggle')).toBe('Mod+K')
    expect(await bindingOf(page, 'conversation.new')).toBe('Mod+N')
    expect(await bindingOf(page, 'mode.code')).toBeNull() // sin atajo por defecto: «Desactivado»
    for (const cat of ['Navegación', 'Conversación', 'Code', 'Ventana']) await expectVisible(page.getByRole('heading', { name: cat }))
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await shot(app, SHOTS, 'atajos-lista')
    }
    await page.getByRole('searchbox', { name: 'Buscar un atajo…' }).fill('termin')
    await expectCount(page.locator('[data-action]'), 1)
    await expectVisible(row(page, 'code.panel.terminal'))
    await page.getByRole('searchbox', { name: 'Buscar un atajo…' }).fill('zzz')
    await expectVisible(page.getByText('Ningún atajo coincide con la búsqueda.'))
    await page.getByRole('searchbox', { name: 'Buscar un atajo…' }).fill('')
  })

  it('cambiar un atajo (Ir a Code → ⌘⌥2): se graba normalizado, funciona y se guarda', async () => {
    const { page } = app
    await record(page, 'Ir a Code', 'ControlOrMeta+Alt+2')
    await expect.poll(() => bindingOf(page, 'mode.code')).toBe('Mod+Alt+2')
    await expect.poll(() => disk(userData)['mode.code']).toBe('Mod+Alt+2')
    await expectVisible(page.getByText('Personalizado').first())
    await storeCall(page, 'useUi', 'openSettings', false)
    await setMode(page, 'chat')
    await page.keyboard.press('ControlOrMeta+Alt+2')
    await expect.poll(() => mode(page)).toBe('code')
  })

  it('los atajos de siempre siguen igual: ⌘\\ barra lateral, ⌘2 terminal y Shift+Tab en el compositor', async () => {
    const { page } = app
    const before = await storeState<boolean>(page, 'useUi', 'sidebarCollapsed')
    await page.keyboard.press('ControlOrMeta+\\')
    await expect.poll(() => storeState<boolean>(page, 'useUi', 'sidebarCollapsed')).toBe(!before)
    await page.keyboard.press('ControlOrMeta+\\')
    await expect.poll(() => storeState<boolean>(page, 'useUi', 'sidebarCollapsed')).toBe(before)

    const repo = makeGitRepo()
    dirs.push(repo)
    await openCodeProject(app, repo)
    await page.keyboard.press('ControlOrMeta+2')
    await expect.poll(() => storeState<string | null>(page, 'useCode', 'panel')).toBe('terminal')
    await page.keyboard.press('ControlOrMeta+2')
    await expect.poll(() => storeState<string | null>(page, 'useCode', 'panel')).toBeNull()

    const agent0 = await storeState<string>(page, 'useCode', 'agent')
    await page.locator('textarea[data-code-composer]').click()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => storeState<string>(page, 'useCode', 'agent')).toBe(agent0 === 'plan' ? 'build' : 'plan')
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => storeState<string>(page, 'useCode', 'agent')).toBe(agent0)
    // Fuera del compositor, Shift+Tab es navegación del foco: no cambia Plan/Build.
    await page.locator('body').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(300)
    expect(await storeState<string>(page, 'useCode', 'agent')).toBe(agent0)
  })

  it('Plan/Build con atajo propio (⌘⌥B) desde cualquier sitio de Code', async () => {
    const { page } = app
    await openShortcuts(page)
    await record(page, 'Alternar Plan / Build', 'ControlOrMeta+Alt+B')
    await expect.poll(() => disk(userData)['code.togglePlanBuild']).toBe('Mod+Alt+B')
    await storeCall(page, 'useUi', 'openSettings', false)
    await setMode(page, 'code')
    const agent0 = await storeState<string>(page, 'useCode', 'agent')
    await page.locator('body').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('ControlOrMeta+Alt+B')
    await expect.poll(() => storeState<string>(page, 'useCode', 'agent')).toBe(agent0 === 'plan' ? 'build' : 'plan')
    // Con el atajo propio, el de antes (Shift+Tab en el compositor) ya no hace nada.
    await page.locator('textarea[data-code-composer]').click()
    const agent1 = await storeState<string>(page, 'useCode', 'agent')
    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(300)
    expect(await storeState<string>(page, 'useCode', 'agent')).toBe(agent1)
  })

  it('conflicto: ⌘N ya es «Nueva conversación»; cancelar no cambia nada y reasignar lo cede', async () => {
    const { page } = app
    await openShortcuts(page)
    await record(page, 'Ir a Chat', 'ControlOrMeta+N')
    const alert = page.getByTestId('keybinding-conflict')
    await expectVisible(alert)
    expect(await alert.innerText()).toContain('Nueva conversación / sesión / tarea')
    expect(disk(userData)['mode.chat']).toBeUndefined()
    await alert.getByRole('button', { name: 'Cancelar' }).click()
    await expectCount(page.getByTestId('keybinding-conflict'), 0)
    expect(disk(userData)['mode.chat']).toBeUndefined()
    expect(await bindingOf(page, 'conversation.new')).toBe('Mod+N')

    await record(page, 'Ir a Chat', 'ControlOrMeta+N')
    await expectVisible(page.getByTestId('keybinding-conflict'))
    if (SHOTS) await shot(app, SHOTS, 'atajos-conflicto')
    await page.getByTestId('keybinding-conflict').getByRole('button', { name: 'Reasignar' }).click()
    await expect.poll(() => disk(userData)['mode.chat']).toBe('Mod+N')
    expect(disk(userData)['conversation.new']).toBeNull()
    await expect.poll(() => bindingOf(page, 'mode.chat')).toBe('Mod+N')
    expect(await bindingOf(page, 'conversation.new')).toBeNull()
    // Funciona: desde Code, ⌘N ahora va a Chat (ya no crea una sesión).
    await storeCall(page, 'useUi', 'openSettings', false)
    await setMode(page, 'code')
    await page.keyboard.press('ControlOrMeta+N')
    await expect.poll(() => mode(page)).toBe('chat')
  })

  it('combinaciones reservadas del sistema/edición se rechazan con aviso; sin modificador también', async () => {
    const { page } = app
    await openShortcuts(page)
    await record(page, 'Ir a Tareas', 'ControlOrMeta+C')
    await expectVisible(page.getByText(/se usa para copiar, pegar o deshacer y no se puede asignar/))
    expect(disk(userData)['mode.tasks']).toBeUndefined()
    await page.keyboard.press('K')
    await expectVisible(page.getByText(/Usa al menos un modificador/))
    expect(disk(userData)['mode.tasks']).toBeUndefined()
    await page.keyboard.press('Escape') // cancela la grabación
    await expectAttr(rec(page, 'Ir a Tareas'), 'aria-pressed', 'false')
    expect(await mode(page)).toBe('chat') // Esc no cerró Ajustes por el camino
    await expectVisible(page.getByTestId('keybindings-list'))
  })

  it('desactivar un atajo: la paleta de ⌘⇧P deja de abrirse; ⌘K sigue', async () => {
    const { page } = app
    await page.getByRole('button', { name: 'Desactivar «Paleta de comandos (también en Code)»' }).click()
    await expect.poll(() => disk(userData)['palette.alt']).toBeNull()
    expect(await bindingOf(page, 'palette.alt')).toBeNull()
    await storeCall(page, 'useUi', 'openSettings', false)
    await page.keyboard.press('ControlOrMeta+Shift+P')
    await page.waitForTimeout(400)
    expect(await storeState<boolean>(page, 'useUi', 'paletteOpen')).toBe(false)
    await page.keyboard.press('ControlOrMeta+K')
    await expect.poll(() => storeState<boolean>(page, 'useUi', 'paletteOpen')).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => storeState<boolean>(page, 'useUi', 'paletteOpen')).toBe(false)
  })

  it('persiste tras reiniciar con el mismo userData y sigue funcionando', async () => {
    app = await restart(app, userData)
    const { page } = app
    expect(disk(userData)).toMatchObject({ 'mode.code': 'Mod+Alt+2', 'mode.chat': 'Mod+N', 'conversation.new': null, 'palette.alt': null })
    await openShortcuts(page)
    await expect.poll(() => bindingOf(page, 'mode.code')).toBe('Mod+Alt+2')
    await expect.poll(() => bindingOf(page, 'conversation.new')).toBeNull()
    await storeCall(page, 'useUi', 'openSettings', false)
    await setMode(page, 'chat')
    await page.keyboard.press('ControlOrMeta+Alt+2')
    await expect.poll(() => mode(page)).toBe('code')
    await page.keyboard.press('ControlOrMeta+N')
    await expect.poll(() => mode(page)).toBe('chat')
  })

  it('restablecer uno y luego todos', async () => {
    const { page } = app
    await openShortcuts(page)
    await page.getByRole('button', { name: 'Restablecer «Ir a Code»' }).click()
    await expect.poll(() => 'mode.code' in disk(userData)).toBe(false)
    expect(await bindingOf(page, 'mode.code')).toBeNull()
    await page.getByRole('button', { name: 'Restablecer todos' }).click()
    await expect.poll(() => Object.keys(disk(userData)).length).toBe(0)
    await expect.poll(() => bindingOf(page, 'conversation.new')).toBe('Mod+N')
    await expect.poll(() => bindingOf(page, 'palette.alt')).toBe('Mod+Shift+P')
    await expect.poll(() => page.getByRole('button', { name: 'Restablecer todos' }).isDisabled()).toBe(true)
    await storeCall(page, 'useUi', 'openSettings', false)
    await setMode(page, 'chat')
    await page.keyboard.press('ControlOrMeta+Shift+P')
    await expect.poll(() => storeState<boolean>(page, 'useUi', 'paletteOpen')).toBe(true)
    await page.keyboard.press('Escape')
  })
})
