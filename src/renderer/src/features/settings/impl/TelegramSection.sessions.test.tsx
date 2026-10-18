// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyLangPref } from '../../../lib/i18n'
import { TELEGRAM_DEFAULT_STATE, type TelegramState } from '@shared/telegram'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.hoisted(() => vi.fn())
vi.mock('./extras', () => ({ getExtras: () => ({ invoke, on: () => () => undefined }) }))
vi.mock('../../../lib/open-external', () => ({ openExternalUrl: vi.fn() }))

import { TelegramSection } from './TelegramSection'

const linked = (over: Partial<TelegramState> = {}): TelegramState => ({
  ...TELEGRAM_DEFAULT_STATE,
  enabled: true,
  phase: 'linked',
  botConfigured: true,
  botUsername: 'mi_bot',
  ownerLabel: 'Ana',
  ...over
})

let host: HTMLDivElement
let root: Root
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(TelegramSection))
  })
  await flush()
}
const toggle = (label: string): HTMLElement | null =>
  [...host.querySelectorAll('[role="switch"]')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent?.includes(label)
  ) as HTMLElement | null

beforeEach(() => {
  applyLangPref('es')
  invoke.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Ajustes › Telegram: seguir y escribir (entrega 2)', () => {
  it('«Permitir escribir» y «Solo resúmenes» arrancan apagados y avisan lo que implican', async () => {
    invoke.mockResolvedValue(linked())
    await mount()
    const text = host.textContent ?? ''
    expect(text).toContain('Permitir escribir a la sesión desde Telegram')
    expect(text).toContain('Solo resúmenes')
    expect(text).toContain('nunca da permisos')
    expect(text).toContain('Telegram no cifra de extremo a extremo')
    const switches = [...host.querySelectorAll('[role="switch"]')]
    const write = switches.find((s) => s.getAttribute('aria-label') === 'Permitir escribir a la sesión desde Telegram')
    const sums = switches.find((s) => s.getAttribute('aria-label') === 'Solo resúmenes')
    expect(write?.getAttribute('aria-checked')).toBe('false')
    expect(sums?.getAttribute('aria-checked')).toBe('false')
  })

  it('encender «escribir» y «solo resúmenes» llama a main con el valor nuevo', async () => {
    invoke.mockResolvedValue(linked())
    await mount()
    const switches = [...host.querySelectorAll('[role="switch"]')]
    const write = switches.find((s) => s.getAttribute('aria-label') === 'Permitir escribir a la sesión desde Telegram') as HTMLElement
    invoke.mockResolvedValue(linked({ allowWrite: true }))
    await act(async () => write.click())
    await flush()
    expect(invoke).toHaveBeenCalledWith('telegram:setAllowWrite', { enabled: true })
    const sums = [...host.querySelectorAll('[role="switch"]')].find((s) => s.getAttribute('aria-label') === 'Solo resúmenes') as HTMLElement
    invoke.mockResolvedValue(linked({ allowWrite: true, summariesOnly: true }))
    await act(async () => sums.click())
    await flush()
    expect(invoke).toHaveBeenCalledWith('telegram:setSummariesOnly', { enabled: true })
  })

  it('muestra la sesión activa (título y dónde vive) y deja soltarla', async () => {
    invoke.mockResolvedValue(linked({ activeSession: { title: 'Arreglar el login', kind: 'code', folder: 'mi-proyecto' } }))
    await mount()
    const box = host.querySelector('[data-telegram-session]')!
    expect(box.textContent).toContain('Arreglar el login')
    expect(box.textContent).toContain('Code · mi-proyecto')
    const release = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Dejar de seguirla')) as HTMLElement
    invoke.mockResolvedValue(linked())
    await act(async () => release.click())
    await flush()
    expect(invoke).toHaveBeenCalledWith('telegram:releaseSession')
    expect(host.querySelector('[data-telegram-session]')?.textContent).toContain('/sesiones')
  })

  it('sin sesión elegida lo dice y explica cómo elegir; la nota de archivos y de voz está visible', async () => {
    invoke.mockResolvedValue(linked())
    await mount()
    expect(host.querySelector('[data-telegram-session]')?.textContent).toContain('Ninguna')
    expect(host.querySelector('[data-telegram-files-note]')?.textContent).toContain('hasta 50 MB')
    expect(host.querySelector('[data-telegram-files-note]')?.textContent).toContain('notas de voz')
  })

  it('sin chat vinculado no se ofrece escribir ni elegir sesión', async () => {
    invoke.mockResolvedValue({ ...TELEGRAM_DEFAULT_STATE, enabled: true, phase: 'idle', botConfigured: true })
    await mount()
    expect(host.textContent).not.toContain('Permitir escribir a la sesión')
    void toggle
  })

  it('en inglés están los mismos controles', async () => {
    applyLangPref('en')
    invoke.mockResolvedValue(linked())
    await mount()
    expect(host.textContent).toContain('Allow writing to the session from Telegram')
    expect(host.textContent).toContain('Summaries only')
    applyLangPref('es')
  })
})
