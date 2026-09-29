import { describe, expect, it } from 'vitest'
import { MODE } from '../lib/launch'
import { useApp } from '../lib/harness'
import { expectAttr, expectCount, expectVisible } from '../lib/wait'

const app = useApp()

const MODES = ['Chat', 'Code', 'Cowork', 'Rutinas'] as const
const SETTINGS = ['General', 'Modelos', 'MCP', 'Cowork', 'Red de Cowork', 'Control del Mac', 'Modo auto', 'Navegador', 'Uso', 'Atajos', 'Acerca de']

describe(`arranque (${MODE})`, () => {
  it('conecta con el OpenCode falso', async () => {
    const { page, fake } = app()
    await expectVisible(page.getByText('Conectado', { exact: true }), 60_000)
    const status = await fake.status()
    expect(status).toBeTruthy()
    expect(await fake.unknownRoutes()).toEqual([])
  })

  it('recorre Chat/Code/Cowork/Rutinas con ⌃Tab sin caer en el ErrorBoundary', async () => {
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
    await page.keyboard.press('Meta+,')
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
