// Ajustes con la barra de vidrio: pestañas por grupo y secciones del grupo abierto (solo macOS y Windows 11 con vidrio).
// Con «Sólida» (lo que usan los demás specs) Ajustes conserva el menú lateral de siempre.
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'

describe.skipIf(!DEV)('Ajustes con vidrio', () => {
  const app = useApp({ settings: { sidebarGlass: 'glass' } })

  it('abre con pestañas por grupo y llega a Diagnóstico por «Ayuda»', async () => {
    const { page } = app()
    const glass = await page.evaluate(() => document.documentElement.hasAttribute('data-glass'))
    // Sin vidrio disponible en el equipo (p. ej. Windows antiguo) no hay nada que probar.
    if (!glass) return
    await page.keyboard.press('ControlOrMeta+,')
    const nav = page.locator('nav[data-settings-tabs]')
    await expectVisible(nav)
    // Grupo «Aplicación» abierto: se ve General y no se ve Diagnóstico.
    await expectVisible(nav.getByRole('button', { name: 'General', exact: true }))
    expect(await nav.getByRole('button', { name: 'Diagnóstico', exact: true }).count()).toBe(0)
    await nav.getByRole('button', { name: 'Ayuda', exact: true }).click()
    await nav.getByRole('button', { name: 'Diagnóstico', exact: true }).click()
    await expectVisible(page.getByRole('heading', { name: 'Diagnóstico' }))
    expect(await page.locator('[data-settings-layout]').getAttribute('data-settings-layout')).toBe('list')
    // General va en rejilla.
    await nav.getByRole('button', { name: 'Aplicación', exact: true }).click()
    await nav.getByRole('button', { name: 'General', exact: true }).click()
    expect(await page.locator('[data-settings-layout]').getAttribute('data-settings-layout')).toBe('grid')
  })
})
