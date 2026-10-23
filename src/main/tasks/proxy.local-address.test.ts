/**
 * El proxy de salida del sandbox NO debe llegar a direcciones locales aunque el NOMBRE esté permitido. Escenario del hallazgo B4 de la
 * revisión de 1.5.0: un dominio permitido (por «Permitir una vez/siempre») que resuelve a 127.0.0.1 reabriría, desde el sandbox, el puerto del
 * propio motor (cuya contraseña se puede leer de `ps`) o cualquier otro servicio local. Con un «motor» local de verdad como blanco.
 */
import { connect, createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EgressProxy, isForbiddenEgressAddress, resolveEgressTarget } from './proxy'

describe('isForbiddenEgressAddress', () => {
  it.each([
    '127.0.0.1',
    '127.5.5.5',
    '0.0.0.0',
    '169.254.169.254',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '[::1]',
    'no-es-una-ip'
  ])('prohíbe %s', (ip) => expect(isForbiddenEgressAddress(ip)).toBe(true))

  it.each(['8.8.8.8', '93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8', '10.0.0.5', '172.16.0.1', '192.168.1.20', '100.64.0.5'])(
    'permite %s (públicas y redes privadas de empresa)',
    (ip) => expect(isForbiddenEgressAddress(ip)).toBe(false)
  )
})

describe('resolveEgressTarget', () => {
  it('literales: loopback → null; pública → la misma IP', async () => {
    expect(await resolveEgressTarget('127.0.0.1')).toBeNull()
    expect(await resolveEgressTarget('[::1]')).toBeNull()
    expect(await resolveEgressTarget('8.8.8.8')).toBe('8.8.8.8')
  })
  it('un nombre que resuelve a loopback («localhost») → null; uno que no resuelve → null', async () => {
    expect(await resolveEgressTarget('localhost')).toBeNull()
    expect(await resolveEgressTarget('no-existe.invalid')).toBeNull()
  })
  it('si ALGUNA de las direcciones del nombre es prohibida se rechaza (no basta con que la primera sea pública)', async () => {
    expect(await resolveEgressTarget('localhost', () => false)).not.toBeNull()
    expect(await resolveEgressTarget('localhost', (ip) => ip === '::1')).toBeNull()
  })
})

describe('EgressProxy: nombre permitido que resuelve a una dirección local', () => {
  let proxy: EgressProxy | null = null
  let motor: Server | null = null
  afterEach(async () => {
    await proxy?.stop()
    await new Promise<void>((r) => (motor ? motor.close(() => r()) : r()))
    proxy = null
    motor = null
  })

  const auth = `Proxy-Authorization: Basic ${Buffer.from('tok:x').toString('base64')}\r\n`

  async function fakeEngine(): Promise<{ port: number; seen: () => number }> {
    let n = 0
    motor = createServer((s) => {
      n++
      s.on('error', () => undefined)
      s.end()
    })
    await new Promise<void>((r) => motor!.listen(0, '127.0.0.1', () => r()))
    return { port: (motor!.address() as { port: number }).port, seen: () => n }
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

  it('CONNECT: el nombre está permitido pero resuelve a loopback → 403 y el «motor» NO recibe ninguna conexión', async () => {
    const engine = await fakeEngine()
    // `resolve` por defecto + nombre real que apunta a loopback.
    proxy = new EgressProxy({ token: 'tok', allowlist: () => ['localhost'] })
    const port = await proxy.start()
    const line = await firstLine(port, `CONNECT localhost:${engine.port} HTTP/1.1\r\nHost: localhost:${engine.port}\r\n${auth}\r\n`)
    expect(line).toContain('403')
    await new Promise((r) => setTimeout(r, 150))
    expect(engine.seen()).toBe(0)
  })

  it('HTTP plano: igual, 403 y sin conexión al «motor»', async () => {
    const engine = await fakeEngine()
    proxy = new EgressProxy({ token: 'tok', allowlist: () => ['localhost'] })
    const port = await proxy.start()
    const line = await firstLine(
      port,
      `GET http://localhost:${engine.port}/global/health HTTP/1.1\r\nHost: localhost:${engine.port}\r\n${auth}\r\n`
    )
    expect(line).toContain('403')
    await new Promise((r) => setTimeout(r, 150))
    expect(engine.seen()).toBe(0)
  })

  it('una IP LITERAL de loopback tampoco pasa aunque alguien la hubiera puesto en la lista blanca', async () => {
    const engine = await fakeEngine()
    proxy = new EgressProxy({ token: 'tok', allowlist: () => ['127.0.0.1'] })
    const port = await proxy.start()
    const line = await firstLine(port, `CONNECT 127.0.0.1:${engine.port} HTTP/1.1\r\nHost: 127.0.0.1:${engine.port}\r\n${auth}\r\n`)
    expect(line).toContain('403')
    await new Promise((r) => setTimeout(r, 150))
    expect(engine.seen()).toBe(0)
  })

  it('camino permitido: conecta a la IP que devolvió la resolución (no al nombre) y el túnel se establece', async () => {
    const engine = await fakeEngine()
    // Solo en prueba: la resolución devuelve una IP concreta que sí se puede alcanzar aquí (el servidor local).
    proxy = new EgressProxy({ token: 'tok', allowlist: () => ['permitido.test'], resolve: async () => '127.0.0.1' })
    const port = await proxy.start()
    const line = await firstLine(
      port,
      `CONNECT permitido.test:${engine.port} HTTP/1.1\r\nHost: permitido.test:${engine.port}\r\n${auth}\r\n`
    )
    expect(line).toContain('200')
    expect(engine.seen()).toBe(1)
  })
})
