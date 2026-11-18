/** Estado y consentimiento en Electron real. Nunca acepta la descarga ni usa datos personales. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { expectVisible } from '../lib/wait'

describe.skipIf(MODE !== 'dev')('Piezas de video en Ajustes', () => {
  const app = useApp()
  it('muestra tamaño y procedencia, y cancelar el aviso no descarga', async () => {
    const { page, userData } = app()
    const state = await page.evaluate(async () => window.api.tasks.invoke('video:status'))
    expect(state.ok).toBe(true)
    if (!state.ok || !state.data.offered) return
    expect(state.data.ready).toBe(false)
    expect(existsSync(join(userData, 'video'))).toBe(false)
    await page.keyboard.press('ControlOrMeta+,')
    const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
    await expectVisible(nav)
    await nav.getByRole('button', { name: 'Overdrive', exact: true }).click()
    await expectVisible(page.getByTestId('video-card'))
    await page.getByRole('button', { name: /^Instalar piezas de video/ }).click()
    const dialog = page.getByRole('alertdialog')
    await expectVisible(dialog)
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    expect(existsSync(join(userData, 'video'))).toBe(false)
  })
})
