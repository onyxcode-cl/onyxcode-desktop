import { afterEach, describe, expect, it } from 'vitest'
import { DICTIONARIES, platformKey, setI18nPlatform, t, translate } from './index'

afterEach(() => setI18nPlatform(''))

describe('variantes de texto por plataforma', () => {
  it('sin plataforma o en macOS no cambia nada', () => {
    expect(translate('es', 'code.menu.reveal')).toBe('Mostrar en Finder')
    setI18nPlatform('darwin')
    expect(translate('en', 'code.menu.reveal')).toBe('Show in Finder')
  })
  it('en win32 usa la variante .win si existe, en es y en en', () => {
    setI18nPlatform('win32')
    expect(translate('es', 'code.menu.reveal')).toBe('Mostrar en el Explorador')
    expect(translate('en', 'code.menu.reveal')).toBe('Show in File Explorer')
    expect(t('labels.ui.computer')).toBe('Control del PC')
  })
  it('en win32 una clave sin variante queda igual', () => {
    setI18nPlatform('win32')
    expect(translate('es', 'code.sessions.loading')).toBe('Cargando sesiones…')
  })
  it('cada clave .win existe en es y en en, y su base también', () => {
    for (const key of Object.keys(DICTIONARIES.es).filter((k) => k.endsWith('.win'))) {
      expect(DICTIONARIES.en[key], key).toBeDefined()
      expect(DICTIONARIES.es[key.slice(0, -4)], `base de ${key}`).toBeDefined()
    }
  })
  it('los avisos de funciones no disponibles existen en los dos idiomas', () => {
    for (const k of ['tasks', 'computer', 'update', 'routine', 'title', 'routineBadge']) {
      expect(platformKey(`platform.win.unavailable.${k}`, 'win32')).toBe(`platform.win.unavailable.${k}`)
      expect(DICTIONARIES.en[`platform.win.unavailable.${k}`]).toBeDefined()
    }
  })
})
