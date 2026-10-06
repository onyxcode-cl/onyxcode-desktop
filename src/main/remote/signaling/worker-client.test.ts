import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { CLOUD_ORIGIN, newHostToken, pairHostToken, roomOfToken } from '@shared/remote/cloud'
import type { IceServerSpec } from '@shared/remote/protocol'
import { FakeCloud } from './fake-cloud'
import type { CloudSocket, CloudSocketFactory, CloudTimers } from './worker-client'
import { CloudSignalingTransport, validBaseUrl } from './worker-client'
import type { SignalHello, SignalingPeer } from './types'

const WSS = CLOUD_ORIGIN.replace('https:', 'wss:')

// ── dobles ──

class FakeSock implements CloudSocket {
  sent: string[] = []
  closedWith: number | null = null
  private o: (() => void) | null = null
  private m: ((t: string, b: boolean) => void) | null = null
  private c: (() => void) | null = null
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>
  ) {}
  send(t: string): void {
    this.sent.push(t)
  }
  close(code?: number): void {
    if (this.closedWith !== null) return
    this.closedWith = code ?? 1000
    queueMicrotask(() => this.c?.())
  }
  onOpen(cb: () => void): void {
    this.o = cb
  }
  onMessage(cb: (t: string, b: boolean) => void): void {
    this.m = cb
  }
  onClose(cb: () => void): void {
    this.c = cb
  }
  open(): void {
    this.o?.()
  }
  recv(o: unknown): void {
    this.m?.(typeof o === 'string' ? o : JSON.stringify(o), false)
  }
  frames(): Array<Record<string, unknown>> {
    return this.sent.filter((s) => s !== 'ping').map((s) => JSON.parse(s) as Record<string, unknown>)
  }
}

function manualTimers(): CloudTimers & { advance(ms: number): void; delays: number[] } {
  let now = 0
  const q: Array<{ at: number; fn: () => void; dead: boolean }> = []
  const delays: number[] = []
  return {
    delays,
    set(fn, ms) {
      delays.push(ms)
      const h = { at: now + ms, fn, dead: false }
      q.push(h)
      return h
    },
    clear(h) {
      ;(h as { dead: boolean }).dead = true
    },
    advance(ms) {
      const end = now + ms
      for (;;) {
        const next = q.filter((x) => !x.dead).sort((a, b) => a.at - b.at)[0]
        if (!next || next.at > end) break
        now = next.at
        next.dead = true
        next.fn()
      }
      now = end
    }
  }
}

const TOKEN = newHostToken((n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255))
const ROOM = roomOfToken(TOKEN)
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function rig(
  o: { allowed?: () => boolean; authorize?: (h: SignalHello, room?: string) => boolean; allowRelay?: () => boolean; pingMs?: number } = {}
) {
  const socks: FakeSock[] = []
  const timers = manualTimers()
  const createSocket: CloudSocketFactory = (url, headers) => {
    const s = new FakeSock(url, headers)
    socks.push(s)
    return s
  }
  const allowed = { v: true }
  const t = new CloudSignalingTransport({
    baseUrl: WSS,
    hostToken: () => TOKEN,
    allowed: o.allowed ?? (() => allowed.v),
    createSocket,
    timers,
    rand: () => 1,
    pingMs: o.pingMs ?? 60_000,
    pongWithinMs: 5_000
  })
  const peers: SignalingPeer[] = []
  const authCalls: Array<{ h: SignalHello; room?: string }> = []
  t.onPeer((p) => peers.push(p))
  const start = (): Promise<{ origin: string }> =>
    t.start({
      authorize: (h, room) => {
        authCalls.push({ h, room })
        return o.authorize ? o.authorize(h, room) : true
      },
      ...(o.allowRelay ? { allowRelay: o.allowRelay } : {})
    })
  return { t, socks, timers, peers, authCalls, start, allowed }
}

const helloFrame = { t: 'hello', v: 4, mode: 'resume', deviceId: 'a'.repeat(32) }

