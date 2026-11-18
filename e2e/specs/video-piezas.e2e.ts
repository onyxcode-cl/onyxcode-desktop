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
    const images = page.getByTestId('video-image-search')
    await expectVisible(images)
    expect(await images.locator('input').getAttribute('type')).toBe('password')
    await images.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expectVisible(images.getByRole('status'))
    const search = await page.evaluate(async () => window.api.tasks.invoke('video:imageSearchStatus'))
    expect(search).toMatchObject({ ok: true, data: { provider: 'serper', configured: { serper: false, brave: false } } })
    await images.getByRole('combobox').selectOption('brave')
    await images.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expectVisible(images.getByRole('status'))
    const changed = await page.evaluate(async () => window.api.tasks.invoke('video:imageSearchStatus'))
    expect(changed).toMatchObject({ ok: true, data: { provider: 'brave' } })
    await page.getByRole('button', { name: /^Instalar piezas de video/ }).click()
    const dialog = page.getByRole('alertdialog')
    await expectVisible(dialog)
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    expect(existsSync(join(userData, 'video'))).toBe(false)
  })
})
