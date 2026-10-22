/**
 * Proxy local de MCP fuera del sandbox (F8-B79): cada ataque tiene su prueba. Servidores MCP simulados en loopback
 * (sin red real ni modelos).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { makeRedactor } from '../diagnostics/redact'
import { McpProxy, knownMcpProxyTokens, type McpProxyLimits } from './mcp-proxy'

interface Seen {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

class FakeMcp {
  seen: Seen[] = []
  server: Server
  port = 0
  constructor(handler?: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void) {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const s: Seen = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
        this.seen.push(s)
        if (handler) return handler(req, res, s)
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=1', 'x-interno': 'no' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }))
      })
    })
  }
  async start(): Promise<this> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()))
    this.port = (this.server.address() as { port: number }).port
    return this
  }
  url(path = '/mcp'): string {
    return `http://127.0.0.1:${this.port}${path}`
  }
  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>((r) => this.server.close(() => r()))
  }
}

const toClean: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(toClean.splice(0).map((f) => f()))
})
async function fake(handler?: ConstructorParameters<typeof FakeMcp>[0]): Promise<FakeMcp> {
  const f = await new FakeMcp(handler).start()
  toClean.push(() => f.stop())
  return f
}
async function proxy(limits?: Partial<McpProxyLimits>, now?: () => number): Promise<McpProxy> {
  const p = new McpProxy({ limits, now })
  await p.start()
  toClean.push(() => p.stop())
  return p
}
const RPC = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
const post = (url: string, token: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    body: RPC,
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined)
    }
  })

/** Petición HTTP en crudo (forma absoluta, `Host` falso…) que `fetch` no deja escribir. */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () => s.write(text))
    let out = ''
    s.on('data', (d: Buffer) => (out += d.toString()))
    s.on('close', () => resolve(out))
    s.on('error', reject)
    setTimeout(() => s.destroy(), 1500)
  })
}

describe('McpProxy: el secreto real llega al servidor MCP y el sandbox solo ve el token de sesión', () => {
  it('inyecta las cabeceras reales, quita la de sesión y no entrega el secreto en la config', async () => {
    const up = await fake()
    const p = await proxy()
    const REAL = 'Bearer REAL-secreto-del-usuario-123456'
    const cfg = p.addRoute({ name: 'gh', url: up.url('/mcp'), headers: { Authorization: REAL, 'X-Api-Key': 'clave-real-abcdef' } })
    // Lo que va al entorno del sandbox no contiene nada real.
    expect(JSON.stringify(cfg)).not.toContain('REAL-secreto')
    expect(JSON.stringify(cfg)).not.toContain('clave-real')
    expect(cfg.url).toBe(`http://127.0.0.1:${p.port}/mcp`)
    const r = await post(cfg.url, cfg.token, { headers: { 'x-api-key': 'del-cliente', cookie: 'a=b', 'x-extra': 'z' } })
    expect(r.status).toBe(200)
    expect(up.seen).toHaveLength(1)
    const h = up.seen[0].headers
    expect(h.authorization).toBe(REAL)
    expect(h['x-api-key']).toBe('clave-real-abcdef')
    expect(JSON.stringify(h)).not.toContain(cfg.token)
    expect(h.cookie).toBeUndefined()
    expect(h['x-extra']).toBeUndefined()
    expect(h.host).toBe(`127.0.0.1:${up.port}`)
    expect(up.seen[0].body).toBe(RPC)
    // Respuesta: sin set-cookie ni cabeceras internas.
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(r.headers.get('x-interno')).toBeNull()
  })

  it('la consulta registrada (clave en la URL) se añade en el destino y no aparece en la URL del sandbox', async () => {
    const up = await fake()
    const p = await proxy()
    const cfg = p.addRoute({ name: 'q', url: up.url('/mcp?key=SECRETA-q-999'), headers: {} })
    expect(cfg.url).not.toContain('SECRETA')
    expect(cfg.url).not.toContain('?')
    await post(`${cfg.url}?sessionId=s1&key=falsa`, cfg.token)
    const u = new URL(`http://x${up.seen[0].url}`)
    expect(u.searchParams.getAll('key')).toEqual(['SECRETA-q-999'])
    expect(u.searchParams.get('sessionId')).toBe('s1')
  })

  it('GET (flujo SSE) llega en streaming', async () => {
    const up = await fake((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: message\ndata: uno\n\n')
      setTimeout(() => res.end('data: dos\n\n'), 30)
    })
    const p = await proxy()
    const cfg = p.addRoute({ name: 's', url: up.url('/sse'), headers: { Authorization: 'Bearer r-1234567' } })
    const r = await fetch(cfg.url, { headers: { authorization: `Bearer ${cfg.token}`, accept: 'text/event-stream' } })
    expect(r.headers.get('content-type')).toBe('text/event-stream')
    expect(await r.text()).toContain('data: dos')
  })
})

