// Aviso «Rutinas y los términos de OpenCode»: con `routinesTermsAcknowledged: false` activar una rutina pide el
// reconocimiento (Cancelar no activa; «Entiendo, activar rutinas» lo guarda en settings.json y continúa).
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODE_LABELS } from '../../src/shared/labels'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { expectCount, expectVisible } from '../lib/wait'

const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-rtos-')))
const routine = (id: string, name: string, enabled: boolean): Record<string, unknown> => ({
  id,
  name,
  prompt: 'no hacer nada',
  mode: 'chat',
  folder: null,
  model: { providerID: 'fake', modelID: 'fake-model' },
  schedule: { kind: 'daily', time: '09:00' },
  enabled,
  createdAt: Date.now(),
  updatedAt: Date.now()
})
writeFileSync(
  join(userData, 'routines.json'),
  JSON.stringify({ routines: [routine('r-on', 'Rutina activa e2e', true), routine('r-off', 'Rutina pausada e2e', false)], history: [] })
)

const settingsAck = (): unknown =>
  (JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown>).routinesTermsAcknowledged
const persistedEnabled = (id: string): boolean | undefined => {
  try {
    return (JSON.parse(readFileSync(join(userData, 'routines.json'), 'utf8')).routines as { id: string; enabled: boolean }[]).find(
      (r) => r.id === id
    )?.enabled
  } catch {
    return undefined
  }
}

describe.skipIf(MODE === 'prod')(`aviso de Rutinas y términos de OpenCode (${MODE})`, () => {
  const app = useApp({ userData, settings: { routinesTermsAcknowledged: false } })

  it('activar una rutina muestra el diálogo, Cancelar no activa y «Entiendo, activar rutinas» guarda el ajuste y activa', async () => {
    const a = app()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: MODE_LABELS.routines }).click()
    const notice = a.page.getByTestId('routines-terms-notice')
    // Rutina activa sin reconocimiento: aviso no bloqueante arriba.
    await expectVisible(notice)
    await expectVisible(notice.getByText('Tus rutinas no se ejecutan solas hasta que aceptes el aviso sobre los términos de OpenCode'))
    expect(settingsAck()).toBe(false)

    const card = a.page.getByRole('button', { name: /Rutina pausada e2e/ }).first()
    const sw = card.getByRole('switch')
    expect(await sw.getAttribute('aria-checked')).toBe('false')

    const dlg = a.page.getByRole('alertdialog', { name: 'Rutinas y los términos de OpenCode' })
    await sw.click()
    await expectVisible(dlg)
    await expectVisible(dlg.getByText(/Las rutinas se ejecutan solas, aunque no estés mirando la app\./))
    // Foco por defecto en «Cancelar».
    await expect.poll(() => a.page.evaluate(() => document.activeElement?.textContent)).toBe('Cancelar')

    await dlg.getByRole('button', { name: 'Cancelar' }).click()
    await expectCount(dlg, 0)
    expect(await sw.getAttribute('aria-checked')).toBe('false')
    expect(persistedEnabled('r-off')).toBe(false)
    expect(settingsAck()).toBe(false)

    // Enter con el foco en «Cancelar» también cancela.
    await sw.click()
    await expectVisible(dlg)
    await a.page.keyboard.press('Enter')
    await expectCount(dlg, 0)
    expect(settingsAck()).toBe(false)

    // El aviso de la vista abre el mismo diálogo; aceptar guarda el ajuste.
    await notice.getByRole('button', { name: 'Ver aviso y activar' }).click()
    await expectVisible(dlg)
    await dlg.getByRole('button', { name: 'Entiendo, activar rutinas' }).click()
    await expectCount(dlg, 0)
    await expect.poll(settingsAck, { timeout: 10_000 }).toBe(true)
    await expectCount(notice, 0)

    // Ya reconocido: activar no vuelve a preguntar.
    await sw.click()
    await expect.poll(() => persistedEnabled('r-off'), { timeout: 10_000 }).toBe(true)
    await expectCount(dlg, 0)
  })
})
