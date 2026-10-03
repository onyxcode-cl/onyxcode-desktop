import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { LIMITS, PROTOCOL_VERSION } from '@shared/remote/protocol'
import { LanSignalingServer } from './lan-server'
import type { SignalHello, SignalingPeer } from './types'

const SECRET = 'S'.repeat(43)
let dir: string
let server: LanSignalingServer
let origin = ''
let peers: SignalingPeer[] = []
let hellos: SignalHello[] = []

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pwa-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>pwa</title>')
  writeFileSync(join(dir, 'app.js'), 'console.log(1)')
  peers = []
  hellos = []
  server = new LanSignalingServer({ ip: '127.0.0.1', pwaDir: dir })
  server.onPeer((p) => peers.push(p))
  origin = (
    await server.start({
      authorize: (h) => {
        hellos.push(h)
        return h.mode === 'pair' ? h.secret === SECRET : true
      }
    })
  ).origin
})
afterEach(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

function get(
  path: string,
  headers: Record<string, string> = {},
  method = 'GET'
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const u = new URL(origin)
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

function connect(opts: { origin?: string | null; host?: string } = {}): Promise<WebSocket> {
  const u = new URL(origin)
  const headers: Record<string, string> = {}
  if (opts.origin !== null) headers.Origin = opts.origin ?? origin
  if (opts.host) headers.Host = opts.host
  const ws = new WebSocket(`ws://${u.host}/ws`, { headers })
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)))
  })
}

const next = (ws: WebSocket): Promise<string> => new Promise((r) => ws.once('message', (d) => r(d.toString())))
const closed = (ws: WebSocket): Promise<void> => new Promise((r) => (ws.readyState === ws.CLOSED ? r() : ws.once('close', () => r())))

describe('LanSignalingServer', () => {
  it('sirve la PWA con cabeceras de seguridad y no sale de su carpeta', async () => {
    const r = await get('/')
    expect(r.status).toBe(200)
    expect(r.body).toContain('<title>pwa</title>')
    expect(String(r.headers['content-security-policy'])).toContain("default-src 'none'")
    expect(r.headers['cache-control']).toBe('no-store')
    expect((await get('/app.js')).status).toBe(200)
    expect((await get('/../../etc/passwd')).status).toBe(404)
    expect((await get('/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404)
    expect((await get('/secret.exe')).status).toBe(404)
    expect((await get('/', {}, 'POST')).status).toBe(405)
    expect((await get('/', { Host: 'evil.example' })).status).toBe(421)
  })

  it('sin PWA compilada muestra un aviso en vez de fallar', async () => {
    rmSync(join(dir, 'index.html'))
    const r = await get('/')
    expect(r.status).toBe(200)
    expect(r.body).toContain('OnyxCode')
  })

  it('rechaza Origin ajeno, sin Origin y Host ajeno en el WebSocket', async () => {
    await expect(connect({ origin: 'http://evil.example' })).rejects.toThrow()
    await expect(connect({ origin: null })).rejects.toThrow()
    await expect(connect({ host: 'evil.example' })).rejects.toThrow()
  })

  it('hello válido: ready, peer y consumo del secreto; hello inválido: error y cierre', async () => {
    const ok = await connect()
    const readyP = next(ok)
    ok.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, mode: 'pair', secret: SECRET, deviceName: 'Pixel' }))
    expect(JSON.parse(await readyP)).toEqual({ t: 'ready' })
    expect(peers).toHaveLength(1)
    expect(hellos[0]).toMatchObject({ mode: 'pair', deviceName: 'Pixel' })

    const bad = await connect()
    const errP = next(bad)
    bad.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, mode: 'pair', secret: 'X'.repeat(43), deviceName: 'x' }))
    expect(JSON.parse(await errP)).toEqual({ t: 'error', code: 'invalid' })
    await closed(bad)
    expect(peers).toHaveLength(1)
    ok.close()
  })

  it('versión distinta, primera trama que no es hello y binario cierran', async () => {
    const a = await connect()
    const p1 = next(a)
    a.send(JSON.stringify({ t: 'hello', v: 99, mode: 'resume', deviceId: 'a'.repeat(32) }))
    expect(JSON.parse(await p1)).toEqual({ t: 'error', code: 'version' })
    const b = await connect()
    const p2 = next(b)
    b.send(JSON.stringify({ t: 'offer', sdp: 'v=0\r\nabc' }))
    expect(JSON.parse(await p2)).toEqual({ t: 'error', code: 'frame' })
    expect(hellos).toHaveLength(0)
  })

  it('máximo de sockets simultáneos', async () => {
    const a = await connect()
    const b = await connect()
    await expect(connect()).rejects.toThrow()
    expect(LIMITS.maxSignalSockets).toBe(2)
    a.close()
    b.close()
  })

  it('stop cierra el puerto y los sockets', async () => {
    const a = await connect()
    await server.stop()
    await closed(a)
    await expect(get('/')).rejects.toThrow()
  })
})
