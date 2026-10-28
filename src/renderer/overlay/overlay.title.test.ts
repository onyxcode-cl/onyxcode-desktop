// @vitest-environment jsdom
/** Título de la ventana del overlay de control: «Control del Mac» en macOS y «Control del PC» en Windows (clave `.win`). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())

async function loadTitle(platform: 'win32' | 'darwin', lang = 'es'): Promise<string> {
  vi.resetModules()
  window.history.replaceState({}, '', `/?lang=${lang}`)
  document.title = ''
  document.body.innerHTML = '<div id="root"></div>'
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  })) as never
  ;(window as unknown as { api: unknown }).api = { platform, tasks: { invoke: vi.fn(), on: () => () => undefined } }
  const i18n = await import('@shared/i18n')
  i18n.setI18nPlatform(platform)
  await import('./overlay')
  return document.title
}

describe('título del overlay', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined))
  afterEach(() => vi.restoreAllMocks())

  it('Windows: «Control del PC» (y en inglés «PC control»)', async () => {
    expect(await loadTitle('win32')).toBe('Control del PC')
    expect(await loadTitle('win32', 'en')).toBe('PC control')
  })
  it('macOS: «Control del Mac» (no cambia)', async () => {
    expect(await loadTitle('darwin')).toBe('Control del Mac')
    expect(await loadTitle('darwin', 'en')).toBe('Mac control')
  })
})
