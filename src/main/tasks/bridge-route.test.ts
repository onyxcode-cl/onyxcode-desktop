/**
 * Ruta `computer` del puente de apps (modo unificado, ola 1): el proxy reenvía SOLO la ruta del MCP de control, quita cualquier cabecera
 * BRIDGE_* del agente, pone las suyas y no filtra el token real. Servidor MCP simulado en loopback.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { BRIDGE_ORIGIN_HEADER, BRIDGE_ROUTE_NAME, BRIDGE_SERVER_HEADER } from '@shared/unified-bridge'
import { getBridgeSecret, isBridgeSecret } from './bridge-secret'
import { McpProxy } from './mcp-proxy'

const REAL_TOKEN = 'TOKEN-REAL-DEL-MCP-DE-CONTROL'
const seen: Array<{ method: string; url: string; headers: IncomingMessage['headers'] }> = []
const clean: Array<() => Promise<void>> = []
afterEach(async () => {
  seen.length = 0
  await Promise.all(clean.splice(0).map((f) => f()))
})

async function upstream(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
      if (req.url === '/boom') {
        res.writeHead(500, { 'content-type': 'text/plain' }).end(`fallo con ${REAL_TOKEN}`)
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  clean.push(() => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))))
  return { server, port: (server.address() as { port: number }).port }
}

async function setup(): Promise<{ url: string; auth: Record<string, string>; token: string; p: McpProxy }> {
  const up = await upstream()
  const p = new McpProxy()
  await p.start()
  clean.push(() => p.stop())
  const route = p.addRoute({
    name: BRIDGE_ROUTE_NAME,
    url: `http://127.0.0.1:${up.port}/mcp`,
    exactPath: true,
    headers: {
      Authorization: `Bearer ${REAL_TOKEN}`,
      [BRIDGE_ORIGIN_HEADER]: getBridgeSecret(),
      [BRIDGE_SERVER_HEADER]: '/carpeta/a'
    }
  })
  return { url: route.url, auth: route.headers, token: route.token, p }
}

describe('puente de apps: ruta computer del proxy', () => {
  it('la config del agente no contiene el token real ni el secreto del puente', async () => {
    const { url, auth, token } = await setup()
    const all = JSON.stringify({ url, auth, token })
    expect(all).not.toContain(REAL_TOKEN)
    expect(all).not.toContain(getBridgeSecret())
  })

  it('quita BRIDGE_* y Authorization del agente y pone las suyas (secreto de main, serverKey de main)', async () => {
    const { url, auth } = await setup()
    const r = await fetch(url, {
      method: 'POST',
      body: '{}',
      headers: {
        ...auth,
        'content-type': 'application/json',
        [BRIDGE_ORIGIN_HEADER]: 'secreto-falso',
        [BRIDGE_SERVER_HEADER]: '/carpeta/b',
        'X-Lazunox-Bridge-Extra': 'x'
      }
    })
    expect(r.status).toBe(200)
    const h = seen[0].headers
    expect(h[BRIDGE_ORIGIN_HEADER]).toBe(getBridgeSecret())
    expect(isBridgeSecret(h[BRIDGE_ORIGIN_HEADER])).toBe(true)
    expect(h[BRIDGE_SERVER_HEADER]).toBe('/carpeta/a')
    expect(h.authorization).toBe(`Bearer ${REAL_TOKEN}`)
    expect(h['x-lazunox-bridge-extra']).toBeUndefined()
  })

  it('solo reenvía la ruta exacta del MCP: otras rutas y subrutas → 404 sin tocar el destino', async () => {
    const { url, auth } = await setup()
    const base = url.replace(/\/mcp$/, '')
    for (const path of ['/', '/boom', '/mcp/otra', '/mcp/', '/otra']) {
      const r = await fetch(base + path, { method: 'POST', body: '{}', headers: auth })
      expect(r.status, path).toBe(404)
    }
    expect(seen).toHaveLength(0)
  })

  it('métodos fuera de GET/POST/DELETE → 405; sin token → 401', async () => {
    const { url, auth } = await setup()
    expect((await fetch(url, { method: 'PUT', body: '{}', headers: auth })).status).toBe(405)
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401)
    expect(seen).toHaveLength(0)
  })

  it('un error del destino no filtra el token real hacia el agente', async () => {
    const p = new McpProxy()
    await p.start()
    clean.push(() => p.stop())
    // destino caído: error genérico
    const dead = p.addRoute({
      name: BRIDGE_ROUTE_NAME,
      url: 'http://127.0.0.1:9/mcp',
      exactPath: true,
      headers: { Authorization: `Bearer ${REAL_TOKEN}` }
    })
    const r = await fetch(dead.url, { method: 'POST', body: '{}', headers: dead.headers })
    expect(await r.text()).not.toContain(REAL_TOKEN)
    expect(JSON.stringify([...r.headers])).not.toContain(REAL_TOKEN)
  })
})
