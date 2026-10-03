import { describe, expect, it } from 'vitest'
import { installInsecureContextShims, legacyCopy, uuidV4 } from './insecure-shims'

describe('uuidV4', () => {
  it('formato v4 válido y distinto cada vez', () => {
    const rnd = (a: Uint8Array): Uint8Array => globalThis.crypto.getRandomValues(a)
    const a = uuidV4(rnd)
    const b = uuidV4(rnd)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
  it('con bytes fijos fija versión y variante', () => {
    expect(uuidV4((a) => a.fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(uuidV4((a) => a.fill(0))).toBe('00000000-0000-4000-8000-000000000000')
  })
})

function fakeWin(opts: { randomUUID?: boolean; clipboard?: boolean; copyOk?: boolean }): Window & typeof globalThis {
  const copied: string[] = []
  const body = { append: (el: { value: string }) => void copied.push(el.value) }
  const doc = {
    createElement: () => {
      const el = {
        value: '',
        style: {} as Record<string, string>,
        setAttribute: () => undefined,
        select: () => undefined,
        setSelectionRange: () => undefined,
        remove: () => undefined
      }
      return el
    },
    body,
    activeElement: null,
    execCommand: () => opts.copyOk !== false
  }
  const crypto: Record<string, unknown> = { getRandomValues: (a: Uint8Array) => globalThis.crypto.getRandomValues(a) }
  if (opts.randomUUID) crypto.randomUUID = () => 'nativo'
  const navigator: Record<string, unknown> = {}
  if (opts.clipboard) navigator.clipboard = { writeText: () => Promise.resolve() }
  return { crypto, navigator, document: doc } as unknown as Window & typeof globalThis
}

describe('installInsecureContextShims', () => {
  it('sin randomUUID ni clipboard (HTTP en IP local) los instala', async () => {
    const w = fakeWin({})
    installInsecureContextShims(w)
    expect((w.crypto as Crypto).randomUUID()).toMatch(/^[0-9a-f-]{36}$/)
    await expect(w.navigator.clipboard.writeText('hola')).resolves.toBeUndefined()
    await expect(w.navigator.clipboard.readText()).rejects.toThrow()
  })
  it('si el copiado clásico falla, writeText rechaza (el botón muestra su error)', async () => {
    const w = fakeWin({ copyOk: false })
    installInsecureContextShims(w)
    await expect(w.navigator.clipboard.writeText('x')).rejects.toThrow()
  })
  it('en un contexto seguro no toca lo nativo', () => {
    const w = fakeWin({ randomUUID: true, clipboard: true })
    const before = w.navigator.clipboard
    installInsecureContextShims(w)
    expect((w.crypto as Crypto).randomUUID()).toBe('nativo')
    expect(w.navigator.clipboard).toBe(before)
  })
  it('legacyCopy devuelve false si execCommand lanza', () => {
    const w = fakeWin({})
    ;(w.document as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('no')
    }
    expect(legacyCopy(w.document, 'x')).toBe(false)
  })
})
