import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteClient, type FailReason } from '../../pwa/src/client'
import { isCloudMode, isTravelMode } from '../../pwa/src/mode'
import { TRAVEL_ICE_TIMEOUT_MS, iceServersFor, openLink, type LinkEnd } from '../../pwa/src/rtc'
import { idbLinkStore, type CloudLink, type LinkStore } from '../../pwa/src/store'
import { t as tr } from '../../pwa/src/i18n'
import { CLOUD_ORIGIN } from '../shared/remote/cloud'
import { TRAVEL_STUN_URLS, TRAVEL_WS_RETRY } from '../shared/remote/travel'

describe('PWA › origen del túnel', () => {
  it('solo HTTPS y el patrón exacto https://<palabras>.trycloudflare.com', () => {
    expect(isTravelMode('https://horizontal-aircraft-tamil-weekend.trycloudflare.com', true)).toBe(true)
    expect(isTravelMode('https://ian-hope.trycloudflare.com', true)).toBe(true)
    for (const o of [
      'http://ian-hope.trycloudflare.com',
      'https://ian-hope.trycloudflare.com:8443',
      'https://ian-hope.trycloudflare.com.evil.com',
      'https://evil.com/ian-hope.trycloudflare.com',
      'https://trycloudflare.com',
      'https://solouna.trycloudflare.com',
      'https://a.b.ian-hope.trycloudflare.com',
      'http://192.168.1.20:5555',
      CLOUD_ORIGIN
    ])
      expect(isTravelMode(o, true), o).toBe(false)
    expect(isTravelMode('https://ian-hope.trycloudflare.com', false)).toBe(false)
  })
  it('no se confunde con el modo nube', () => {
    expect(isCloudMode('https://ian-hope.trycloudflare.com', true)).toBe(false)
  })
})

describe('PWA › servidores ICE del modo viaje', () => {
  it('solo los STUN sin cuenta, sin relé aunque llegue uno', () => {
    const turn = [{ urls: ['turn:x:3478'], username: 'u', credential: 'c' }]
    expect(iceServersFor({ kind: 'travel' }, turn)).toEqual([{ urls: [...TRAVEL_STUN_URLS] }])
    expect(JSON.stringify(iceServersFor({ kind: 'travel' }, turn))).not.toContain('turn:')
  })
})

