import { describe, expect, it, vi } from 'vitest'
import type { SafeStorageLike } from './devices-store'
import { KeyboxSafeStorage, makeKeyboxFetcher } from './keybox-storage'

/** `safeStorage` de prueba: invierte los bytes y antepone «v10» como el de Electron. */
function legacy(available = true): SafeStorageLike & { enc: ReturnType<typeof vi.fn>; dec: ReturnType<typeof vi.fn> } {
  const enc = vi.fn((s: string) => Buffer.concat([Buffer.from('v10'), Buffer.from(Buffer.from(s, 'utf8').reverse())]))
  const dec = vi.fn((b: Buffer) => Buffer.from(b.subarray(3)).reverse().toString('utf8'))
  return { isEncryptionAvailable: () => available, encryptString: enc, decryptString: dec, enc, dec }
}
const KEY = Buffer.alloc(32, 7)

describe('KeyboxSafeStorage', () => {
  it('cifra y descifra con la llave del auxiliar (AES-256-GCM) sin tocar el respaldo', () => {
    const fb = legacy()
    const s = new KeyboxSafeStorage(() => KEY, fb)
    const enc = s.encryptString('{"secreto":"hola"}')
    expect(enc.subarray(0, 5).toString('latin1')).toBe('LZXK\x01')
    expect(enc.includes(Buffer.from('hola'))).toBe(false)
    expect(s.decryptString(enc)).toBe('{"secreto":"hola"}')
    expect(fb.enc).not.toHaveBeenCalled()
    expect(fb.dec).not.toHaveBeenCalled()
  })

  it('cada cifrado usa un nonce distinto', () => {
    const s = new KeyboxSafeStorage(() => KEY, legacy())
    expect(s.encryptString('x').equals(s.encryptString('x'))).toBe(false)
  })

  it('un archivo alterado no se descifra (la etiqueta lo detecta)', () => {
    const s = new KeyboxSafeStorage(() => KEY, legacy())
    const enc = s.encryptString('dato')
    enc[enc.length - 1] ^= 0xff
    expect(() => s.decryptString(enc)).toThrow()
  })

  it('con otra llave no se descifra', () => {
    const a = new KeyboxSafeStorage(() => KEY, legacy())
    const b = new KeyboxSafeStorage(() => Buffer.alloc(32, 9), legacy())
    expect(() => b.decryptString(a.encryptString('dato'))).toThrow()
  })

  it('lo que cifró safeStorage (formato anterior) se descifra con él: migración sin perder nada', () => {
    const fb = legacy()
    const old = fb.encryptString('viejo')
    const s = new KeyboxSafeStorage(() => KEY, fb)
    expect(s.decryptString(old)).toBe('viejo')
    expect(fb.dec).toHaveBeenCalledOnce()
  })

  it('sin llave (auxiliar ausente o que rechaza) usa safeStorage para cifrar y para saber si hay cifrado', () => {
    const fb = legacy()
    const s = new KeyboxSafeStorage(() => null, fb)
    expect(s.isEncryptionAvailable()).toBe(true)
    expect(s.encryptString('a').subarray(0, 3).toString()).toBe('v10')
    expect(new KeyboxSafeStorage(() => null, legacy(false)).isEncryptionAvailable()).toBe(false)
  })

  it('un archivo del formato nuevo sin llave NO se intenta descifrar con el respaldo', () => {
    const withKey = new KeyboxSafeStorage(() => KEY, legacy())
    const enc = withKey.encryptString('dato')
    const fb = legacy()
    expect(() => new KeyboxSafeStorage(() => null, fb).decryptString(enc)).toThrow('keybox-unavailable')
    expect(fb.dec).not.toHaveBeenCalled()
  })

  it('consulta al auxiliar una sola vez, y una llave de largo incorrecto cuenta como ausente', () => {
    const fetch = vi.fn(() => KEY)
    const s = new KeyboxSafeStorage(fetch, legacy())
    s.isEncryptionAvailable()
    s.encryptString('a')
    s.encryptString('b')
    expect(fetch).toHaveBeenCalledOnce()
    expect(new KeyboxSafeStorage(() => Buffer.alloc(16), legacy()).encryptString('a').subarray(0, 3).toString()).toBe('v10')
    expect(
      new KeyboxSafeStorage(() => {
        throw new Error('boom')
      }, legacy())
        .encryptString('a')
        .subarray(0, 3)
        .toString()
    ).toBe('v10')
  })
})

describe('makeKeyboxFetcher', () => {
  const b64 = KEY.toString('base64')
  it('devuelve la llave cuando el auxiliar termina bien', () => {
    const run = vi.fn(() => ({ status: 0, stdout: `${b64}\n` }))
    expect(makeKeyboxFetcher('/x/lazunox-keybox', run)()?.equals(KEY)).toBe(true)
    expect(run).toHaveBeenCalledWith('/x/lazunox-keybox', ['key'])
  })
  it('rechazo, salida rara o llave corta → null', () => {
    expect(makeKeyboxFetcher('/x', () => ({ status: 3, stdout: '' }))()).toBeNull()
    expect(makeKeyboxFetcher('/x', () => ({ status: null, stdout: '' }))()).toBeNull()
    expect(makeKeyboxFetcher('/x', () => ({ status: 0, stdout: 'no es base64 de 32 bytes' }))()).toBeNull()
    expect(makeKeyboxFetcher('/x', () => ({ status: 0, stdout: Buffer.alloc(8).toString('base64') }))()).toBeNull()
  })
})
