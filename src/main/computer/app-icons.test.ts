import { describe, expect, it, vi } from 'vitest'
import { isSafeIconDataUrl } from '@shared/app-icon'
import { createAppIconResolver } from './app-icons'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

describe('isSafeIconDataUrl', () => {
  it('solo acepta el prefijo exacto de PNG en base64 y respeta el tope', () => {
    expect(isSafeIconDataUrl(PNG)).toBe(true)
    expect(isSafeIconDataUrl('data:image/png;base64,')).toBe(false)
    expect(isSafeIconDataUrl('data:image/jpeg;base64,AAAA')).toBe(false)
    expect(isSafeIconDataUrl('data:image/png;base64,AA"AA')).toBe(false)
    expect(isSafeIconDataUrl(`data:image/png;base64,${'A'.repeat(24 * 1024)}`)).toBe(false)
    expect(isSafeIconDataUrl(42)).toBe(false)
  })
})

describe('createAppIconResolver', () => {
  const mac = (over: Partial<Parameters<typeof createAppIconResolver>[0]> = {}) => {
    const findMacAppPath = vi.fn(async () => '/Applications/Spotify.app')
    const fileIconDataUrl = vi.fn(async () => PNG)
    const resolve = createAppIconResolver({ platform: 'darwin', findMacAppPath, fileIconDataUrl, ...over })
    return { resolve, findMacAppPath, fileIconDataUrl }
  }

  it('macOS: bundleId válido → ruta de la .app → icono', async () => {
    const { resolve, findMacAppPath, fileIconDataUrl } = mac()
    expect(await resolve('com.spotify.client')).toBe(PNG)
    expect(findMacAppPath).toHaveBeenCalledWith('com.spotify.client')
    expect(fileIconDataUrl).toHaveBeenCalledWith('/Applications/Spotify.app')
  })

  it('bundleId inválido (comillas, espacios, rutas, vacío) ⇒ sin icono y sin ejecutar nada', async () => {
    const { resolve, findMacAppPath } = mac()
    for (const bad of ['', 'a" || kMDItemKind == "x', 'com.x y', '../../etc', '-rf', 'a'.repeat(200)]) {
      expect(await resolve(bad)).toBeUndefined()
    }
    expect(findMacAppPath).not.toHaveBeenCalled()
  })

  it('icono que no cumple el tope o el formato, o cualquier fallo ⇒ sin icono', async () => {
    expect(await mac({ fileIconDataUrl: async () => `data:image/png;base64,${'A'.repeat(30_000)}` }).resolve('com.a.b')).toBeUndefined()
    expect(await mac({ fileIconDataUrl: async () => 'javascript:alert(1)' }).resolve('com.a.b')).toBeUndefined()
    expect(await mac({ findMacAppPath: async () => null }).resolve('com.a.b')).toBeUndefined()
    expect(
      await mac({
        findMacAppPath: async () => {
          throw new Error('boom')
        }
      }).resolve('com.a.b')
    ).toBeUndefined()
  })

  it('cache por bundleId (también de los fallos) y con tope de entradas', async () => {
    const { resolve, findMacAppPath } = mac()
    await resolve('com.a.b')
    await resolve('com.a.b')
    expect(findMacAppPath).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 100; i++) await resolve(`com.app.n${i}`)
    await resolve('com.a.b') // ya se expulsó del cache
    expect(findMacAppPath).toHaveBeenCalledTimes(102)
  })

  it('Windows: usa la ruta del exe de la clave de la app; UWP (aumid) y claves raras ⇒ sin icono', async () => {
    const { resolve, fileIconDataUrl, findMacAppPath } = mac({ platform: 'win32' })
    expect(await resolve('exe:c:\\program files\\spotify\\spotify.exe|pub:Spotify AB')).toBe(PNG)
    expect(fileIconDataUrl).toHaveBeenCalledWith('c:\\program files\\spotify\\spotify.exe')
    expect(await resolve('aumid:microsoft.windowsnotepad_8wekyb3d8bbwe!app')).toBeUndefined()
    expect(await resolve('exe:\\\\server\\share\\x.exe|pub:(sin firma)')).toBeUndefined()
    expect(findMacAppPath).not.toHaveBeenCalled()
  })
})
