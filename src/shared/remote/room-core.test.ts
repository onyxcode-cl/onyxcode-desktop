import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLOUD_LIMITS, CLOUD_ORIGIN, newHostToken, roomOfToken } from './cloud'
import { fetchTurnServers, turnConfigured, type FetchLike } from './cloud-turn'
import { parseAllowedOrigins, routeEdge } from './cloud-edge'
import type { IceServerSpec } from './protocol'
import { RoomCore, type Attachment, type CoreSocket, type RoomEnv } from './room-core'

class FakeWs implements CoreSocket {
  sent: string[] = []
  closed: { code?: number; reason?: string } | null = null
  att: Attachment | null = null
  alive: number | null = null
  send(d: string): void {
    if (this.closed) throw new Error('closed')
    this.sent.push(d)
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason }
  }
  json(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>)
  }
}

const TOKEN = newHostToken((n) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 5) & 255))
const ROOM = roomOfToken(TOKEN)
const SERVERS: IceServerSpec[] = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }]
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function rig(o: { turn?: () => Promise<IceServerSpec[] | null> } = {}) {
  let now = 1_000_000
  let seq = 0
  const timers: Array<{ at: number; fn: () => void; dead: boolean }> = []
  const env: RoomEnv = {
    now: () => now,
    newId: () => `peer${String(++seq).padStart(4, '0')}`,
    setAttachment: (ws, a) => void ((ws as FakeWs).att = a),
    hostAliveAt: (ws) => (ws as FakeWs).alive,
    ...(o.turn ? { fetchTurn: o.turn } : {}),
    setTimer: (ms, fn) => {
      const t = { at: now + ms, fn, dead: false }
      timers.push(t)
      return () => void (t.dead = true)
    }
  }
  const core = new RoomCore(env)
  const advance = (ms: number): void => {
    now += ms
    for (const t of [...timers]) {
      if (t.dead || t.at > now) continue
      t.dead = true
      t.fn()
    }
  }
  return { core, env, advance, setNow: (v: number) => void (now = v), getNow: () => now }
}

async function withHost(r: ReturnType<typeof rig>): Promise<FakeWs> {
  const host = new FakeWs()
  expect(await r.core.acceptHost(host, ROOM, TOKEN)).toBe(true)
  return host
}

const hello = JSON.stringify({ t: 'hello', v: 4, mode: 'resume', deviceId: 'a'.repeat(32) })

describe('RoomCore: host', () => {
  it('token correcto entra; incorrecto o de otra sala se cierra', async () => {
    const r = rig()
    const ok = new FakeWs()
    expect(await r.core.acceptHost(ok, ROOM, TOKEN)).toBe(true)
    expect(ok.closed).toBeNull()
    const bad = new FakeWs()
    expect(
      await rig().core.acceptHost(
        bad,
        ROOM,
        newHostToken(() => new Uint8Array(32).fill(9))
      )
    ).toBe(false)
    expect(bad.closed?.code).toBe(1008)
    const other = new FakeWs()
    expect(await rig().core.acceptHost(other, roomOfToken('x'.repeat(43)), TOKEN)).toBe(false)
  })

  it('un host nuevo sustituye al anterior y los celulares en curso reciben host-offline', async () => {
    const r = rig()
    const h1 = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    const h2 = new FakeWs()
    await r.core.acceptHost(h2, ROOM, TOKEN)
    expect(h1.closed?.reason).toBe('replaced')
    expect(p.json().at(-1)).toEqual({ t: 'error', code: 'host-offline' })
    expect(p.closed).not.toBeNull()
    // el cierre tardío del socket viejo no derriba al nuevo
    r.core.onClose(h1)
    const p2 = new FakeWs()
    r.core.acceptPeer(p2)
    expect(h2.json().at(-1)).toMatchObject({ t: 'peer' })
  })

  it('responde pong a un ping de aplicación y cierra ante basura', async () => {
    const r = rig()
    const h = await withHost(r)
    r.core.onMessage(h, 'ping')
    expect(h.sent).toEqual(['pong'])
    r.core.onMessage(h, '{"t":"raro"}')
    expect(h.closed?.code).toBe(1008)
  })
})

