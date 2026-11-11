/**
 * Guardia de direcciones RESUELTAS del proxy de salida (1.8.19): un nombre permitido cuyo DNS apunta a una dirección interna no abre nada,
 * se resuelve UNA vez, se validan TODAS las direcciones y se conecta por IP a la validada. Todo con DNS simulado y un servidor local de
 * puerto efímero: sin tráfico a Internet.
 */
import { connect, createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EgressProxy, egressTargetAllowed, isForbiddenEgressAddress, resolveEgressTarget, type LookupAll } from './proxy'

const fixed =
  (...addrs: string[]): LookupAll =>
  async () =>
    addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))

describe('resolveEgressTarget con DNS simulado', () => {
  const noOwn = (ip: string): boolean => isForbiddenEgressAddress(ip, [])

  it.each([
    ['127.0.0.1'],
    ['169.254.169.254'],
    ['::ffff:127.0.0.1'],
    ['::1'],
    ['0.0.0.0'],
    ['10.1.2.3'],
    ['172.20.0.1'],
    ['192.168.0.1'],
    ['fe80::1'],
    ['fd12:3456::1'],
    ['::ffff:a9fe:a9fe']
  ])('nombre permitido → %s: se rechaza', async (ip) => {
    expect(await resolveEgressTarget('permitido.test', noOwn, fixed(ip))).toBeNull()
  })

  it('mezcla pública + interna: se rechaza ENTERA (no basta con que la primera sea pública)', async () => {
    expect(await resolveEgressTarget('permitido.test', noOwn, fixed('203.0.113.10', '127.0.0.1'))).toBeNull()
    expect(await resolveEgressTarget('permitido.test', noOwn, fixed('2001:db8::1', '192.168.1.1'))).toBeNull()
  })

  it('respuesta vacía o error de DNS: se rechaza', async () => {
    expect(await resolveEgressTarget('permitido.test', noOwn, fixed())).toBeNull()
    expect(
      await resolveEgressTarget('permitido.test', noOwn, async () => {
        throw new Error('ENOTFOUND')
      })
    ).toBeNull()
  })

  it('pública: devuelve esa IP (y desmapea ::ffff:a.b.c.d)', async () => {
    expect(await resolveEgressTarget('permitido.test', noOwn, fixed('203.0.113.10', '203.0.113.11'))).toBe('203.0.113.10')
    expect(await resolveEgressTarget('permitido.test', noOwn, fixed('::ffff:203.0.113.10'))).toBe('203.0.113.10')
  })

  it('las IP propias del equipo se rechazan aunque sean públicas', () => {
    expect(isForbiddenEgressAddress('203.0.113.77', ['127.0.0.1', '203.0.113.77'])).toBe(true)
    expect(isForbiddenEgressAddress('2001:db8::77', ['2001:DB8::77%en0'])).toBe(true)
    expect(isForbiddenEgressAddress('::ffff:203.0.113.77', ['203.0.113.77'])).toBe(true)
    expect(isForbiddenEgressAddress('203.0.113.78', ['203.0.113.77'])).toBe(false)
  })
})

describe('egressTargetAllowed: nombre, IP literal y puerto', () => {
  const list = ['opencode.ai', '203.0.113.5']
  it('solo 80 y 443', () => {
    expect(egressTargetAllowed('opencode.ai', 443, list)).toBe('ok')
    expect(egressTargetAllowed('api.opencode.ai', 80, list)).toBe('ok')
    expect(egressTargetAllowed('opencode.ai', 22, list)).toBe('port')
    expect(egressTargetAllowed('opencode.ai', 5432, list)).toBe('port')
  })
  it('IP literal: solo si esa IP exacta está en la lista (nunca por sufijo)', () => {
    expect(egressTargetAllowed('203.0.113.5', 443, list)).toBe('ok')
    expect(egressTargetAllowed('203.0.113.5', 443, ['0.113.5'])).toBe('host')
    expect(egressTargetAllowed('8.8.8.8', 443, list)).toBe('host')
    expect(egressTargetAllowed('[::1]', 443, ['localhost'])).toBe('host')
  })
})

