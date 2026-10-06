/**
 * `LanSignalingServer` en modo viaje (`tunnel`): ligado solo a 127.0.0.1, 503 antes del nombre del túnel, `Host`/`Origin` exactos, puerta
 * previa con galleta `__Host-`, 404 idéntico para todo lo no listado, límites de ritmo, keepalive del WebSocket y autocomprobación.
 * Sin Cloudflare: las peticiones llegan directas al servidor poniendo a mano las cabeceras que puso el borde en la prueba real (T0).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { connect as tcpConnect } from 'node:net'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { PROTOCOL_VERSION } from '@shared/remote/protocol'
import { TRAVEL_LIMITS } from '@shared/remote/travel'
import { LanSignalingServer } from './lan-server'
import { ProbeNonces, TunnelGate } from './tunnel-gate'
import { TunnelLimits } from './tunnel-limits'
import type { SignalingPeer } from './types'

const HOST = 'merry-plasma-least-recruitment.trycloudflare.com'
const ORIGIN = `https://${HOST}`
const SECRET = 'S'.repeat(43)

let dir = ''
let clock = 1_000_000
let pub: string | null = null
let server: LanSignalingServer
let gate: TunnelGate
let limits: TunnelLimits
let probes: ProbeNonces
let port = 0
let rejects: number[] = []
let peers: SignalingPeer[] = []
const sockets: WebSocket[] = []

async function boot(extra: { keepalive?: { pingMs: number; deadMs: number } } = {}): Promise<void> {
  clock = 1_000_000
  gate = new TunnelGate()
  limits = new TunnelLimits(() => clock)
  probes = new ProbeNonces(() => clock)
  rejects = []
  peers = []
  server = new LanSignalingServer({
    ip: '127.0.0.1',
    pwaDir: dir,
    tunnel: { gate, limits, probes, publicOrigin: () => pub, onGateReject: (n) => rejects.push(n), ...extra }
  })
  server.onPeer((p) => peers.push(p))
  const { origin } = await server.start({ authorize: (h) => (h.mode === 'pair' ? h.qid === SECRET : true) })
  port = Number(new URL(origin).port)
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pwa-tun-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>pwa</title><script type="module" src="/assets/main-BaDQdc5Q.js"></script>')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'main-BaDQdc5Q.js'), 'console.log(1)')
  pub = ORIGIN
  await boot()
})
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

interface Res {
  status: number
  body: string
  headers: Record<string, string | string[] | undefined>
}
function req(
  path: string,
  o: { method?: string; host?: string | null; cookie?: string | null; headers?: Record<string, string> } = {}
): Promise<Res> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) }
  if (o.host !== null) headers.Host = o.host ?? HOST
  if (o.cookie) headers.Cookie = o.cookie
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    r.on('error', reject)
    r.end()
  })
}
const COOKIE = (): string => `__Host-lazunoxk=${gate.token}`
/** Cabeceras que identifican la respuesta (sin las que cambian por petición). */
const sig = (r: Res): string =>
  JSON.stringify([
    r.status,
    r.body,
    Object.entries(r.headers)
      .filter(([k]) => !['date', 'connection', 'keep-alive'].includes(k))
      .sort()
  ])

/** Intenta abrir el WebSocket y devuelve el socket o la respuesta HTTP de rechazo. */
function ws(
  o: { host?: string; origin?: string | null; cookie?: string | null; ip?: string } = {}
): Promise<{ ws?: WebSocket; rejected?: Res }> {
  const headers: Record<string, string> = { Host: o.host ?? HOST }
  if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN
  if (o.cookie !== null) headers.Cookie = o.cookie ?? COOKIE()
  if (o.ip) headers['Cf-Connecting-Ip'] = o.ip
  const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers, autoPong: true })
  sockets.push(sock)
  return new Promise((resolve) => {
    sock.once('open', () => resolve({ ws: sock }))
    sock.once('unexpected-response', (_req, res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ rejected: { status: res.statusCode ?? 0, body, headers: res.headers } }))
    })
    sock.once('error', () => resolve({}))
  })
}
const next = (s: WebSocket): Promise<string> => new Promise((r) => s.once('message', (d) => r(d.toString())))