describe('CloudSignalingTransport (sin red: socket y reloj falsos)', () => {
  it('solo acepta wss:// (o 127.0.0.1 en pruebas)', () => {
    expect(validBaseUrl(WSS)).toBe(true)
    expect(validBaseUrl('ws://127.0.0.1:1234')).toBe(true)
    for (const u of [WSS.replace('wss:', 'ws:'), 'http://x', 'wss://a/b', 'ws://evil.example:80', 'wss://x y'])
      expect(() => new CloudSignalingTransport({ baseUrl: u, hostToken: () => TOKEN, allowed: () => true }), u).toThrow()
  })

  it('conecta con el token en la cabecera (no en la URL) y devuelve el origen del sitio', async () => {
    const r = rig()
    const { origin } = await r.start()
    expect(origin).toBe(CLOUD_ORIGIN)
    expect(r.socks).toHaveLength(1)
    expect(r.socks[0].url).toBe(`${WSS}/v1/host`)
    expect(r.socks[0].url).not.toContain(TOKEN)
    expect(r.socks[0].headers).toEqual({ 'x-lazunox-host': TOKEN })
  })

  it('sin permiso (política o sitio en pausa) NO se crea ningún socket, ni al reintentar ni con la sala de vinculación', async () => {
    const r = rig({ allowed: () => false })
    await r.start()
    r.t.setPairRoom(pairHostToken('A'.repeat(43)))
    r.t.resume()
    r.t.networkChanged()
    r.timers.advance(10 * 60_000)
    expect(r.socks).toHaveLength(0)
    expect(r.t.status()).toBe('offline')
  })

  it('sin hostToken no arranca', async () => {
    const t = new CloudSignalingTransport({
      baseUrl: WSS,
      hostToken: () => null,
      allowed: () => true,
      createSocket: () => new FakeSock('', {})
    })
    await expect(t.start({ authorize: () => true })).rejects.toThrow('no-host-token')
  })

  it('estado: connecting -> online -> offline y reintento con espera exponencial con azar', async () => {
    const r = rig()
    const seen: string[] = []
    r.t.onStatus((s) => seen.push(s))
    await r.start()
    expect(r.t.status()).toBe('connecting')
    r.socks[0].open()
    expect(r.t.status()).toBe('online')
    r.timers.delays.length = 0
    // se cae: reintento a ~1 s (rand = 1 → 100 % de la base), luego 2 s, 4 s…
    r.socks[0].close(1006)
    await tick()
    expect(r.t.status()).toBe('offline')
    expect(r.timers.delays[0]).toBe(1000)
    r.timers.advance(1000)
    expect(r.socks).toHaveLength(2)
    r.socks[1].close(1006)
    await tick()
    r.timers.advance(2000)
    expect(r.socks).toHaveLength(3)
    r.socks[2].close(1006)
    await tick()
    r.timers.advance(4000)
    expect(r.socks).toHaveLength(4)
    // tope de 60 s
    for (let i = 0; i < 12; i++) {
      r.socks.at(-1)!.close(1006)
      await tick()
      r.timers.advance(60_000)
    }
    expect(Math.max(...r.timers.delays)).toBeLessThanOrEqual(60_000)
    r.socks.at(-1)!.open()
    expect(seen).toContain('online')
  })

  it('al abrir el enlace se reinicia la espera', async () => {
    const r = rig()
    await r.start()
    r.socks[0].close(1006)
    await tick()
    r.timers.advance(1000)
    r.socks[1].close(1006)
    await tick()
    r.timers.advance(2000)
    r.socks[2].open() // conectó: la espera vuelve a 1 s
    r.timers.delays.length = 0
    r.socks[2].close(1006)
    await tick()
    expect(r.timers.delays[0]).toBe(1000)
  })

  it('una trama inválida del servicio cierra el socket (y se reintenta)', async () => {
    const r = rig()
    await r.start()
    r.socks[0].open()
    r.socks[0].recv('no es json')
    expect(r.socks[0].closedWith).toBe(1008)
    await tick()
    r.timers.advance(1000)
    expect(r.socks).toHaveLength(2)
    r.socks[1].open()
    r.socks[1].recv({ t: 'peer', id: 'MAYUS' })
    expect(r.socks[1].closedWith).toBe(1008)
    await tick()
    r.timers.advance(5000)
    r.socks[2].open()
    r.socks[2].recv({ t: 'turn', id: 'abc12345', servers: [{ urls: ['turn:evil.example.com'] }] })
    expect(r.socks[2].closedWith).toBe(1008)
  })

  it('suspend cierra al instante y no reconecta; resume reabre ya', async () => {
    const r = rig()
    await r.start()
    r.socks[0].open()
    r.t.suspend()
    expect(r.socks[0].closedWith).toBe(1000)
    r.timers.advance(5 * 60_000)
    expect(r.socks).toHaveLength(1)
    r.t.resume()
    expect(r.socks).toHaveLength(2)
    r.socks[1].open()
    // cambio de red: cierra y reabre al momento
    r.t.networkChanged()
    expect(r.socks[1].closedWith).toBe(1000)
    expect(r.socks).toHaveLength(3)
  })

  it('stop cierra todo y no deja reintentos', async () => {
    const r = rig()
    await r.start()
    r.socks[0].open()
    await r.t.stop()
    expect(r.socks[0].closedWith).toBe(1000)
    r.timers.advance(10 * 60_000)
    expect(r.socks).toHaveLength(1)
    expect(r.t.status()).toBe('offline')
  })

  it('ping cada 60 s; sin pong a tiempo se cierra y reconecta', async () => {
    const r = rig()
    await r.start()
    r.socks[0].open()
    r.timers.advance(60_000)
    expect(r.socks[0].sent).toEqual(['ping'])
    r.socks[0].recv('pong')
    r.timers.advance(5_000)
    expect(r.socks[0].closedWith).toBeNull()
    r.timers.advance(55_000)
    expect(r.socks[0].sent).toEqual(['ping', 'ping'])
    r.timers.advance(5_000) // sin pong
    expect(r.socks[0].closedWith).toBe(1000)
    await tick()
    r.timers.advance(1000)
    expect(r.socks).toHaveLength(2)
  })

  it('la sala de vinculación abre un SEGUNDO socket con su token y se cierra al quitarla', async () => {
    const r = rig()
    await r.start()
    r.socks[0].open()
    const pairTok = pairHostToken('B'.repeat(43))
    r.t.setPairRoom(pairTok)
    expect(r.socks).toHaveLength(2)
    expect(r.socks[1].headers['x-lazunox-host']).toBe(pairTok)
    r.socks[1].open()
    expect(r.t.status()).toBe('online') // el estado visible es el del enlace principal
    r.t.setPairRoom(null)
    expect(r.socks[1].closedWith).toBe(1000)
    r.timers.advance(10 * 60_000)
    expect(r.socks).toHaveLength(2)
  })

  describe('celulares', () => {
    it('hello válido: grant ANTES de ready, authorize con la sala, y el peer sale al servicio', async () => {
      const r = rig()
      await r.start()
      r.socks[0].open()
      r.socks[0].recv({ t: 'peer', id: 'abc12345' })
      r.socks[0].recv({ t: 'from', id: 'abc12345', d: JSON.stringify(helloFrame) })
      expect(r.authCalls).toHaveLength(1)
      expect(r.authCalls[0].room).toBe(ROOM)
      expect(r.socks[0].frames()).toEqual([
        { t: 'grant', id: 'abc12345' },
        { t: 'to', id: 'abc12345', d: '{"t":"ready"}' }
      ])
      expect(r.peers).toHaveLength(1)
      expect(r.peers[0].room).toBe(ROOM)
      expect(r.peers[0].hello).toMatchObject({ mode: 'resume' })
    })

    it('hello rechazado: error invalid y kick, SIN grant', async () => {
      const r = rig({ authorize: () => false })
      await r.start()
      r.socks[0].open()
      r.socks[0].recv({ t: 'peer', id: 'abc12345' })
      r.socks[0].recv({ t: 'from', id: 'abc12345', d: JSON.stringify(helloFrame) })
      const f = r.socks[0].frames()
      expect(f.some((x) => x.t === 'grant')).toBe(false)
      expect(f[0]).toEqual({ t: 'to', id: 'abc12345', d: '{"t":"error","code":"invalid"}' })
      expect(f.at(-1)).toEqual({ t: 'kick', id: 'abc12345' })
      expect(r.peers).toHaveLength(0)
    })

    it('con allowRelay=false el Mac no manda grant', async () => {
      const r = rig({ allowRelay: () => false })
      await r.start()
      r.socks[0].open()
      r.socks[0].recv({ t: 'peer', id: 'abc12345' })
      r.socks[0].recv({ t: 'from', id: 'abc12345', d: JSON.stringify(helloFrame) })
      expect(r.socks[0].frames().some((x) => x.t === 'grant')).toBe(false)
      expect(r.socks[0].frames().some((x) => x.t === 'to')).toBe(true)
    })

    it('versión fuera de rango y tramas raras: error y kick', async () => {
      const r = rig()
      await r.start()
      r.socks[0].open()
      r.socks[0].recv({ t: 'peer', id: 'abc12345' })
      r.socks[0].recv({ t: 'from', id: 'abc12345', d: JSON.stringify({ ...helloFrame, v: 9 }) })
      expect(r.socks[0].frames()[0]).toEqual({ t: 'to', id: 'abc12345', d: '{"t":"error","code":"version"}' })
      expect(r.authCalls).toHaveLength(0)
      r.socks[0].recv({ t: 'peer', id: 'def12345' })
      r.socks[0].recv({ t: 'from', id: 'def12345', d: JSON.stringify({ t: 'offer', sdp: 'v=0\r\nabc' }) })
      expect(r.socks[0].frames().some((x) => x.t === 'to' && String(x.d).includes('"frame"'))).toBe(true)
    })

    it('turn llega y queda disponible en peer.iceServers() sin pasar por authorize', async () => {
      const r = rig()
      await r.start()
      r.socks[0].open()
      const servers: IceServerSpec[] = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }]
      r.socks[0].recv({ t: 'peer', id: 'abc12345' })
      r.socks[0].recv({ t: 'from', id: 'abc12345', d: JSON.stringify(helloFrame) })
      r.socks[0].recv({ t: 'turn', id: 'abc12345', servers })
      expect(r.peers[0].iceServers?.()).toEqual(servers)
      // un turn para un celular que no existe se ignora
      r.socks[0].recv({ t: 'turn', id: 'zzzz9999', servers })
    })

    it('un tercer celular simultáneo se expulsa (kick)', async () => {
      const r = rig()
      await r.start()
      r.socks[0].open()
      for (const id of ['aaaa1111', 'bbbb2222', 'cccc3333']) r.socks[0].recv({ t: 'peer', id })
      expect(r.socks[0].frames()).toEqual([{ t: 'kick', id: 'cccc3333' }])
    })

    it('gone cierra la sesión (onClose del peer) y las respuestas del Mac salen como `to`', async () => {
      const r = rig()
      await r.start()
      r.socks[0].open()
      r.socks[0].recv({ t: 'peer', id: 'abc12345' })
      r.socks[0].recv({ t: 'from', id: 'abc12345', d: JSON.stringify(helloFrame) })
      let closed = 0
      r.peers[0].onClose(() => closed++)
      r.peers[0].sendAnswer('v=0\r\nabc')
      expect(r.socks[0].frames().at(-1)).toEqual({ t: 'to', id: 'abc12345', d: '{"t":"answer","sdp":"v=0\\r\\nabc"}' })
      r.socks[0].recv({ t: 'gone', id: 'abc12345' })
      expect(closed).toBe(1)
    })

    it('si el enlace se cae, los celulares en curso se sueltan', async () => {
      const r = rig()
      await r.start()
      r.socks[0].open()
      r.socks[0].recv({ t: 'peer', id: 'abc12345' })
      r.socks[0].recv({ t: 'from', id: 'abc12345', d: JSON.stringify(helloFrame) })
      let closed = 0
      r.peers[0].onClose(() => closed++)
      r.socks[0].close(1006)
      await tick()
      expect(closed).toBe(1)
    })
  })
})

