import { describe, expect, it } from 'vitest'
import { entryFromMac } from '../../pwa/src/full'
import { isCloudMode } from '../../pwa/src/mode'
import { iceServersFor } from '../../pwa/src/rtc'
import { clearLegacyCreds, loadLegacyCreds, saveLegacyCreds } from '../../pwa/src/store'
import { CLOUD_ORIGIN, CLOUD_STUN_URL } from '../shared/remote/cloud'

describe('modo de la página', () => {
  it('nube solo en HTTPS y en el origen exacto del sitio', () => {
    expect(isCloudMode(CLOUD_ORIGIN, true)).toBe(true)
    expect(isCloudMode(CLOUD_ORIGIN, false)).toBe(false)
    for (const o of [
      'http://192.168.1.20:5555',
      `${CLOUD_ORIGIN}.evil.com`,
      'https://evil.example',
      CLOUD_ORIGIN.replace('https:', 'http:'),
      `${CLOUD_ORIGIN}:8443`
    ])
      expect(isCloudMode(o, true), o).toBe(false)
  })
})

describe('servidores ICE de la PWA', () => {
  const turn = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }]
  it('red local: ninguno', () => {
    expect(iceServersFor({ kind: 'lan' }, turn)).toEqual([])
  })
  it('nube: STUN siempre y, si el servicio los repartió, también los de relé', () => {
    expect(iceServersFor({ kind: 'cloud', room: 'R'.repeat(43) }, [])).toEqual([{ urls: [CLOUD_STUN_URL] }])
    expect(iceServersFor({ kind: 'cloud', room: 'R'.repeat(43) }, turn)).toEqual([{ urls: [CLOUD_STUN_URL] }, ...turn])
  })
})

describe('entry del Mac -> carga con integrity', () => {
  const sri = (c: string): string => `sha384-${c.repeat(64)}`
  it('separa JS y CSS y conserva el hash de cada archivo', () => {
    const { entry, sri: map } = entryFromMac({
      v: '0.3.0',
      js: 'assets/main-AAA.js',
      files: [
        { p: 'assets/main-AAA.js', sri: sri('A') },
        { p: 'assets/boot-BBB.js', sri: sri('B') },
        { p: 'assets/boot-CCC.css', sri: sri('C') }
      ]
    })
    expect(entry.js).toBe('assets/main-AAA.js')
    expect(entry.css).toEqual(['assets/boot-CCC.css'])
    expect(entry.preload).toEqual(['assets/main-AAA.js', 'assets/boot-BBB.js'])
    expect(map.get('assets/boot-BBB.js')).toBe(sri('B'))
    expect(map.size).toBe(3)
  })
})

describe('almacén de la red local (localStorage de siempre)', () => {
  function fakeStorage() {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k)
    }
  }
  const creds = { id: 'a'.repeat(32), secret: 'S'.repeat(43) }

  it('guarda, lee y borra', () => {
    const st = fakeStorage()
    expect(loadLegacyCreds(st)).toBeNull()
    expect(saveLegacyCreds(creds, st)).toBe(true)
    expect(loadLegacyCreds(st)).toEqual(creds)
    clearLegacyCreds(st)
    expect(loadLegacyCreds(st)).toBeNull()
  })

  it('datos raros o almacenamiento que lanza: sin vínculo, sin romper', () => {
    const bad = { getItem: () => '{"id":"x","secret":"y"}' }
    expect(loadLegacyCreds(bad)).toBeNull()
    expect(loadLegacyCreds({ getItem: () => 'no json' })).toBeNull()
    expect(
      loadLegacyCreds({
        getItem: () => {
          throw new Error('bloqueado')
        }
      })
    ).toBeNull()
    expect(
      saveLegacyCreds(creds, {
        setItem: () => {
          throw new Error('lleno')
        }
      })
    ).toBe(false)
    expect(saveLegacyCreds(creds, null)).toBe(false)
  })
})
