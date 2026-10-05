/**
 * Regresión del fallo real de la autocomprobación: el nombre de un túnel recién creado AÚN NO existe en el DNS (el `cloudflared` real
 * imprime la URL y registra la conexión antes). La primera consulta al resolvedor del sistema recibía NXDOMAIN y lo guardaba 60 s
 * (SOA de la zona), así que los reintentos de 1 s → 30 s daban `getaddrinfo ENOTFOUND` hasta agotar el plazo y el QR no salía nunca.
 * `makeTunnelLookup` pregunta a los servidores autoritativos y NO toca al sistema mientras el nombre no exista.
 */
import type { LookupFunction } from 'node:net'
import { describe, expect, it } from 'vitest'
import { makeTunnelLookup, type DnsDeps } from './tunnel-dns'

function deps(over: Partial<DnsDeps> = {}): { d: DnsDeps; system: string[] } {
  const system: string[] = []
  const d: DnsDeps = {
    authoritative: async () => ['198.51.100.1'],
    resolve4: async () => ['203.0.113.7'],
    system: ((host: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      system.push(host)
      cb(null, '192.0.2.9', 4)
    }) as unknown as LookupFunction,
    ...over
  }
  return { d, system }
}
const call = (
  l: LookupFunction,
  host: string,
  o: object = {}
): Promise<{ err: NodeJS.ErrnoException | null; addr: unknown; fam?: unknown }> =>
  new Promise((resolve) =>
    (l as unknown as (h: string, o: object, cb: (e: NodeJS.ErrnoException | null, a?: unknown, f?: unknown) => void) => void)(
      host,
      o,
      (err, addr, fam) => resolve({ err, addr, fam })
    )
  )

describe('makeTunnelLookup', () => {
  it('con el nombre ya publicado devuelve la IP del autoritativo (con y sin `all`) y no usa el sistema', async () => {
    const { d, system } = deps()
    const l = makeTunnelLookup(d)
    expect(await call(l, 'a-b.trycloudflare.com')).toMatchObject({ err: null, addr: '203.0.113.7', fam: 4 })
    expect(await call(l, 'a-b.trycloudflare.com', { all: true })).toMatchObject({
      err: null,
      addr: [{ address: '203.0.113.7', family: 4 }]
    })
    expect(system).toEqual([])
  })
  it('NXDOMAIN todavía: error ENOTFOUND SIN preguntar al sistema (no se envenena su caché negativa)', async () => {
    const { d, system } = deps({ resolve4: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })) })
    const r = await call(makeTunnelLookup(d), 'a-b.trycloudflare.com')
    expect(r.err?.code).toBe('ENOTFOUND')
    expect(system).toEqual([])
  })
  it('sin forma de hablar con el autoritativo (UDP 53 bloqueado, sin NS) se recurre al sistema', async () => {
    for (const d of [
      deps({ authoritative: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })) }),
      deps({ resolve4: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ETIMEOUT' })) })
    ]) {
      const r = await call(makeTunnelLookup(d.d), 'a-b.trycloudflare.com')
      expect(r).toMatchObject({ err: null, addr: '192.0.2.9' })
      expect(d.system).toEqual(['a-b.trycloudflare.com'])
    }
  })
  it('un nombre que no es de `*.trycloudflare.com` va siempre al sistema (no se desvía nada más)', async () => {
    const { d, system } = deps()
    expect(await call(makeTunnelLookup(d), 'example.com')).toMatchObject({ addr: '192.0.2.9' })
    expect(await call(makeTunnelLookup(d), 'trycloudflare.com.evil.example')).toMatchObject({ addr: '192.0.2.9' })
    expect(system).toEqual(['example.com', 'trycloudflare.com.evil.example'])
  })
})