// ── con el doble local del servicio (ws real en 127.0.0.1, el mismo RoomCore del Worker) ──

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: tiempo agotado')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('CloudSignalingTransport contra FakeCloud (127.0.0.1)', () => {
  async function setup(turn: IceServerSpec[] | null = null) {
    const cloud = new FakeCloud({ turn })
    const base = await cloud.start()
    const t = new CloudSignalingTransport({ baseUrl: base, hostToken: () => TOKEN, allowed: () => true, pingMs: 100, pongWithinMs: 1000 })
    const peers: SignalingPeer[] = []
    t.onPeer((p) => peers.push(p))
    await t.start({ authorize: () => true })
    await until(() => t.status() === 'online')
    const phone = (room = ROOM, origin: string | null = CLOUD_ORIGIN): { ws: WebSocket; got: string[] } => {
      const ws = new WebSocket(`${base}/v1/peer/${room}`, origin === null ? {} : { origin })
      const got: string[] = []
      ws.on('message', (d) => got.push(d.toString('utf8')))
      ws.on('error', () => undefined)
      return { ws, got }
    }
    return { cloud, base, t, peers, phone }
  }

  it('un celular llega por la sala, recibe ready y el Mac lo ve como peer; el canal de señalización es bidireccional', async () => {
    const { cloud, t, peers, phone } = await setup()
    const p = phone()
    await until(() => p.ws.readyState === WebSocket.OPEN)
    p.ws.send(JSON.stringify(helloFrame))
    await until(() => p.got.length > 0)
    expect(JSON.parse(p.got[0])).toEqual({ t: 'ready' })
    expect(peers).toHaveLength(1)
    peers[0].sendAnswer('v=0\r\nabc')
    await until(() => p.got.length > 1)
    expect(JSON.parse(p.got[1])).toEqual({ t: 'answer', sdp: 'v=0\r\nabc' })
    p.ws.send(JSON.stringify({ t: 'offer', sdp: 'v=0\r\nxyz' }))
    let offer = ''
    peers[0].onOffer((s) => (offer = s))
    p.ws.send(JSON.stringify({ t: 'ice', candidate: 'c', mid: '0' })) // ice antes de la offer ya enviada: llega después
    await until(() => offer !== '' || p.ws.readyState !== WebSocket.OPEN)
    p.ws.close()
    await t.stop()
    await cloud.stop()
  })

  it('TURN: con servidores disponibles llegan al celular y al Mac antes de ready', async () => {
    const servers: IceServerSpec[] = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }]
    const { cloud, t, peers, phone } = await setup(servers)
    const p = phone()
    await until(() => p.ws.readyState === WebSocket.OPEN)
    p.ws.send(JSON.stringify(helloFrame))
    await until(() => p.got.length >= 2)
    expect(p.got.map((g) => (JSON.parse(g) as { t: string }).t)).toEqual(['turn', 'ready'])
    expect(JSON.parse(p.got[0])).toEqual({ t: 'turn', servers })
    expect(peers[0].iceServers?.()).toEqual(servers)
    p.ws.close()
    await t.stop()
    await cloud.stop()
  })

  it('Origin ajeno o sala inexistente: el celular no entra; host caído: host-offline', async () => {
    const { cloud, t, phone } = await setup()
    const bad = phone(ROOM, 'https://evil.example')
    await until(() => bad.ws.readyState === WebSocket.CLOSED)
    const ghost = phone('G'.repeat(43))
    await until(() => ghost.got.length > 0)
    expect(JSON.parse(ghost.got[0])).toEqual({ t: 'error', code: 'host-offline' })
    await t.stop()
    await until(() => cloud.openHosts === 0)
    const late = phone()
    await until(() => late.got.length > 0)
    expect(JSON.parse(late.got[0])).toEqual({ t: 'error', code: 'host-offline' })
    await cloud.stop()
  })

  it('reconecta solo cuando el servicio cierra el socket del Mac', async () => {
    const { cloud, t } = await setup()
    expect(cloud.hostConnections).toBe(1)
    t.networkChanged()
    await until(() => cloud.hostConnections === 2)
    await until(() => t.status() === 'online')
    await t.stop()
    await cloud.stop()
  })
})