describe('ligado solo a 127.0.0.1', () => {
  it('se niega a ligarse a otra cosa que no sea loopback', async () => {
    for (const ip of ['0.0.0.0', '192.168.1.10', '::']) {
      const s = new LanSignalingServer({ ip, pwaDir: dir, tunnel: { gate, limits, probes, publicOrigin: () => pub } })
      await expect(s.start({ authorize: () => true })).rejects.toThrow('tunnel-must-bind-loopback')
    }
  })
  it('no escucha en la IP de la red local', async () => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === 'IPv4' && !a.internal)
    if (!lan) return
    const refused = await new Promise<boolean>((resolve) => {
      const c = tcpConnect({ host: lan.address, port, timeout: 1500 })
      c.once('connect', () => (c.destroy(), resolve(false)))
      c.once('error', () => resolve(true))
      c.once('timeout', () => (c.destroy(), resolve(true)))
    })
    expect(refused).toBe(true)
  })
  it('puerto aleatorio, nunca uno guardado', async () => {
    expect(server.port).toBe(port)
    expect(port).toBeGreaterThan(1023)
  })
})

describe('503 hasta que cloudflared dice el nombre', () => {
  it('todo (HTTP y WebSocket) responde 503 mientras publicOrigin es null', async () => {
    pub = null
    for (const p of ['/', '/k/' + gate.token, '/ws', '/__lazunox/probe/x'])
      expect((await req(p, { host: HOST, cookie: COOKIE() })).status, p).toBe(503)
    expect((await req('/', { host: '127.0.0.1' })).status).toBe(503)
    const r = await ws()
    expect(r.rejected?.status).toBe(503)
    pub = ORIGIN
    expect((await req('/', { cookie: COOKIE() })).status).toBe(200)
  })
})

describe('Host exacto', () => {
  it('421 con 127.0.0.1:puerto, otro host o un subdominio parecido', async () => {
    for (const host of [`127.0.0.1:${port}`, 'evil.trycloudflare.com', `x.${HOST}`, `${HOST}:443`, 'localhost'])
      expect((await req('/', { host, cookie: COOKIE() })).status, host).toBe(421)
    expect((await req('/', { host: HOST.toUpperCase(), cookie: COOKIE() })).status).toBe(200)
    expect((await ws({ host: '127.0.0.1' })).rejected?.status).toBe(421)
  })
})

describe('sin galleta todo es el MISMO 404', () => {
  it('rutas reales, inexistentes, `/ws`, `/cdn-cgi/`, la sonda y la puerta con clave errónea', async () => {
    const paths = [
      '/',
      '/index.html',
      '/assets/main-BaDQdc5Q.js',
      '/ws',
      '/nada',
      '/cdn-cgi/trace',
      '/cdn-cgi/scripts/x/email-decode.min.js',
      `/k/${'A'.repeat(22)}`,
      '/k/',
      '/k/corto',
      '/__lazunox/probe/xxxxxxxxxxxxxxxxxxxxxx',
      '/../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/a%00b'
    ]
    const sigs = new Set<string>()
    for (const p of paths) sigs.add(sig(await req(p, { headers: { 'cf-connecting-ip': '198.51.100.7' } })))
    expect(sigs.size).toBe(1)
    const only = [...sigs][0]
    expect(only).toContain('404')
    expect(only).toContain('Not found')
    // Con otros métodos, igual.
    for (const m of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) expect(sig(await req('/', { method: m }))).toBe(only)
    // Una galleta incorrecta, o con otro nombre, tampoco abre nada.
    for (const c of [
      `__Host-lazunoxk=${'A'.repeat(22)}`,
      `lazunoxk=${gate.token}`,
      `__Host-lazunoxk=${gate.token}x`,
      `__Host-lazunoxk=`,
      'a=b'
    ])
      expect(sig(await req('/', { cookie: c })), c).toBe(only)
  })

  it('el rechazo del WebSocket sin galleta es el mismo 404 (cuerpo y estado)', async () => {
    const http = await req('/')
    const r = (await ws({ cookie: null })).rejected as Res
    expect(r.status).toBe(404)
    expect(r.body).toBe(http.body)
    for (const k of ['content-type', 'content-length', 'content-security-policy', 'cache-control', 'x-content-type-options'])
      expect(r.headers[k], k).toEqual(http.headers[k])
    // Ruta distinta de /ws con galleta válida: también el mismo 404 (no se distingue qué falló).
    const wrongPath = await new Promise<Res>((resolve) => {
      const s = new WebSocket(`ws://127.0.0.1:${port}/otra`, { headers: { Host: HOST, Origin: ORIGIN, Cookie: COOKIE() } })
      s.once('unexpected-response', (_q, res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
      })
    })
    expect(wrongPath.status).toBe(404)
    expect(wrongPath.body).toBe(http.body)
  })
})