// ── enlace con WebSocket y RTCPeerConnection falsos ──
class FakeWS {
  static OPEN = 1
  static all: FakeWS[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  url: string
  constructor(url: string) {
    this.url = url
    FakeWS.all.push(this)
  }
  send(s: string): void {
    this.sent.push(s)
  }
  close(): void {
    this.readyState = 3
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
  fail(): void {
    this.readyState = 3
    this.onclose?.()
  }
}
class FakePC {
  connectionState = 'new'
  localDescription = { sdp: 'v=0' }
  remoteDescription = null
  onicecandidate: unknown = null
  onconnectionstatechange: unknown = null
  createDataChannel() {
    return { bufferedAmountLowThreshold: 0, close: () => undefined } as unknown as RTCDataChannel
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0' }
  }
  async setLocalDescription() {}
  close(): void {}
}

const hello = { t: 'hello', v: 3, mode: 'resume', deviceId: 'a'.repeat(32) } as Parameters<typeof openLink>[0]

describe('PWA › enlace en modo viaje', () => {
  const g = globalThis as Record<string, unknown>
  const saved: Record<string, unknown> = {}
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWS.all = []
    for (const k of ['WebSocket', 'RTCPeerConnection', 'location']) saved[k] = g[k]
    g.WebSocket = FakeWS
    g.RTCPeerConnection = FakePC
    g.location = { protocol: 'https:', host: 'ian-hope.trycloudflare.com' }
  })
  afterEach(() => {
    vi.useRealTimers()
    for (const k of Object.keys(saved)) g[k] = saved[k]
  })
  const ends = (): { list: LinkEnd[]; h: Parameters<typeof openLink>[1] } => {
    const list: LinkEnd[] = []
    return { list, h: { onOpen: () => undefined, onMessage: () => undefined, onEnd: (w) => list.push(w) } }
  }

  it('señaliza por wss:// en /ws del propio origen del túnel', () => {
    const { h } = ends()
    openLink(hello, h, { kind: 'travel' })
    expect(FakeWS.all[0]?.url).toBe('wss://ian-hope.trycloudflare.com/ws')
  })

  it('un 522 al abrir el WebSocket se reintenta con las esperas fijadas y luego falla como «no-host»', async () => {
    const { list, h } = ends()
    openLink(hello, h, { kind: 'travel' })
    for (let i = 0; i < TRAVEL_WS_RETRY.maxAttempts; i++) {
      expect(FakeWS.all).toHaveLength(i + 1)
      FakeWS.all[i]?.fail()
      expect(list).toEqual([])
      await vi.advanceTimersByTimeAsync((TRAVEL_WS_RETRY.delaysMs[i] ?? 0) - 1)
      expect(FakeWS.all).toHaveLength(i + 1)
      await vi.advanceTimersByTimeAsync(1)
    }
    expect(FakeWS.all).toHaveLength(TRAVEL_WS_RETRY.maxAttempts + 1)
    FakeWS.all[TRAVEL_WS_RETRY.maxAttempts]?.fail()
    expect(list).toEqual([{ k: 'no-host' }])
  })

  it('si un reintento abre bien, sigue el flujo normal (hello enviado)', async () => {
    const { list, h } = ends()
    openLink(hello, h, { kind: 'travel' })
    FakeWS.all[0]?.fail()
    await vi.advanceTimersByTimeAsync(TRAVEL_WS_RETRY.delaysMs[0])
    FakeWS.all[1]?.open()
    expect(FakeWS.all[1]?.sent[0]).toContain('"t":"hello"')
    expect(list).toEqual([])
  })

  it('la red local NO reintenta: cierra enseguida', () => {
    const { list, h } = ends()
    g.location = { protocol: 'http:', host: '192.168.1.20:5555' }
    openLink(hello, h, { kind: 'lan' })
    FakeWS.all[0]?.fail()
    expect(list).toEqual([{ k: 'no-host' }])
    expect(FakeWS.all).toHaveLength(1)
  })

  it('con señalización buena pero sin canal en 12 s termina con «ice-failed»', async () => {
    const { list, h } = ends()
    openLink(hello, h, { kind: 'travel' })
    const ws = FakeWS.all[0] as FakeWS
    ws.open()
    ws.onmessage?.({ data: JSON.stringify({ t: 'ready' }) })
    await vi.advanceTimersByTimeAsync(TRAVEL_ICE_TIMEOUT_MS - 1)
    expect(list).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(list).toEqual([{ k: 'ice-failed' }])
    expect(TRAVEL_ICE_TIMEOUT_MS).toBe(12_000)
  })

  it('la red local sin canal sigue siendo «no-host» (sin cambios)', async () => {
    const { list, h } = ends()
    g.location = { protocol: 'http:', host: '192.168.1.20:5555' }
    openLink(hello, h, { kind: 'lan' })
    const ws = FakeWS.all[0] as FakeWS
    ws.open()
    ws.onmessage?.({ data: JSON.stringify({ t: 'ready' }) })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(list).toEqual([{ k: 'no-host' }])
  })
})

// ── cliente: estados y caducidad ──
function fakeStore(link: CloudLink | null = null): LinkStore & { cleared: number } {
  const s = {
    cleared: 0,
    load: async () => link,
    save: async () => undefined,
    clear: async () => {
      s.cleared++
    }
  }
  return s
}
const aLink = { deviceId: 'a'.repeat(32), key: {} as CryptoKey, room: '', macName: '', pairedAt: 1 } satisfies CloudLink

interface Priv {
  onBye(r: string): void
  onLinkEnd(w: LinkEnd): void
  macVerified: boolean
  mode: 'pair' | 'resume'
  clink: CloudLink | null
  attempt: number
  everOnline: boolean
  connect(): void
}
const priv = (c: RemoteClient): Priv => c as unknown as Priv

