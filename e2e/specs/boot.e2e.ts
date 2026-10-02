import { describe, expect, it } from 'vitest'
import { MODE } from '../lib/launch'
import { useApp } from '../lib/harness'
import { MODE_LABELS, UI_LABELS } from '../../src/shared/labels'
import { expectAttr, expectCount, expectVisible } from '../lib/wait'
import { IS_WIN } from '../lib/proc'

const app = useApp()

// Windows v1: sin modo Tareas ni sus ajustes (Tareas, Red, Control del PC, Modo automático) ni Actualizaciones.
const MODES = (IS_WIN ? [MODE_LABELS.chat, MODE_LABELS.code, MODE_LABELS.routines] : [MODE_LABELS.chat, MODE_LABELS.code, MODE_LABELS.tasks, MODE_LABELS.routines]) as readonly string[]
const SETTINGS = IS_WIN
  ? ['General', 'Modelos', 'MCP', 'Navegador', 'Uso', 'Atajos', 'Diagnóstico', 'Acerca de']
  : ['General', 'Modelos', 'MCP', UI_LABELS.tasksMode, UI_LABELS.network, UI_LABELS.computer, UI_LABELS.autoMode, 'Navegador', 'Uso', 'Atajos', 'Diagnóstico', 'Acerca de']

describe(`arranque (${MODE})`, () => {
  it('conecta con el OpenCode falso', async () => {
    const { page, fake } = app()
    await expectVisible(page.getByText('Conectado', { exact: true }), 60_000)
    const status = await fake.status()
    expect(status).toBeTruthy()
    expect(await fake.unknownRoutes()).toEqual([])
  })

  it('recorre Chat/Code/Tareas/Rutinas con ⌃Tab sin caer en el ErrorBoundary', async () => {
    const { page } = app()
    const nav = page.locator('nav[aria-label="Modo"]')
    await page.locator('main').click({ position: { x: 300, y: 300 } }).catch(() => undefined)
    await nav.getByRole('button', { name: 'Chat' }).click()
    for (let i = 0; i < MODES.length; i++) {
      await expectAttr(nav.getByRole('button', { name: MODES[i] }), 'aria-current', 'page')
      await expectCount(page.locator('[role="alert"]'), 0)
      await expectVisible(page.locator('main'))
      await page.keyboard.press('Control+Tab')
    }
    // Vuelta completa: de nuevo en Chat.
    await expectAttr(nav.getByRole('button', { name: 'Chat' }), 'aria-current', 'page')
  })

  it('recorre los modos por clic', async () => {
    const { page } = app()
    const nav = page.locator('nav[aria-label="Modo"]')
    for (const m of [...MODES].reverse()) {
      await nav.getByRole('button', { name: m }).click()
      await expectAttr(nav.getByRole('button', { name: m }), 'aria-current', 'page')
      await page.waitForTimeout(300)
      await expectCount(page.locator('[role="alert"]'), 0)
    }
  })

  it('Ajustes muestra todas sus secciones y cada una renderiza', async () => {
    const { page } = app()
    await page.keyboard.press('ControlOrMeta+,')
    const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
    await expectVisible(nav)
    for (const label of SETTINGS) await expectVisible(nav.getByRole('button', { name: label, exact: true }))
    for (const label of SETTINGS) {
      await nav.getByRole('button', { name: label, exact: true }).click()
      await expectAttr(nav.getByRole('button', { name: label, exact: true }), 'aria-current', 'page')
      await page.waitForTimeout(250)
      await expectCount(page.locator('[role="alert"]'), 0)
    }
    await page.keyboard.press('Escape')
  })
})