describe('RoomCore: celulares', () => {
  it('sin host: host-offline y cierre', () => {
    const r = rig()
    const p = new FakeWs()
    r.core.acceptPeer(p)
    expect(p.json()).toEqual([{ t: 'error', code: 'host-offline' }])
    expect(p.closed).not.toBeNull()
  })

  it('host «muerto» (sin respuesta al ping desde hace más de 150 s): host-offline', async () => {
    const r = rig()
    const h = await withHost(r)
    h.alive = r.getNow()
    r.advance(CLOUD_LIMITS.hostDeadMs - 1_000)
    const p1 = new FakeWs()
    r.core.acceptPeer(p1)
    expect(p1.closed).toBeNull()
    r.advance(CLOUD_LIMITS.hostDeadMs + 5_000)
    const p2 = new FakeWs()
    r.core.acceptPeer(p2)
    expect(p2.json()).toEqual([{ t: 'error', code: 'host-offline' }])
  })

  it('reenvía el hello al Mac y las respuestas al celular, tal cual', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    const id = h.json()[0].id as string
    expect(h.json()[0]).toEqual({ t: 'peer', id })
    r.core.onMessage(p, hello)
    expect(h.json()[1]).toEqual({ t: 'from', id, d: hello })
    r.core.onMessage(h, JSON.stringify({ t: 'to', id, d: '{"t":"ready"}' }))
    await tick()
    expect(p.sent).toEqual(['{"t":"ready"}'])
    r.core.onClose(p)
    expect(h.json().at(-1)).toEqual({ t: 'gone', id })
  })

  it('el Mac no contesta ready/error en 5 s: host-offline', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    r.core.onMessage(p, hello)
    r.advance(CLOUD_LIMITS.readyMs - 100)
    expect(p.closed).toBeNull()
    r.advance(200)
    expect(p.json().at(-1)).toEqual({ t: 'error', code: 'host-offline' })
    expect(h.json().at(-1)).toMatchObject({ t: 'gone' })
  })

  it('si el Mac contesta a tiempo no hay corte a los 5 s', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    r.core.onMessage(p, hello)
    const id = h.json()[0].id as string
    r.core.onMessage(h, JSON.stringify({ t: 'to', id, d: '{"t":"ready"}' }))
    r.advance(CLOUD_LIMITS.readyMs + 1_000)
    expect(p.closed).toBeNull()
  })

  it('texto mayor de 32 KiB, binario y vacío: error frame', async () => {
    for (const bad of ['x'.repeat(CLOUD_LIMITS.maxRelayBytes + 1), new ArrayBuffer(4), '']) {
      const r = rig()
      await withHost(r)
      const p = new FakeWs()
      r.core.acceptPeer(p)
      r.core.onMessage(p, bad)
      expect(p.json().at(-1)).toEqual({ t: 'error', code: 'frame' })
    }
  })

  it('más de 80 tramas: se corta', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    for (let i = 0; i < CLOUD_LIMITS.maxPeerFrames; i++) r.core.onMessage(p, 'x')
    expect(p.closed).toBeNull()
    r.core.onMessage(p, 'x')
    expect(p.closed).not.toBeNull()
    expect(h.json().filter((f) => f.t === 'from')).toHaveLength(CLOUD_LIMITS.maxPeerFrames)
  })

  it('más de 60 s en señalización: se cierra', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    r.advance(CLOUD_LIMITS.peerLifetimeMs - 1)
    expect(p.closed).toBeNull()
    r.advance(2)
    expect(p.closed).not.toBeNull()
    expect(h.json().at(-1)).toMatchObject({ t: 'gone' })
  })

  it('un tercer celular recibe busy', async () => {
    const r = rig()
    await withHost(r)
    r.core.acceptPeer(new FakeWs())
    r.core.acceptPeer(new FakeWs())
    const third = new FakeWs()
    r.core.acceptPeer(third)
    expect(third.json()).toEqual([{ t: 'error', code: 'busy' }])
  })

  it('31 celulares en un minuto: el 31.º recibe rate; pasado el minuto vuelve a admitir', async () => {
    const r = rig()
    await withHost(r)
    for (let i = 0; i < CLOUD_LIMITS.peersPerMinute; i++) {
      const p = new FakeWs()
      r.core.acceptPeer(p)
      r.core.onClose(p) // se va enseguida: no ocupa hueco
    }
    const p31 = new FakeWs()
    r.core.acceptPeer(p31)
    expect(p31.json()).toEqual([{ t: 'error', code: 'rate' }])
    r.advance(61_000)
    const again = new FakeWs()
    r.core.acceptPeer(again)
    expect(again.closed).toBeNull()
  })

  it('to + kick seguidos: el celular recibe el mensaje ANTES de que se cierre', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    const id = h.json()[0].id as string
    r.core.onMessage(h, JSON.stringify({ t: 'to', id, d: '{"t":"error","code":"invalid"}' }))
    r.core.onMessage(h, JSON.stringify({ t: 'kick', id }))
    await tick()
    expect(p.sent).toEqual(['{"t":"error","code":"invalid"}'])
    expect(p.closed).not.toBeNull()
  })

  it('kick del Mac cierra al celular sin avisarle de más', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    const id = h.json()[0].id as string
    r.core.onMessage(h, JSON.stringify({ t: 'kick', id }))
    await tick()
    expect(p.closed).not.toBeNull()
    expect(p.sent).toEqual([])
  })

  it('cuando se cae el host, los celulares reciben host-offline', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    r.core.onClose(h)
    expect(p.json().at(-1)).toEqual({ t: 'error', code: 'host-offline' })
  })
})

