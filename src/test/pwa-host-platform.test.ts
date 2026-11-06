import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en, es, hostWord, localizeHost } from '../../pwa/src/i18n'

describe('pwa-host-platform: texto según el sistema recordado', () => {
  const dicts = { es, en } as const
  const withMac = (d: Record<string, string>): [string, string][] => Object.entries(d).filter(([, v]) => /\bMac\b/.test(v))

  it('hay frases con «Mac» (la prueba no es vacía)', () => {
    expect(withMac(es).length).toBeGreaterThan(20)
    expect(withMac(en).length).toBeGreaterThan(20)
  })

  for (const l of ['es', 'en'] as const) {
    it(`${l}: darwin deja los textos como hoy`, () => {
      for (const [, v] of Object.entries(dicts[l])) expect(localizeHost(v, 'darwin', l)).toBe(v)
    })

    it(`${l}: win32 no deja «Mac» y dice PC`, () => {
      for (const [k, v] of withMac(dicts[l])) {
        const out = localizeHost(v, 'win32', l)
        expect(out, k).not.toMatch(/\bMac\b/)
        expect(out, k).toContain('PC')
      }
    })

    it(`${l}: sin nada recordado (o dato raro) no dice «Mac» ni «PC»`, () => {
      for (const p of [undefined, null, '', 'linux']) {
        for (const [k, v] of Object.entries(dicts[l])) {
          const out = localizeHost(v, p, l)
          expect(out, k).not.toMatch(/\bMac\b/)
          if (!/\bPC\b/.test(v)) expect(out, k).not.toMatch(/\bPC\b/)
        }
      }
    })
  }

  it('palabras', () => {
    expect(hostWord('darwin', 'es')).toBe('Mac')
    expect(hostWord('win32', 'en')).toBe('PC')
    expect(hostWord(undefined, 'es')).toBe('computador')
    expect(hostWord(undefined, 'en')).toBe('computer')
    expect(localizeHost('No pude conectar con tu Mac.', undefined, 'es')).toBe('No pude conectar con tu computador.')
    expect(localizeHost('Confirm on your Mac', 'win32', 'en')).toBe('Confirm on your PC')
  })
})

/** La clave que lee `pwa/src/i18n.ts` debe ser la que guarda la app completa (no se importa: el typecheck de pwa no ve `@shared`). */
describe('pwa-host-platform: clave compartida', () => {
  it('coincide con la de host-platform.ts', () => {
    const key = /HOST_PLATFORM_KEY = '([^']+)'/
    const a = key.exec(readFileSync('src/renderer/remote/host-platform.ts', 'utf8'))?.[1]
    const b = key.exec(readFileSync('pwa/src/i18n.ts', 'utf8'))?.[1]
    expect(a).toBe('lazunox.hostPlatform')
    expect(b).toBe(a)
  })
})
