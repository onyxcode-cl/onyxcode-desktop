/**
 * Ajustes › Control del PC según la plataforma (C5): en Windows con las banderas encendidas aparece el bloque de Windows y los
 * textos hablan del PC; en macOS no cambia nada (ni «Estado en este PC» ni el consentimiento de la app).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { setI18nPlatform } from '@shared/i18n'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { ComputerSection } from './ComputerSection'

const setWin = (flags: Record<string, boolean>): void => {
  ;(globalThis as { window?: unknown }).window = { api: { platform: 'win32', capsFlags: flags } }
  setI18nPlatform('win32')
}
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  setI18nPlatform('darwin')
})

describe('ComputerSection', () => {
  it('Windows con Control del PC: título y textos del PC, estado en este PC y registro; ningún símbolo ni nombre del Mac', () => {
    setWin({ tasksWin: true, computerWin: true })
    const html = renderToStaticMarkup(<ComputerSection />)
    expect(html).toContain('Control del PC')
    expect(html).toContain('Estado en este PC')
    expect(html).toContain('Registro de acciones')
    expect(html).toContain('Ver registro')
    expect(html).toContain('UI Automation')
    expect(html).not.toMatch(/[⌘⌥⌃]|\bMac\b|Finder|Spotlight/)
  })

  it('macOS: igual que siempre, sin el bloque de Windows', () => {
    ;(globalThis as { window?: unknown }).window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<ComputerSection />)
    expect(html).toContain('Control del Mac')
    expect(html).not.toContain('Estado en este PC')
    expect(html).not.toContain('Registro de acciones')
  })
})