describe('puerta /k/<T>', () => {
  it('con T correcto: 303 a «/» y galleta __Host- Secure HttpOnly SameSite=Lax sin Domain', async () => {
    const r = await req(`/k/${gate.token}`)
    expect(r.status).toBe(303)
    expect(r.headers.location).toBe('/')
    const c = String(r.headers['set-cookie'])
    expect(c).toMatch(new RegExp(`^__Host-lazunoxk=${gate.token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=\\d+$`))
    expect(c).not.toMatch(/Domain/i)
    expect(String(r.headers['cache-control'])).toBe('no-store')
    expect(r.body).toBe('')
  })
  it('con la galleta se sirve la PWA con cabeceras de seguridad del modo viaje', async () => {
    const r = await req('/', { cookie: COOKIE() })
    expect(r.status).toBe(200)
    expect(r.body).toContain('<title>pwa</title>')
    const csp = String(r.headers['content-security-policy'])
    expect(csp).toContain(`connect-src 'self' wss://${HOST}`)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(r.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(r.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.headers['strict-transport-security']).toBeUndefined()
    const a = await req('/assets/main-BaDQdc5Q.js', { cookie: COOKIE() })
    expect(a.status).toBe(200)
    expect(a.headers['cache-control']).toContain('immutable')
  })
  it('con galleta: rutas inexistentes, `..`, %2e%2e, NUL, `\\`, /cdn-cgi/ y /k/ con la T buena como subruta', async () => {
    const nf = sig(await req('/'))
    for (const p of ['/nada', '/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/cdn-cgi/trace', '/assets/', '/assets/../../x'])
      expect(sig(await req(p, { cookie: COOKIE() })), p).toBe(nf)
    for (const p of ['/a%00b', '/a%5Cb']) expect((await req(p, { cookie: COOKIE() })).status, p).toBe(400)
    expect((await req('/', { cookie: COOKIE(), method: 'POST' })).status).toBe(405)
    expect((await req('/', { cookie: COOKIE(), method: 'HEAD' })).status).toBe(200)
    // Con la galleta, `/k/<T>` sigue funcionando y una T vieja no.
    expect((await req(`/k/${gate.token}`, { cookie: COOKIE() })).status).toBe(303)
  })
  it('T nueva (túnel relanzado): la anterior y su galleta dejan de valer', async () => {
    const old = gate.token
    gate.rotate()
    expect(gate.token).not.toBe(old)
    expect(sig(await req('/', { cookie: `__Host-lazunoxk=${old}` }))).toBe(sig(await req('/nada')))
    expect((await req(`/k/${old}`)).status).toBe(404)
  })
  it('20 intentos erróneos por minuto bloquean /k/* con 429 durante 60 s, avisan, y no afectan a quien ya tiene galleta', async () => {
    for (let i = 0; i < TRAVEL_LIMITS.gateFailuresPerMin; i++) expect((await req(`/k/${'B'.repeat(21)}${i % 10}`)).status).toBe(404)
    expect(rejects).toEqual([])
    expect((await req(`/k/${'C'.repeat(22)}`)).status).toBe(404) // el 21.º activa el bloqueo (y sigue siendo 404)
    expect(rejects).toHaveLength(1)
    expect(rejects[0]).toBe(TRAVEL_LIMITS.gateFailuresPerMin + 1)
    expect((await req(`/k/${gate.token}`)).status).toBe(429) // ni siquiera la clave buena entra durante el bloqueo
    expect((await req('/', { cookie: COOKIE() })).status).toBe(200)
    clock += TRAVEL_LIMITS.gateLockMs + 1
    expect((await req(`/k/${gate.token}`)).status).toBe(303)
  })
})

describe('autocomprobación del Mac', () => {
  it('el nonce vale una sola vez, solo con GET y dentro del plazo', async () => {
    const n = probes.issue()
    expect((await req(`/__lazunox/probe/${n}`, { method: 'POST' })).status).toBe(404)
    const ok = await req(`/__lazunox/probe/${n}`)
    expect(ok.status).toBe(200)
    expect(ok.body).toBe('lazunox-probe-ok')
    expect((await req(`/__lazunox/probe/${n}`)).status).toBe(404)
    const late = probes.issue()
    clock += TRAVEL_LIMITS.probeTtlMs + 1
    expect((await req(`/__lazunox/probe/${late}`)).status).toBe(404)
    expect((await req('/__lazunox/probe/' + 'x'.repeat(22))).status).toBe(404)
  })
  it('readStatic entrega lo que serviría (index, scripts) y nada fuera de la carpeta', () => {
    expect(server.readStatic('/')?.toString()).toContain('<title>pwa</title>')
    expect(server.readStatic('/assets/main-BaDQdc5Q.js')?.toString()).toBe('console.log(1)')
    expect(server.readStatic('/../x')).toBeNull()
    expect(server.readStatic('/nada.js')).toBeNull()
  })
})

describe('límites de ritmo', () => {
  it('HTTP: 60 por 10 s por visitante; otro visitante no se ve afectado; se recupera al pasar la ventana', async () => {
    const h = { 'cf-connecting-ip': '198.51.100.1' }
    let last = 0
    for (let i = 0; i < TRAVEL_LIMITS.httpPer10sPerIp; i++) last = (await req('/', { cookie: COOKIE(), headers: h })).status
    expect(last).toBe(200)
    expect((await req('/', { cookie: COOKIE(), headers: h })).status).toBe(429)
    expect((await req('/', { cookie: COOKIE(), headers: { 'cf-connecting-ip': '198.51.100.2' } })).status).toBe(200)
    clock += 10_001
    expect((await req('/', { cookie: COOKIE(), headers: h })).status).toBe(200)
  })
  it('HTTP: tope GLOBAL de 200 por 10 s aunque el visitante «cambie» de IP', async () => {
    let first429 = 0
    for (let i = 1; i <= TRAVEL_LIMITS.httpPer10sGlobal + 5; i++) {
      const s = (await req('/', { cookie: COOKIE(), headers: { 'x-forwarded-for': `203.0.113.${(i % 250) + 1}` } })).status
      if (s === 429 && !first429) first429 = i
    }
    expect(first429).toBe(TRAVEL_LIMITS.httpPer10sGlobal + 1)
  })
  it('una pista de IP falsa o ausente cuenta como «unknown» (no se usa para autenticar)', async () => {
    for (let i = 0; i < TRAVEL_LIMITS.httpPer10sPerIp; i++)
      await req('/', { cookie: COOKIE(), headers: { 'cf-connecting-ip': 'no-es-una-ip' } })
    expect((await req('/', { cookie: COOKIE() })).status).toBe(429) // ambas son «unknown»
  })
  it('upgrades: 10 por minuto por visitante', async () => {
    const opened: WebSocket[] = []
    for (let i = 0; i < TRAVEL_LIMITS.upgradesPerMinPerIp; i++) {
      const r = await ws({ ip: '198.51.100.9' })
      if (r.ws) {
        opened.push(r.ws)
        r.ws.close()
      }
      await new Promise((res) => setTimeout(res, 5))
    }
    const r = await ws({ ip: '198.51.100.9' })
    expect(r.rejected?.status).toBe(429)
    clock += 60_001
    expect((await ws({ ip: '198.51.100.9' })).ws).toBeDefined()
  })
})

describe('WebSocket de señalización', () => {
  it('Origin exacto: sin él o con otro se rechaza; con galleta y Origin correctos funciona el hello', async () => {
    expect((await ws({ origin: 'https://evil.trycloudflare.com' })).rejected?.status).toBe(404)
    expect((await ws({ origin: null })).rejected?.status).toBe(404)
    expect((await ws({ origin: `${ORIGIN}/` })).rejected?.status).toBe(404)
    const r = await ws()
    const s = r.ws as WebSocket
    const ready = next(s)
    s.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, mode: 'pair', qid: SECRET, deviceName: 'Pixel' }))
    expect(JSON.parse(await ready)).toEqual({ t: 'ready' })
    expect(peers).toHaveLength(1)
  })
  it('máximo de 2 sockets', async () => {
    const a = await ws({ ip: '198.51.100.1' })
    const b = await ws({ ip: '198.51.100.2' })
    expect(a.ws && b.ws).toBeTruthy()
    expect((await ws({ ip: '198.51.100.3' })).rejected?.status).toBe(503)
  })
  it('no hay permessage-deflate: el servidor no negocia extensiones', async () => {
    const r = await ws()
    const s = r.ws as WebSocket
    expect(s.extensions).toBe('')
  })
})