describe('RoomCore: TURN solo tras grant y antes de la siguiente trama', () => {
  it('turn llega al Mac y al celular ANTES del ready que sigue al grant', async () => {
    let release: (v: IceServerSpec[]) => void = () => undefined
    const r = rig({ turn: () => new Promise((res) => void (release = res)) })
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    r.core.onMessage(p, hello)
    const id = h.json()[0].id as string
    // sin grant no hay TURN
    await tick()
    expect(p.sent).toEqual([])
    r.core.onMessage(h, JSON.stringify({ t: 'grant', id }))
    r.core.onMessage(h, JSON.stringify({ t: 'to', id, d: '{"t":"ready"}' }))
    await tick()
    expect(p.sent).toEqual([]) // el ready espera al TURN
    release(SERVERS)
    await tick()
    expect(p.json()).toEqual([{ t: 'turn', servers: SERVERS }, { t: 'ready' }])
    expect(h.json().find((f) => f.t === 'turn')).toEqual({ t: 'turn', id, servers: SERVERS })
  })

  it('fetchTurn que falla o devuelve null: sin turn y el ready sale igual', async () => {
    for (const turn of [async () => null, async () => Promise.reject(new Error('red'))]) {
      const r = rig({ turn })
      const h = await withHost(r)
      const p = new FakeWs()
      r.core.acceptPeer(p)
      r.core.onMessage(p, hello)
      const id = h.json()[0].id as string
      r.core.onMessage(h, JSON.stringify({ t: 'grant', id }))
      r.core.onMessage(h, JSON.stringify({ t: 'to', id, d: '{"t":"ready"}' }))
      await tick()
      expect(p.json()).toEqual([{ t: 'ready' }])
      expect(h.json().some((f) => f.t === 'turn')).toBe(false)
    }
  })

  it('sin fetchTurn (TURN apagado) un grant no hace nada', async () => {
    const r = rig()
    const h = await withHost(r)
    const p = new FakeWs()
    r.core.acceptPeer(p)
    const id = h.json()[0].id as string
    r.core.onMessage(h, JSON.stringify({ t: 'grant', id }))
    await tick()
    expect(p.sent).toEqual([])
  })

  it('el grant número 21 de la hora no recibe TURN; pasada la hora sí', async () => {
    let calls = 0
    const r = rig({
      turn: async () => {
        calls++
        return SERVERS
      }
    })
    const h = await withHost(r)
    const grant = async (): Promise<FakeWs> => {
      const p = new FakeWs()
      r.core.acceptPeer(p)
      const id = h
        .json()
        .filter((f) => f.t === 'peer')
        .at(-1)?.id as string
      r.core.onMessage(h, JSON.stringify({ t: 'grant', id }))
      await tick()
      return p
    }
    for (let i = 0; i < CLOUD_LIMITS.grantsPerHour; i++) {
      const p = await grant()
      expect(p.json().some((f) => f.t === 'turn')).toBe(true)
      r.core.onClose(p)
      r.advance(CLOUD_LIMITS.peerLifetimeMs / 10) // 6 s: no se llega al tope de celulares/min (30)
    }
    const p21 = await grant()
    expect(p21.json().some((f) => f.t === 'turn')).toBe(false)
    expect(calls).toBe(CLOUD_LIMITS.grantsPerHour)
    r.core.onClose(p21)
    r.advance(3_600_001)
    h.alive = r.getNow()
    const later = await grant()
    expect(later.json().some((f) => f.t === 'turn')).toBe(true)
  })

  it('grant de un celular que ya no está se ignora', async () => {
    const r = rig({ turn: async () => SERVERS })
    const h = await withHost(r)
    r.core.onMessage(h, JSON.stringify({ t: 'grant', id: 'noexiste1' }))
    await tick()
    expect(h.json()).toEqual([])
  })
})