describe('EgressProxy: integración con servidor local y DNS simulado', () => {
  let proxy: EgressProxy | null = null
  let target: Server | null = null
  afterEach(async () => {
    await proxy?.stop()
    await new Promise<void>((r) => (target ? target.close(() => r()) : r()))
    proxy = null
    target = null
  })

  const auth = `Proxy-Authorization: Basic ${Buffer.from('tok:x').toString('base64')}\r\n`

  /** «Servicio local de la persona» en 127.0.0.1 con puerto efímero; cuenta conexiones y responde una línea. */
  async function localService(): Promise<{ port: number; seen: () => number }> {
    let n = 0
    target = createServer((s) => {
      n++
      s.on('error', () => undefined)
      s.resume() // consumir la petición: sin esto el socket queda en pausa y nunca cierra
      s.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
    })
    await new Promise<void>((r) => target!.listen(0, '127.0.0.1', () => r()))
    return { port: (target!.address() as { port: number }).port, seen: () => n }
  }

  async function firstLine(proxyPort: number, request: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const s = connect(proxyPort, '127.0.0.1')
      let buf = ''
      s.on('data', (d) => {
        buf += d.toString()
        if (buf.includes('\r\n')) {
          s.destroy()
          resolve(buf.split('\r\n')[0])
        }
      })
      s.on('close', () => resolve(buf.split('\r\n')[0]))
      s.on('error', reject)
      s.write(request)
    })
  }

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150))

  it('nombre permitido que el DNS lleva a 127.0.0.1: CONNECT y HTTP plano → 403, el servicio local no recibe nada', async () => {
    const svc = await localService()
    const dialed: string[] = []
    proxy = new EgressProxy({
      token: 'tok',
      allowlist: () => ['permitido.test'],
      lookup: fixed('127.0.0.1'),
      // Si el proxy llegara a marcar, iría al servicio local: así la prueba detecta cualquier fuga.
      dial: (_p, ip, cb) => {
        dialed.push(ip)
        return connect(svc.port, '127.0.0.1', cb)
      }
    })
    const port = await proxy.start()
    expect(await firstLine(port, `CONNECT permitido.test:443 HTTP/1.1\r\nHost: permitido.test:443\r\n${auth}\r\n`)).toContain('403')
    expect(await firstLine(port, `GET http://permitido.test/ HTTP/1.1\r\nHost: permitido.test\r\n${auth}\r\n`)).toContain('403')
    // Y sin simular nada: el servicio local de verdad por su puerto efímero, con IP literal o «localhost».
    expect(await firstLine(port, `CONNECT 127.0.0.1:${svc.port} HTTP/1.1\r\n${auth}\r\n`)).toContain('403')
    await settle()
    expect(dialed).toEqual([])
    expect(svc.seen()).toBe(0)
  })

  it('destino público simulado: pasa, y el proxy marca exactamente la IP validada', async () => {
    const svc = await localService()
    const dialed: Array<[number, string]> = []
    proxy = new EgressProxy({
      token: 'tok',
      allowlist: () => ['permitido.test'],
      lookup: fixed('203.0.113.10'),
      dial: (p, ip, cb): Socket => {
        dialed.push([p, ip])
        return connect(svc.port, '127.0.0.1', cb) // la «Internet» simulada es el servidor local
      }
    })
    const port = await proxy.start()
    expect(await firstLine(port, `CONNECT permitido.test:443 HTTP/1.1\r\nHost: permitido.test:443\r\n${auth}\r\n`)).toContain('200')
    expect(await firstLine(port, `GET http://permitido.test/x HTTP/1.1\r\nHost: permitido.test\r\n${auth}\r\n`)).toContain('200')
    await settle()
    expect(dialed).toEqual([
      [443, '203.0.113.10'],
      [80, '203.0.113.10']
    ])
    expect(svc.seen()).toBe(2)
  })

  it('DNS rebinding: la primera consulta da pública y la segunda 127.0.0.1 → se resuelve UNA vez y se conecta a la pública', async () => {
    const svc = await localService()
    let calls = 0
    const dialed: string[] = []
    proxy = new EgressProxy({
      token: 'tok',
      allowlist: () => ['permitido.test'],
      lookup: async () => [{ address: ++calls === 1 ? '203.0.113.10' : '127.0.0.1', family: 4 }],
      dial: (_p, ip, cb) => {
        dialed.push(ip)
        return connect(svc.port, '127.0.0.1', cb)
      }
    })
    const port = await proxy.start()
    expect(await firstLine(port, `CONNECT permitido.test:443 HTTP/1.1\r\n${auth}\r\n`)).toContain('200')
    expect(calls).toBe(1)
    expect(dialed).toEqual(['203.0.113.10'])
    // La siguiente conexión vuelve a resolver (ahora a 127.0.0.1) y se niega sin marcar.
    expect(await firstLine(port, `CONNECT permitido.test:443 HTTP/1.1\r\n${auth}\r\n`)).toContain('403')
    expect(dialed).toEqual(['203.0.113.10'])
  })

  it('puerto raro (5432) en nombre permitido: 403 sin resolver ni ofrecer «Permitir»', async () => {
    let lookups = 0
    const blocked: string[] = []
    proxy = new EgressProxy({
      token: 'tok',
      allowlist: () => ['permitido.test'],
      onBlocked: (e) => blocked.push(e.host),
      lookup: async () => {
        lookups++
        return [{ address: '203.0.113.10', family: 4 }]
      }
    })
    const port = await proxy.start()
    expect(await firstLine(port, `CONNECT permitido.test:5432 HTTP/1.1\r\n${auth}\r\n`)).toContain('403')
    expect(await firstLine(port, `GET http://permitido.test:8080/ HTTP/1.1\r\nHost: permitido.test:8080\r\n${auth}\r\n`)).toContain('403')
    expect(lookups).toBe(0)
    expect(blocked).toEqual([])
  })

  it('HTTP plano con cabecera Host distinta del destino: 400 sin conectar', async () => {
    const svc = await localService()
    const dialed: string[] = []
    proxy = new EgressProxy({
      token: 'tok',
      allowlist: () => ['permitido.test'],
      lookup: fixed('203.0.113.10'),
      dial: (_p, ip, cb) => {
        dialed.push(ip)
        return connect(svc.port, '127.0.0.1', cb)
      }
    })
    const port = await proxy.start()
    expect(await firstLine(port, `GET http://permitido.test/ HTTP/1.1\r\nHost: localhost:${svc.port}\r\n${auth}\r\n`)).toContain('400')
    await settle()
    expect(dialed).toEqual([])
    expect(svc.seen()).toBe(0)
  })
})