describe('keepalive del WebSocket (el borde corta a ~125 s sin tráfico)', () => {
  it('el servidor manda pings periódicos', async () => {
    await server.stop()
    await boot({ keepalive: { pingMs: 40, deadMs: 5000 } })
    const s = (await ws()).ws as WebSocket
    let pings = 0
    s.on('ping', () => pings++)
    await new Promise((r) => setTimeout(r, 300))
    expect(pings).toBeGreaterThanOrEqual(4)
  })
  it('si no llega NADA del celular en deadMs, cierra el socket', async () => {
    await server.stop()
    await boot({ keepalive: { pingMs: 30, deadMs: 200 } })
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Host: HOST, Origin: ORIGIN, Cookie: COOKIE() }, autoPong: false })
    sockets.push(sock)
    await new Promise<void>((r) => sock.once('open', () => r()))
    const t = Date.now()
    await new Promise<void>((r) => sock.once('close', () => r()))
    expect(Date.now() - t).toBeLessThan(1500)
  })
  it('si el celular responde (pong automático) el socket sigue abierto más allá de deadMs', async () => {
    await server.stop()
    await boot({ keepalive: { pingMs: 30, deadMs: 200 } })
    const s = (await ws()).ws as WebSocket
    await new Promise((r) => setTimeout(r, 700))
    expect(s.readyState).toBe(s.OPEN)
  })
})

describe('el comportamiento LAN no cambia', () => {
  it('sin `tunnel` no hay galleta ni 503 y el puerto guardado se respeta', async () => {
    const lan = new LanSignalingServer({ ip: '127.0.0.1', pwaDir: dir })
    const { origin } = await lan.start({ authorize: () => true })
    const u = new URL(origin)
    const r = await new Promise<number>((resolve) =>
      request(
        { host: u.hostname, port: u.port, path: '/', headers: { Host: u.host } },
        (res) => (res.resume(), resolve(res.statusCode ?? 0))
      ).end()
    )
    expect(r).toBe(200)
    await lan.stop()
  })
})