describe('RoomCore: hibernación', () => {
  it('restore reconstruye host y celulares desde los adjuntos y conserva los contadores', async () => {
    const r1 = rig()
    const h = await withHost(r1)
    const p = new FakeWs()
    r1.core.acceptPeer(p)
    r1.core.onMessage(p, hello)
    // el DO «despierta»: núcleo nuevo con los mismos sockets y sus adjuntos
    const r2 = rig()
    r2.setNow(r1.getNow())
    r2.core.restore([
      { ws: h, att: h.att },
      { ws: p, att: p.att }
    ])
    const id = (p.att as { id: string }).id
    r2.core.onMessage(h, JSON.stringify({ t: 'to', id, d: '{"t":"ready"}' }))
    await tick()
    expect(p.sent).toEqual(['{"t":"ready"}'])
    // el límite de celulares/min sobrevive
    expect((h.att as { joins: number[] }).joins).toHaveLength(1)
    // sin adjunto: se cierra
    const orphan = new FakeWs()
    r2.core.restore([{ ws: orphan, att: null }])
    expect(orphan.closed?.code).toBe(1008)
  })
})

describe('entrada: routeEdge', () => {
  const cfg = { allowedOrigins: parseAllowedOrigins(undefined) }
  const base = { method: 'GET', upgrade: 'websocket', origin: null, hostToken: null }

  it('ALLOWED_ORIGINS: por defecto el sitio oficial; ignora valores raros', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([CLOUD_ORIGIN])
    expect(parseAllowedOrigins('http://x.com, https://a.b ,*')).toEqual(['https://a.b'])
  })

  it('host: token válido -> sala; sin token, malo, con Origin o sin upgrade se rechazan', async () => {
    expect(await routeEdge({ ...base, pathname: '/v1/host', hostToken: TOKEN }, cfg)).toEqual({ kind: 'host', room: ROOM, token: TOKEN })
    expect(await routeEdge({ ...base, pathname: '/v1/host' }, cfg)).toEqual({ kind: 'reject', status: 401 })
    expect(await routeEdge({ ...base, pathname: '/v1/host', hostToken: 'corto' }, cfg)).toEqual({ kind: 'reject', status: 401 })
    expect(await routeEdge({ ...base, pathname: '/v1/host', hostToken: TOKEN, origin: CLOUD_ORIGIN }, cfg)).toEqual({
      kind: 'reject',
      status: 403
    })
    expect(await routeEdge({ ...base, pathname: '/v1/host', hostToken: TOKEN, upgrade: null }, cfg)).toEqual({
      kind: 'reject',
      status: 426
    })
    expect(await routeEdge({ ...base, method: 'POST', pathname: '/v1/host', hostToken: TOKEN }, cfg)).toEqual({
      kind: 'reject',
      status: 405
    })
  })

  it('peer: sala válida y Origin oficial pasan; sala con nombre inválido se rechaza SIN crear sala', async () => {
    const ok = { ...base, origin: CLOUD_ORIGIN }
    expect(await routeEdge({ ...ok, pathname: `/v1/peer/${ROOM}` }, cfg)).toEqual({ kind: 'peer', room: ROOM })
    for (const bad of ['', 'corta', `${ROOM}x`, `${ROOM.slice(1)}!`, '../host', `${ROOM}/extra`])
      expect(await routeEdge({ ...ok, pathname: `/v1/peer/${bad}` }, cfg), bad).toEqual({ kind: 'reject', status: 404 })
  })

  it('peer: Origin ajeno o ausente = 403', async () => {
    for (const origin of ['https://evil.example', CLOUD_ORIGIN.replace('https:', 'http:'), null, 'null'])
      expect(await routeEdge({ ...base, origin, pathname: `/v1/peer/${ROOM}` }, cfg)).toEqual({ kind: 'reject', status: 403 })
  })

  it('otras rutas /v1/* son 404 y lo demás pasa a los estáticos', async () => {
    expect(await routeEdge({ ...base, pathname: '/v1/otra' }, cfg)).toEqual({ kind: 'reject', status: 404 })
    expect(await routeEdge({ ...base, pathname: '/v1' }, cfg)).toEqual({ kind: 'reject', status: 404 })
    expect(await routeEdge({ ...base, pathname: '/index.html' }, cfg)).toEqual({ kind: 'pass' })
  })
})

