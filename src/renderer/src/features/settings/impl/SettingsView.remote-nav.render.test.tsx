/**
 * Ajustes › navegación: la sección «Celular» (control remoto) solo se ofrece donde la función existe. En Windows sigue apagada
 * (bandera `remoteWin`, docs/REMOTO-WINDOWS.md), así que no debe aparecer; en macOS no cambia nada.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { setI18nPlatform } from '@shared/i18n'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { SettingsView } from './SettingsView'

const setApi = (platform: string, capsFlags?: Record<string, boolean>): void => {
  ;(globalThis as { window?: unknown }).window = { api: { platform, ...(capsFlags ? { capsFlags } : {}) } }
  setI18nPlatform(platform)
}
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  setI18nPlatform('darwin')
})

describe('Ajustes: sección Celular', () => {
  it('macOS: aparece en el menú lateral', () => {
    setApi('darwin')
    expect(renderToStaticMarkup(<SettingsView />)).toContain('Celular')
  })

  it('Windows sin la bandera remoteWin: no aparece (aunque Tareas o Control del PC estén encendidos)', () => {
    setApi('win32', { tasksWin: true, computerWin: true })
    expect(renderToStaticMarkup(<SettingsView />)).not.toContain('Celular')
    setApi('win32')
    expect(renderToStaticMarkup(<SettingsView />)).not.toContain('Celular')
  })

  it('Windows con remoteWin: aparece', () => {
    setApi('win32', { remoteWin: true })
    expect(renderToStaticMarkup(<SettingsView />)).toContain('Celular')
  })
})