describe('PWA › cliente en modo viaje', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const mk = async (link: CloudLink | null = aLink) => {
    const store = fakeStore(link)
    const c = new RemoteClient({ travel: true, store })
    await vi.advanceTimersByTimeAsync(0)
    const p = priv(c)
    p.connect = vi.fn() // no abre enlaces reales
    return { c, p, store }
  }
  const reason = (c: RemoteClient): FailReason | null => (c.state.conn.k === 'failed' ? c.state.conn.reason : null)

  it('arranca marcado como viaje y con el vínculo de este origen', async () => {
    const { c } = await mk()
    expect(c.state.travel).toBe(true)
    expect(c.state.cloud).toBe(false)
    expect(c.state.paired).toBe(true)
  })

  it('bye «travel-ended» (con prueba del Mac) borra el vínculo y lo explica', async () => {
    const { c, p, store } = await mk()
    p.macVerified = true
    p.onBye('travel-ended')
    expect(reason(c)).toBe('travel-ended')
    expect(c.state.conn).toMatchObject({ k: 'failed', canRetry: false })
    expect(c.state.paired).toBe(false)
    expect(p.clink).toBeNull()
    expect(store.cleared).toBe(1)
    expect(tr('fail.title.travel-ended')).toBe('Modo viaje cerrado')
    expect(tr('fail.body.travel-ended')).toContain('se borró de este celular')
  })

  it('bye «travel-ended» sin prueba del Mac NO borra nada (puede ser inyectado)', async () => {
    const { c, p, store } = await mk()
    p.macVerified = false
    p.onBye('travel-ended')
    expect(reason(c)).toBe('not-recognized')
    expect(c.state.paired).toBe(true)
    expect(store.cleared).toBe(0)
  })

  it('pair: sin llegar al túnel = «el enlace caducó»; canal cerrado = «el Mac no responde»; ICE = «tu red bloquea»', async () => {
    const a = await mk()
    a.p.mode = 'pair'
    a.p.onLinkEnd({ k: 'no-host' })
    expect(reason(a.c)).toBe('travel-link')
    const b = await mk()
    b.p.mode = 'pair'
    b.p.onLinkEnd({ k: 'closed' })
    expect(reason(b.c)).toBe('travel-mac')
    const d = await mk()
    d.p.mode = 'pair'
    d.p.onLinkEnd({ k: 'ice-failed' })
    expect(reason(d.c)).toBe('travel-ice')
  })

  it('reconexión: reintenta con espera y al agotarlos queda el motivo claro, sin borrar el vínculo', async () => {
    const { c, p, store } = await mk()
    p.mode = 'resume'
    p.everOnline = false
    for (let i = 0; i < 20 && reason(c) === null; i++) {
      p.onLinkEnd({ k: 'no-host' })
      await vi.advanceTimersByTimeAsync(60_000)
    }
    expect(reason(c)).toBe('travel-link')
    expect(c.state.paired).toBe(true)
    expect(store.cleared).toBe(0)
  })

  it('hay texto es/en para cada motivo del modo viaje', () => {
    for (const r of ['travel-link', 'travel-mac', 'travel-ice', 'travel-ended'])
      for (const k of [`fail.title.${r}`, `fail.body.${r}`]) expect(tr(k), k).not.toBe(k)
    expect(tr('fail.title.travel-link')).toBe('El enlace caducó')
    expect(tr('fail.title.travel-mac')).toBe('El Mac no responde')
    expect(tr('fail.title.travel-ice')).toBe('Tu red bloquea la conexión directa')
    expect(tr('idle.travel.noInstall')).toContain('No se puede instalar como app')
  })
})

describe('PWA › almacén del vínculo de viaje (sin sala)', () => {
  it('rechaza una sala en modo viaje y acepta la vacía; en la nube sigue exigiendo sala', async () => {
    const mem = new Map<string, unknown>()
    const factory = {
      open() {
        const req: Record<string, unknown> = {}
        queueMicrotask(() => {
          const db = {
            objectStoreNames: { contains: () => true },
            createObjectStore: () => undefined,
            close: () => undefined,
            transaction: () => ({
              objectStore: () => ({
                get: (k: string) => done(mem.get(k)),
                put: (v: unknown, k: string) => done(mem.set(k, v) && undefined),
                delete: (k: string) => done(mem.delete(k) && undefined)
              })
            })
          }
          req.result = db
          ;(req.onsuccess as () => void)()
        })
        return req
      }
    } as unknown as IDBFactory
    function done(v: unknown) {
      const r: Record<string, unknown> = { result: v }
      queueMicrotask(() => (r.onsuccess as () => void)())
      return r
    }
    const travelStore = idbLinkStore(factory, { roomless: true })
    await travelStore.save(aLink)
    expect((await travelStore.load())?.deviceId).toBe(aLink.deviceId)
    await expect(travelStore.save({ ...aLink, room: 'R'.repeat(43) })).rejects.toThrow()
    const cloudStore = idbLinkStore(factory)
    expect(await cloudStore.load()).toBeNull() // un vínculo sin sala no vale como vínculo de nube
    await expect(cloudStore.save(aLink)).rejects.toThrow()
  })
})