describe('McpProxy: el token de sesión', () => {
  it('sin token, erróneo, con otro esquema o vacío: 401 y nada llega al destino', async () => {
    const up = await fake()
    const p = await proxy()
    const cfg = p.addRoute({ name: 'a', url: up.url(), headers: { Authorization: 'Bearer real-aaaaaaa' } })
    for (const auth of [
      undefined,
      'Bearer ',
      'Bearer nope',
      `Basic ${cfg.token}`,
      `bearer ${cfg.token}`,
      `Bearer ${cfg.token}x`,
      `Bearer ${cfg.token.slice(1)}`
    ]) {
      const r = await fetch(cfg.url, { method: 'POST', headers: auth ? { authorization: auth } : {}, body: RPC })
      expect(r.status).toBe(401)
    }
    expect(up.seen).toHaveLength(0)
  })

  it('no sirve para otro servidor: cada token solo llega a SU destino con SU secreto', async () => {
    const a = await fake()
    const b = await fake()
    const p = await proxy()
    const ca = p.addRoute({ name: 'a', url: a.url('/mcp'), headers: { Authorization: 'Bearer secreto-A-1111' } })
    const cb = p.addRoute({ name: 'b', url: b.url('/mcp'), headers: { Authorization: 'Bearer secreto-B-2222' } })
    expect(ca.token).not.toBe(cb.token)
    await post(ca.url, ca.token)
    expect(a.seen).toHaveLength(1)
    expect(b.seen).toHaveLength(0)
    expect(a.seen[0].headers.authorization).toBe('Bearer secreto-A-1111')
    // Usar el token de A contra la ruta de B no cambia de destino: el destino lo fija el token, nunca la URL.
    await post(cb.url, ca.token)
    expect(b.seen).toHaveLength(0)
    expect(a.seen).toHaveLength(2)
  })

  it('tras revocarse (revokeRoute) deja de valer; el otro token sigue', async () => {
    const a = await fake()
    const b = await fake()
    const p = await proxy()
    const ca = p.addRoute({ name: 'a', url: a.url(), headers: { Authorization: 'Bearer secreto-A-1111' } })
    const cb = p.addRoute({ name: 'b', url: b.url(), headers: { Authorization: 'Bearer secreto-B-2222' } })
    expect((await post(ca.url, ca.token)).status).toBe(200)
    expect(p.revokeRoute('a')).toBe(true)
    expect((await post(ca.url, ca.token)).status).toBe(401)
    expect((await post(cb.url, cb.token)).status).toBe(200)
    expect(p.revokeRoute('a')).toBe(false)
  })

  it('caduca (ttl) y tras stop() ni responde ni queda puerto abierto', async () => {
    const up = await fake()
    let now = 1_000
    const p = await proxy({ ttlMs: 5_000 }, () => now)
    const c = p.addRoute({ name: 'a', url: up.url(), headers: { Authorization: 'Bearer secreto-A-1111' } })
    expect((await post(c.url, c.token)).status).toBe(200)
    now += 5_001
    expect((await post(c.url, c.token)).status).toBe(401)
    expect(up.seen).toHaveLength(1)

    const p2 = new McpProxy()
    await p2.start()
    const c2 = p2.addRoute({ name: 'a', url: up.url(), headers: {} })
    await p2.stop()
    expect(p2.routeCount()).toBe(0)
    await expect(post(c2.url, c2.token)).rejects.toThrow()
    expect(() => p2.addRoute({ name: 'z', url: up.url(), headers: {} })).toThrow()
  })

  it('stop() corta un flujo abierto (sin conexiones huérfanas)', async () => {
    const up = await fake((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: x\n\n') // y no termina
    })
    const p = new McpProxy()
    await p.start()
    const c = p.addRoute({ name: 'a', url: up.url(), headers: {} })
    const r = await fetch(c.url, { headers: { authorization: `Bearer ${c.token}` } })
    const reader = r.body!.getReader()
    await reader.read()
    const stopped = p.stop()
    await expect(
      (async () => {
        try {
          for (;;) if ((await reader.read()).done) return 'cerrado'
        } catch {
          return 'cerrado' // corte abrupto del flujo: es lo esperado
        }
      })()
    ).resolves.toBe('cerrado')
    await stopped
  })

  it('los tokens emitidos están en la lista que usa el redactor de Diagnóstico', async () => {
    const up = await fake()
    const p = await proxy()
    const c = p.addRoute({ name: 'a', url: up.url(), headers: {} })
    expect(knownMcpProxyTokens()).toContain(c.token)
    const redact = makeRedactor({ exact: knownMcpProxyTokens() })
    expect(redact(`sesión ${c.token} y cabecera Authorization: Bearer ${c.token}`)).not.toContain(c.token)
    // Aun sin la lista exacta, la regla de 43 caracteres base64url lo cubre.
    expect(makeRedactor({ exact: [] })(`x ${c.token} y`)).not.toContain(c.token)
  })
})