describe('TURN: credenciales', () => {
  const env = { TURN_ENABLED: 'true', TURN_KEY_ID: 'abcdef123456', TURN_KEY_API_TOKEN: 'x'.repeat(32) }
  const okFetch =
    (iceServers: unknown): FetchLike =>
    async () => ({ ok: true, json: async () => ({ iceServers }) })

  it('apagado o sin secretos: null y NO se llama a fetch', async () => {
    let called = false
    const f: FetchLike = async () => ((called = true), { ok: true, json: async () => ({}) })
    for (const e of [{}, { ...env, TURN_ENABLED: 'false' }, { ...env, TURN_KEY_ID: undefined }, { ...env, TURN_KEY_API_TOKEN: 'corto' }]) {
      expect(turnConfigured(e)).toBe(false)
      expect(await fetchTurnServers(e, f)).toBeNull()
    }
    expect(called).toBe(false)
  })

  it('acepta la lista y el objeto único, y manda el token en la cabecera y el ttl de 8 h', async () => {
    let seen: { url: string; init: Parameters<FetchLike>[1] } | null = null
    const f: FetchLike = async (url, init) => ((seen = { url, init }), { ok: true, json: async () => ({ iceServers: SERVERS }) })
    expect(await fetchTurnServers(env, f)).toEqual(SERVERS)
    expect(seen!.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/abcdef123456/credentials/generate-ice-servers')
    expect(seen!.init.headers.Authorization).toBe(`Bearer ${'x'.repeat(32)}`)
    expect(JSON.parse(seen!.init.body)).toEqual({ ttl: 28800 })
    expect(await fetchTurnServers(env, okFetch(SERVERS[0]))).toEqual(SERVERS)
  })

  it('error de red, estado malo, forma rara o servidor ajeno: null', async () => {
    expect(await fetchTurnServers(env, async () => Promise.reject(new Error('red')))).toBeNull()
    expect(await fetchTurnServers(env, async () => ({ ok: false, json: async () => ({}) }))).toBeNull()
    expect(await fetchTurnServers(env, okFetch('raro'))).toBeNull()
    expect(await fetchTurnServers(env, okFetch([{ urls: ['turn:evil.example.com:3478'], username: 'u', credential: 'c' }]))).toBeNull()
    expect(await fetchTurnServers(env, async () => ({ ok: true, json: async () => Promise.reject(new Error('json')) }))).toBeNull()
  })
})

describe('el servicio no guarda nada ni registra datos', () => {
  const dirs = [join(__dirname), join(__dirname, '../../../cloud/remoto-worker/src')]
  const files = dirs.flatMap((d) =>
    readdirSync(d)
      .filter((f) => /^(room-core|cloud-edge|cloud-turn|cloud)\.ts$|^(index|room|turn)\.ts$/.test(f) && !f.endsWith('.test.ts'))
      .map((f) => join(d, f))
  )

  it('hay archivos que revisar', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('ningún archivo del servicio escribe en almacenamiento, usa alarmas ni imprime con console', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/storage\s*\.\s*(put|delete|setAlarm|sql|transaction)|setAlarm\s*\(|\bconsole\s*\./)
    }
  })

  it('wrangler.jsonc: observabilidad apagada y DO con SQLite sin tablas propias', () => {
    const w = readFileSync(join(__dirname, '../../../cloud/remoto-worker/wrangler.jsonc'), 'utf8')
    expect(w).toMatch(/"observability"\s*:\s*\{\s*"enabled"\s*:\s*false/)
    expect(w).toMatch(/new_sqlite_classes/)
    expect(w.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/TURN_KEY|API_TOKEN/)
  })
})
