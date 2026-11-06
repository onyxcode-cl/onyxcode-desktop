import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setI18nPlatform, setLang, translate } from '@shared/i18n'
import { capsFor } from '@shared/platform-caps'
import { applyHostPlatform, HOST_PLATFORM_KEY, readCachedHostPlatform, syncHostPlatform } from './host-platform'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0
  } as Storage
}

const phone = (): string => translate('es', 'mobile.phone.connection')

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
  setLang('es')
  setI18nPlatform('remote')
})
afterEach(() => {
  vi.unstubAllGlobals()
  setI18nPlatform('')
})

describe('textos de la PWA según el sistema del equipo (W2)', () => {
  it('con hostPlatform win32 usa las variantes .win («PC»), en es y en en', () => {
    expect(applyHostPlatform('win32')).toBe(true)
    expect(phone()).toBe('Conexión con tu PC')
    expect(translate('es', 'remote.perm.approveOnMac')).toBe('Apruébalo en el PC')
    expect(translate('es', 'code.m.folderMac')).not.toMatch(/Mac/)
    expect(translate('es', 'remote.unavailable.noSafeStorage')).toContain('almacén seguro de Windows')
    expect(translate('en', 'mobile.banner.offline')).toContain('your PC')
    expect(translate('en', 'mobile.settings.connectionTitle')).toBe('Your PC')
  })

  it('sin el campo (un Mac viejo) o con darwin queda igual que hoy', () => {
    expect(applyHostPlatform(undefined)).toBe(false)
    expect(phone()).toBe('Conexión con tu Mac')
    expect(applyHostPlatform('win32')).toBe(true)
    expect(applyHostPlatform(undefined)).toBe(true)
    expect(phone()).toBe('Conexión con tu Mac')
    expect(applyHostPlatform('darwin')).toBe(false)
    expect(translate('es', 'remote.link.denied')).toBe('Rechazada en el Mac.')
  })

  it('solo cambia los textos: las capacidades siguen siendo las de la superficie remota', () => {
    const before = capsFor('remote', {})
    applyHostPlatform('win32')
    expect(capsFor('remote', {})).toEqual(before)
    expect(before).not.toEqual(capsFor('win32', {}))
  })

  it('syncHostPlatform lee app:info, recuerda el sistema y avisa para repintar', async () => {
    const onChanged = vi.fn()
    const ok = await syncHostPlatform(async () => ({ ok: true, data: { platform: 'win32', hostPlatform: 'win32' } }), onChanged)
    expect(ok).toBe(true)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(readCachedHostPlatform()).toBe('win32')
    expect(phone()).toBe('Conexión con tu PC')
  })

  it('un Mac viejo (sin hostPlatform) borra lo recordado y vuelve a los textos de siempre', async () => {
    localStorage.setItem(HOST_PLATFORM_KEY, 'win32')
    applyHostPlatform(readCachedHostPlatform())
    const onChanged = vi.fn()
    expect(await syncHostPlatform(async () => ({ ok: true, data: { platform: 'darwin' } }), onChanged)).toBe(true)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(readCachedHostPlatform()).toBeUndefined()
    expect(phone()).toBe('Conexión con tu Mac')
  })

  it('si la lectura falla no cambia nada y avisa que hay que reintentar', async () => {
    const onChanged = vi.fn()
    expect(await syncHostPlatform(async () => ({ ok: false }), onChanged)).toBe(false)
    expect(await syncHostPlatform(async () => Promise.reject(new Error('x')), onChanged)).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()
    expect(phone()).toBe('Conexión con tu Mac')
  })

  it('un valor desconocido (basura) se ignora', async () => {
    await syncHostPlatform(
      async () => ({ ok: true, data: { hostPlatform: 'linux' } }),
      () => undefined
    )
    expect(readCachedHostPlatform()).toBeUndefined()
    expect(phone()).toBe('Conexión con tu Mac')
  })
})