describe('McpProxy: destinos y rutas (lista cerrada)', () => {
  async function setup(): Promise<{ up: FakeMcp; evil: FakeMcp; p: McpProxy; c: { url: string; token: string } }> {
    const up = await fake()
    const evil = await fake()
    const p = await proxy()
    const c = p.addRoute({ name: 'a', url: up.url('/mcp'), headers: { Authorization: 'Bearer real-aaaaaaa' } })
    return { up, evil, p, c }
  }

  it('`..`, `.`, `//`, barras invertidas, %2f/%5c/%25, `#` y controles se rechazan (400) sin tocar el destino', async () => {
    const { up, p, c } = await setup()
    for (const path of [
      '/../x',
      '/mcp/../../x',
      '/%2e%2e/x',
      '/%2E%2e/x',
      '//evil.test/x',
      '/a//b',
      '/a%2fb',
      '/a%5cb',
      '/a%252fb',
      '/a\\b',
      '/a#b',
      '/a%00b',
      '/./x'
    ]) {
      const res = await raw(
        p.port,
        `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${p.port}\r\nAuthorization: Bearer ${c.token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
      )
      expect(res, path).toMatch(/^HTTP\/1\.1 400/)
    }
    expect(up.seen).toHaveLength(0)
  })

  it('la forma absoluta (otro host en la petición) y `*` se rechazan: el cliente nunca elige el destino', async () => {
    const { up, evil, p, c } = await setup()
    for (const target of [`http://127.0.0.1:${evil.port}/mcp`, 'http://evil.test/mcp', '*', 'mcp']) {
      const res = await raw(
        p.port,
        `POST ${target} HTTP/1.1\r\nHost: 127.0.0.1:${p.port}\r\nAuthorization: Bearer ${c.token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
      )
      expect(res, target).toMatch(/^HTTP\/1\.1 400/)
    }
    expect(up.seen).toHaveLength(0)
    expect(evil.seen).toHaveLength(0)
  })

  it('un `Host` ajeno (DNS rebinding) y cualquier `Origin` se rechazan (403)', async () => {
    const { up, p, c } = await setup()
    const hostile = await raw(
      p.port,
      `POST /mcp HTTP/1.1\r\nHost: evil.test\r\nAuthorization: Bearer ${c.token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
    )
    expect(hostile).toMatch(/^HTTP\/1\.1 403/)
    const origin = await raw(
      p.port,
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${p.port}\r\nOrigin: http://evil.test\r\nAuthorization: Bearer ${c.token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
    )
    expect(origin).toMatch(/^HTTP\/1\.1 403/)
    expect(up.seen).toHaveLength(0)
  })

  it('métodos fuera de GET/POST/DELETE (PUT, PATCH, TRACE, CONNECT) → 405', async () => {
    const { up, p, c } = await setup()
    for (const m of ['PUT', 'PATCH', 'TRACE', 'OPTIONS']) {
      const res = await raw(
        p.port,
        `${m} /mcp HTTP/1.1\r\nHost: 127.0.0.1:${p.port}\r\nAuthorization: Bearer ${c.token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
      )
      expect(res, m).toMatch(/^HTTP\/1\.1 405/)
    }
    expect(up.seen).toHaveLength(0)
  })

  it('una redirección del destino NO se sigue: 502 y el otro servidor no recibe nada (ni la cabecera real)', async () => {
    const evil = await fake()
    const up = await fake((_req, res) => {
      res.writeHead(307, { location: evil.url('/robo') })
      res.end()
    })
    const p = await proxy()
    const c = p.addRoute({ name: 'a', url: up.url('/mcp'), headers: { Authorization: 'Bearer real-aaaaaaa' } })
    const r = await post(c.url, c.token, { redirect: 'manual' })
    expect(r.status).toBe(502)
    expect(r.headers.get('location')).toBeNull()
    expect(up.seen).toHaveLength(1)
    expect(evil.seen).toHaveLength(0)
  })

  it('credenciales en la URL (`u:p@host`) pasan a cabecera Basic y no a la config del sandbox', async () => {
    const up = await fake()
    const p = await proxy()
    const c = p.addRoute({ name: 'a', url: `http://usuario:pw-secreta@127.0.0.1:${up.port}/mcp`, headers: {} })
    expect(JSON.stringify(c)).not.toContain('pw-secreta')
    await post(c.url, c.token)
    expect(up.seen[0].headers.authorization).toBe(`Basic ${Buffer.from('usuario:pw-secreta').toString('base64')}`)
  })

  it('rutas inválidas al registrar: esquema ajeno, URL rota, cabecera con salto de línea', async () => {
    const p = await proxy()
    expect(() => p.addRoute({ name: 'x', url: 'file:///etc/passwd' })).toThrow()
    expect(() => p.addRoute({ name: 'x', url: 'no es una url' })).toThrow()
    expect(() => p.addRoute({ name: 'x', url: 'https://a.test/mcp', headers: { 'X-A': 'v\r\nX-Inyectada: 1' } })).toThrow()
    expect(() => p.addRoute({ name: 'x', url: 'https://a.test/mcp', headers: { 'X A': 'v' } })).toThrow()
  })
})

describe('McpProxy: límites', () => {
  it('cuerpo mayor que el máximo → 413 (por Content-Length y en streaming)', async () => {
    const up = await fake()
    const p = await proxy({ maxBodyBytes: 1000 })
    const c = p.addRoute({ name: 'a', url: up.url(), headers: {} })
    const big = 'x'.repeat(5000)
    expect((await post(c.url, c.token, { body: big })).status).toBe(413)
    const res = await raw(
      p.port,
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${p.port}\r\nAuthorization: Bearer ${c.token}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n1388\r\n${big}\r\n0\r\n\r\n`
    )
    expect(res).toMatch(/^HTTP\/1\.1 413/)
    expect(up.seen.every((s) => s.body.length < 5000)).toBe(true)
  })

  it('peticiones simultáneas por encima del tope → 429', async () => {
    const release: Array<() => void> = []
    const up = await fake((_req, res) => {
      release.push(() => res.end('{}'))
    })
    const p = await proxy({ maxConcurrent: 2, maxConcurrentPerRoute: 2 })
    const c = p.addRoute({ name: 'a', url: up.url(), headers: {} })
    const first = [post(c.url, c.token), post(c.url, c.token)]
    await new Promise((r) => setTimeout(r, 150))
    expect((await post(c.url, c.token)).status).toBe(429)
    release.forEach((f) => f())
    expect((await Promise.all(first)).map((r) => r.status)).toEqual([200, 200])
    // Liberado el cupo, vuelve a servir.
    const again = post(c.url, c.token)
    await new Promise((r) => setTimeout(r, 100))
    release.at(-1)!()
    expect((await again).status).toBe(200)
  })

  it('destino que no responde → 504 por tiempo; destino caído → 502 sin filtrar el motivo', async () => {
    const up = await fake(() => undefined)
    const p = await proxy({ headersTimeoutMs: 150 })
    const c = p.addRoute({ name: 'a', url: up.url(), headers: { Authorization: 'Bearer real-aaaaaaa' } })
    expect((await post(c.url, c.token)).status).toBe(504)
    const dead = p.addRoute({ name: 'd', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer real-bbbbbbb' } })
    const r = await post(dead.url, dead.token)
    expect(r.status).toBe(502)
    expect(await r.text()).not.toContain('real-bbbbbbb')
  })
})

describe('McpProxy: manejador local de solo lectura (canal del guardián, F8-B208)', () => {
  const ok = async (path: string, q: URLSearchParams) => ({ status: 200, body: { path, q: q.toString() } })
  const raw = (port: number, lines: string): Promise<string> =>
    new Promise((resolve) => {
      const s = connect(port, '127.0.0.1', () => s.end(lines))
      let out = ''
      s.on('data', (c) => (out += c.toString()))
      s.on('close', () => resolve(out))
    })

  it('con su token: GET responde JSON del manejador; sin token, otro token o token de una ruta MCP: 401', async () => {
    const p = await proxy()
    const up = await fake()
    const route = p.addRoute({ name: 'srv', url: up.url() })
    const g = p.setLocalHandler('/__lazunox-guard', ok)
    expect(g.url).toBe(`http://127.0.0.1:${p.port}/__lazunox-guard`)
    const r = await fetch(`${g.url}/session?id=ses_abc`, { headers: { authorization: `Bearer ${g.token}` } })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/json')
    expect(await r.json()).toEqual({ path: '/session', q: 'id=ses_abc' })
    expect((await fetch(`${g.url}/session`)).status).toBe(401)
    expect((await fetch(`${g.url}/session`, { headers: { authorization: 'Bearer otro' } })).status).toBe(401)
    // El token de una ruta MCP no abre el canal: va al destino MCP (que no conoce esa ruta), nunca al manejador.
    await fetch(`http://127.0.0.1:${p.port}/__lazunox-guard/session`, { headers: { authorization: `Bearer ${route.token}` } })
    expect(up.seen.at(-1)?.url).toBe('/__lazunox-guard/session')
    // Y el token del canal no sirve para el destino MCP.
    expect(up.seen.every((s) => s.headers.authorization !== `Bearer ${g.token}`)).toBe(true)
  })

  it('solo GET, sin cuerpo, URL acotada, prefijo exacto y mismo Host/Origin que el proxy', async () => {
    const p = await proxy()
    const g = p.setLocalHandler('/__lazunox-guard', ok)
    const auth = { authorization: `Bearer ${g.token}` }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
      expect((await fetch(`${g.url}/session`, { method, headers: auth })).status).toBe(405)
    expect((await fetch(`${g.url}/session?id=${'a'.repeat(600)}`, { headers: auth })).status).toBe(414)
    expect((await fetch(`http://127.0.0.1:${p.port}/otra/session`, { headers: auth })).status).toBe(404)
    expect((await fetch(`${g.url}x/session`, { headers: auth })).status).toBe(404)
    // Sin normalizar (petición cruda): cualquier ruta que no sea `/<letras>` no llega al manejador.
    const dotdot = await raw(
      p.port,
      `GET /__lazunox-guard/session/../config HTTP/1.1\r\nHost: 127.0.0.1:${p.port}\r\nAuthorization: Bearer ${g.token}\r\nConnection: close\r\n\r\n`
    )
    expect(dotdot).toMatch(/^HTTP\/1\.1 404/)
    expect((await fetch(`${g.url}/session`, { headers: { ...auth, origin: 'http://evil' } })).status).toBe(403)
    const bodyGet = await raw(
      p.port,
      `GET /__lazunox-guard/session HTTP/1.1\r\nHost: 127.0.0.1:${p.port}\r\nAuthorization: Bearer ${g.token}\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc`
    )
    expect(bodyGet).toMatch(/^HTTP\/1\.1 413/)
    const badHost = await raw(
      p.port,
      `GET /__lazunox-guard/session HTTP/1.1\r\nHost: evil:${p.port}\r\nAuthorization: Bearer ${g.token}\r\nConnection: close\r\n\r\n`
    )
    expect(badHost).toMatch(/^HTTP\/1\.1 403/)
  })

  it('error del manejador → 502 sin detalle; stop() anula el token', async () => {
    const p = new McpProxy()
    await p.start()
    const g = p.setLocalHandler('/__lazunox-guard', async () => {
      throw new Error('detalle-interno')
    })
    const r = await fetch(`${g.url}/session`, { headers: { authorization: `Bearer ${g.token}` } })
    expect(r.status).toBe(502)
    expect(await r.text()).not.toContain('detalle-interno')
    await p.stop()
    await expect(fetch(`${g.url}/session`, { headers: { authorization: `Bearer ${g.token}` } })).rejects.toThrow()
    expect(() => p.setLocalHandler('/x', ok)).toThrow()
    const q = await proxy()
    expect(() => q.setLocalHandler('/a/b', ok)).toThrow()
  })
})
