/**
 * Cliente del control remoto: máquina de estados de la conexión, vinculación, reconexión acotada, peticiones de la lista
 * blanca y estado de sesiones/chat. No toca el DOM (eso es `ui.ts`). Nunca registra ni muestra secretos.
 */
import { pairingCode } from '../../src/shared/remote/code'
import {
  DEVICE_ID_RE,
  LIMITS,
  PROTOCOL_VERSION,
  SECRET_RE,
  encodeFrame,
  isMuxHostFrame,
  parseHostFrame,
  utf8Length,
  type ClientFrame,
  type HostFrame,
  type LockWhy,
  type RemoteErrorCode,
  type RemoteEvent,
  type RemoteMessage,
  type RemotePermission,
  type RemoteSession,
  type Reply,
  type RequestMethod,
  type RequestParams,
  type RequestResults
} from '../../src/shared/remote/protocol'
import { Mux, Outbox, type HttpRequest, type SubHandlers, type Subscription } from '../../src/shared/remote/mux'
import { openLink, type Link, type LinkEnd } from './rtc'

const STORE_KEY = 'onyx.pwa.device'
const REQUEST_TIMEOUT_MS = 15_000
const PING_EVERY_MS = 20_000
const PONG_WITHIN_MS = 8_000
const WAKE_PROBE_MS = 4_000
const TOAST_MS = 4_000
const MAX_CHAT_MESSAGES = 200
const MAX_BAD_FRAMES = 3
/** Reintentos tras perder una conexión que ya había funcionado (espera en ms antes de cada uno). */
export const RECONNECT_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000]
/** Reintentos si la primera conexión (reanudar) no llega al equipo. */
const FIRST_RESUME_DELAYS = [2_000]

export type FailReason =
  | 'no-host'
  | 'expired'
  | 'revoked'
  | 'denied'
  | 'denied-timeout'
  | 'denied-limit'
  | 'stopped'
  | 'other-device'
  | 'rate'
  | 'busy'
  | 'version'
  | 'unreachable'
  | 'protocol'
  | 'unsupported'

export type Conn =
  | { k: 'idle' }
  | { k: 'connecting'; mode: 'pair' | 'resume' }
  | { k: 'pairing'; code: string | null; pending: boolean }
  | { k: 'online' }
  /** Canal autenticado pero sin acceso: el Mac espera su confirmación, el PIN (fijarlo/verificarlo) o lo bloqueó por inactividad. */
  | { k: 'locked'; why: LockWhy; retryMs?: number; left?: number }
  | { k: 'reconnecting'; attempt: number; max: number }
  | { k: 'failed'; reason: FailReason; canRetry: boolean }

export interface ChatState {
  id: string
  messages: RemoteMessage[]
  hasMore: boolean
  loading: boolean
  loadingOlder: boolean
}

export interface Snapshot {
  conn: Conn
  /** `null` = aún no se ha cargado. */
  sessions: RemoteSession[] | null
  permissions: RemotePermission[]
  chat: ChatState | null
  toast: { key: string; n: number } | null
  /** Hay credenciales guardadas (se puede «olvidar» la vinculación). */
  paired: boolean
}

interface Creds {
  id: string
  secret: string
}

interface Pending {
  m: RequestMethod
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function loadCreds(): Creds | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { id?: unknown; secret?: unknown }
    if (typeof o.id === 'string' && DEVICE_ID_RE.test(o.id) && typeof o.secret === 'string' && SECRET_RE.test(o.secret))
      return { id: o.id, secret: o.secret }
  } catch {
    /* almacenamiento bloqueado o dañado */
  }
  return null
}

function saveCreds(c: Creds): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(c))
  } catch {
    /* sin almacenamiento: la vinculación durará solo esta pestaña */
  }
}

function clearCreds(): void {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* nada */
  }
}

/** Nombre legible del dispositivo para la ventana de confirmación del Mac. */
export function deviceName(): string {
  let ua = ''
  try {
    ua = navigator.userAgent
  } catch {
    /* nada */
  }
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : 'Celular'
  const br = /EdgA?\//.test(ua)
    ? 'Edge'
    : /Firefox|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari/.test(ua)
          ? 'Safari'
          : ''
  return br ? `${os} · ${br}` : os
}

const ERR_TOAST: Record<RemoteErrorCode, string> = {
  'bad-request': 'toast.failed',
  'rate-limited': 'toast.rate',
  'not-found': 'toast.notFound',
  forbidden: 'toast.forbidden',
  busy: 'toast.busy',
  unavailable: 'toast.unavailable',
  failed: 'toast.failed'
}

export class RemoteClient {
  private snap: Snapshot
  private readonly listeners = new Set<(s: Snapshot) => void>()
  private link: Link | null = null
  private creds: Creds | null
  /** Secreto del QR: solo en memoria, nunca se guarda ni se muestra. */
  private pairSecret: string | null = null
  private mode: 'pair' | 'resume' = 'resume'
  private authed = false
  private everOnline = false
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private nextId = 1
  /** Multiplexor v2 de la conexión actual (existe solo con la sesión autenticada). */
  private mux: Mux | null = null
  private outbox: Outbox | null = null
  private readonly pending = new Map<number, Pending>()
  private promptTimes: number[] = []
  private badFrames = 0
  private toastN = 0
  private touched = new Set<string>()
  private generation = 0
  /** `false` cuando la interfaz completa está cargada: ella lee sus datos por el puente y no hace falta la lista ligera. */
  lightData = true

  constructor() {
    this.creds = loadCreds()
    this.snap = { conn: { k: 'idle' }, sessions: null, permissions: [], chat: null, toast: null, paired: this.creds !== null }
  }

  // ── suscripción ──

  get state(): Snapshot {
    return this.snap
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const fn of [...this.listeners]) fn(this.snap)
  }

  private toast(key: string): void {
    this.toastN++
    this.set({ toast: { key, n: this.toastN } })
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.set({ toast: null }), TOAST_MS)
  }

  // ── arranque ──

  /** `secret`: el valor `s` del fragmento de la URL (ya extraído y borrado de la barra por quien llama). */
  start(secret: string | null): void {
    if (secret && SECRET_RE.test(secret)) {
      // Un QR nuevo (también si llega con la página ya abierta) reinicia todo el estado.
      this.pairSecret = secret
      this.mode = 'pair'
      this.attempt = 0
      this.everOnline = false
      this.set({ sessions: null, permissions: [], chat: null })
      this.connect()
    } else if (this.creds) {
      this.mode = 'resume'
      this.connect()
    } else this.set({ conn: { k: 'idle' } })
  }

  /** Botón «Reintentar». */
  retry(): void {
    if (this.snap.conn.k !== 'failed') return
    this.attempt = 0
    this.connect()
  }

  /** «Olvidar vinculación»: borra el secreto de este celular (no avisa al Mac: se quita desde sus Ajustes). */
  forget(): void {
    this.teardown()
    clearCreds()
    this.creds = null
    this.pairSecret = null
    this.everOnline = false
    this.set({ conn: { k: 'idle' }, sessions: null, permissions: [], chat: null, paired: false })
  }

  // ── conexión ──

  private connect(): void {
    this.teardown()
    const gen = ++this.generation
    this.authed = false
    this.badFrames = 0
    const mode = this.mode
    if (mode === 'pair' && !this.pairSecret) return this.fail('expired', false)
    if (mode === 'resume' && !this.creds) return this.set({ conn: { k: 'idle' } })
    if (this.attempt > 0 && this.everOnline) this.set({ conn: { k: 'reconnecting', attempt: this.attempt, max: RECONNECT_DELAYS.length } })
    else this.set({ conn: { k: 'connecting', mode } })
    const hello =
      mode === 'pair'
        ? ({ t: 'hello', v: PROTOCOL_VERSION, mode: 'pair', secret: this.pairSecret as string, deviceName: deviceName() } as const)
        : ({ t: 'hello', v: PROTOCOL_VERSION, mode: 'resume', deviceId: (this.creds as Creds).id } as const)
    this.link = openLink(hello, {
      onOpen: (info) => {
        if (gen !== this.generation) return
        this.onChannelOpen(info.offerSdp, info.answerSdp)
      },
      onMessage: (raw) => {
        if (gen === this.generation) this.onFrame(raw)
      },
      onDrain: () => {
        if (gen === this.generation) this.outbox?.pump()
      },
      onEnd: (why) => {
        if (gen === this.generation) this.onLinkEnd(why)
      }
    })
  }

  private teardown(): void {
    this.generation++
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.stopKeepalive()
    this.link?.close()
    this.link = null
    this.rejectAll('closed')
    this.authed = false
  }

  private fail(reason: FailReason, canRetry: boolean): void {
    this.teardown()
    this.set({ conn: { k: 'failed', reason, canRetry } })
  }

  private onChannelOpen(offerSdp: string, answerSdp: string): void {
    if (this.mode === 'pair') {
      const code = pairingCode(offerSdp, answerSdp)
      if (!code) return this.fail('protocol', true)
      this.set({ conn: { k: 'pairing', code, pending: false } })
      return
    }
    const c = this.creds
    if (!c) return this.fail('revoked', false)
    // Primera trama por el canal cifrado: nunca por HTTP ni por señalización.
    this.sendFrame({ t: 'auth', deviceId: c.id, secret: c.secret })
  }

  private onLinkEnd(why: LinkEnd): void {
    this.link = null
    this.stopKeepalive()
    this.authed = false
    this.rejectAll('closed')
    switch (why.k) {
      case 'unsupported':
        return this.fail('unsupported', false)
      case 'signal-error':
        if (why.code === 'invalid') {
          if (this.mode === 'pair') return this.fail('expired', false)
          clearCreds()
          this.creds = null
          this.set({ paired: false })
          return this.fail('revoked', false)
        }
        if (why.code === 'busy') return this.fail('busy', true)
        if (why.code === 'version') return this.fail('version', false)
        return this.fail('protocol', true)
      case 'no-host':
        if (this.mode === 'pair') return this.fail('no-host', true)
        return this.scheduleRetry('no-host')
      case 'closed':
        if (this.mode === 'pair') return this.fail('unreachable', true)
        return this.scheduleRetry('unreachable')
    }
  }

  /** Reintento acotado con espera creciente; al agotarlos queda un estado claro con botón «Reintentar». */
  private scheduleRetry(finalReason: 'no-host' | 'unreachable'): void {
    const delays = this.everOnline ? RECONNECT_DELAYS : FIRST_RESUME_DELAYS
    if (this.attempt >= delays.length) return this.fail(this.everOnline ? 'unreachable' : finalReason, true)
    const wait = delays[this.attempt]
    this.attempt++
    if (this.everOnline) this.set({ conn: { k: 'reconnecting', attempt: this.attempt, max: delays.length } })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, wait)
  }

  /** Al volver a primer plano (o recuperar la red): comprueba o rehace la conexión. */
  wake(): void {
    const k = this.snap.conn.k
    if (k === 'online') {
      this.probe()
    } else if (k === 'reconnecting') {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
        this.connect()
      }
    } else if (k === 'failed' && this.snap.conn.canRetry && this.mode === 'resume' && this.creds) {
      this.attempt = 0
      this.connect()
    }
  }

  private probe(): void {
    if (!this.sendFrame({ t: 'ping' })) return this.dropAndReconnect()
    this.armPong(WAKE_PROBE_MS)
  }

  private dropAndReconnect(): void {
    this.link?.close()
    this.link = null
    this.generation++
    this.stopKeepalive()
    this.authed = false
    this.rejectAll('closed')
    this.attempt = 0
    this.scheduleRetry('unreachable')
  }

  // ── keepalive ──

  private startKeepalive(): void {
    this.stopKeepalive()
    this.pingTimer = setInterval(() => {
      if (!this.sendFrame({ t: 'ping' })) return this.dropAndReconnect()
      this.armPong(PONG_WITHIN_MS)
    }, PING_EVERY_MS)
  }

  private armPong(ms: number): void {
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.pongTimer = setTimeout(() => this.dropAndReconnect(), ms)
  }

  private stopKeepalive(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.pingTimer = null
    this.pongTimer = null
  }

  // ── tramas ──

  private sendFrame(f: ClientFrame): boolean {
    const s = encodeFrame(f)
    return !!s && !!this.link && this.link.send(s)
  }

  private onFrame(raw: string): void {
    const p = parseHostFrame(raw)
    if (!p.ok) {
      if (++this.badFrames >= MAX_BAD_FRAMES) this.fail('protocol', true)
      return
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
    const f = p.value
    if (isMuxHostFrame(f) && !(f.t === 'res' && this.pending.has(f.id))) {
      if (!this.authed || !this.mux) {
        if (++this.badFrames >= MAX_BAD_FRAMES) this.fail('protocol', true)
        return
      }
      this.mux.receive(f, utf8Length(raw))
      return
    }
    this.handle(f)
  }

  // ── protocolo v2 (multiplexor) ──

  private openMux(): void {
    this.closeMux()
    const link = this.link
    if (!link) return
    const outbox = new Outbox({ send: (t) => link.send(t), bufferedAmount: () => link.bufferedAmount() })
    this.outbox = outbox
    this.mux = new Mux({
      role: 'client',
      out: outbox,
      nextId: () => {
        const id = this.nextId++
        if (this.nextId > 0x7fffffff) this.nextId = 1
        return id
      },
      onViolation: () => this.fail('protocol', true)
    })
  }

  private closeMux(): void {
    const m = this.mux
    this.mux = null
    m?.close()
    this.outbox?.kill()
    this.outbox = null
  }

  /** Llamada IPC al Mac por el multiplexor (rechaza con `MuxCallError`; `AbortError` si se cancela). */
  muxCall(ch: string, p?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.mux ? this.mux.call(ch, p, { signal }) : Promise.reject(new Error('offline'))
  }

  /** Petición HTTP al motor a través del Mac. */
  muxHttp(req: HttpRequest, signal?: AbortSignal): Promise<unknown> {
    return this.mux ? this.mux.http(req, { signal }) : Promise.reject(new Error('offline'))
  }

  /** Suscripción a eventos de un motor (`since` reanuda sin huecos). */
  muxSubscribe(eng: string, h: SubHandlers, since?: number): Subscription | null {
    return this.mux ? this.mux.subscribe(eng, h, since) : null
  }

  private handle(f: HostFrame): void {
    switch (f.t) {
      case 'pair-pending':
        if (this.snap.conn.k === 'pairing') this.set({ conn: { ...this.snap.conn, pending: true } })
        return
      case 'paired':
        if (this.mode !== 'pair' || this.authed) return
        this.creds = { id: f.deviceId, secret: f.deviceSecret }
        saveCreds(this.creds)
        this.pairSecret = null
        this.mode = 'resume'
        this.set({ paired: true })
        return this.beginGate()
      case 'authed':
        if (this.mode === 'resume' && !this.authed) this.beginGate()
        return
      case 'locked':
        if (this.authed) this.set({ conn: { k: 'locked', why: f.why, retryMs: f.retryMs, left: f.left } })
        return
      case 'unlocked':
        if (this.authed) this.goOnline()
        return
      case 'auth-failed':
        clearCreds()
        this.creds = null
        this.set({ paired: false })
        return this.fail('revoked', false)
      case 'denied':
        return this.fail(f.reason === 'rejected' ? 'denied' : f.reason === 'timeout' ? 'denied-timeout' : 'denied-limit', false)
      case 'bye':
        return this.onBye(f.reason)
      case 'pong':
        return
      case 'res':
        return this.onResponse(f)
      case 'evt':
        if (this.authed) this.onEvent(f.ev)
        return
    }
  }

  private onBye(reason: string): void {
    switch (reason) {
      case 'revoked':
        clearCreds()
        this.creds = null
        this.set({ paired: false })
        return this.fail('revoked', false)
      case 'stopped':
      case 'idle':
        return this.fail('stopped', false)
      case 'other-device':
        return this.fail('other-device', true)
      case 'violations':
        return this.fail('rate', true)
      default:
        // `timeout`: el equipo sigue ahí, se puede reconectar.
        this.link?.close()
        this.link = null
        this.generation++
        this.stopKeepalive()
        this.authed = false
        this.rejectAll('closed')
        this.attempt = 0
        this.scheduleRetry('unreachable')
    }
  }

  /** Autenticado: el Mac enviará `locked` (falta confirmar/PIN) o `unlocked` (acceso) enseguida. */
  private beginGate(): void {
    this.authed = true
    this.everOnline = true
    this.attempt = 0
    this.openMux()
    this.startKeepalive()
  }

  private goOnline(): void {
    this.authed = true
    this.everOnline = true
    this.attempt = 0
    this.set({ conn: { k: 'online' } })
    if (!this.mux) this.openMux()
    this.startKeepalive()
    if (this.lightData) void this.refreshAll()
  }

  /** Fija (`set`) o verifica el PIN de 6 dígitos DENTRO del canal. Nunca se guarda en el celular. */
  sendPin(pin: string, set: boolean): void {
    if (this.snap.conn.k !== 'locked') return
    this.sendFrame({ t: set ? 'pin-set' : 'pin-verify', pin })
  }

  // ── peticiones ──

  private request<M extends RequestMethod>(m: M, p: RequestParams[M]): Promise<RequestResults[M]> {
    return new Promise((resolve, reject) => {
      if (!this.authed || !this.link) return reject(new Error('offline'))
      const id = this.nextId++
      if (this.nextId > 0x7fffffff) this.nextId = 1
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('timeout'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { m, resolve: resolve as (v: unknown) => void, reject, timer })
      if (!this.sendFrame({ t: 'req', id, m, p } as ClientFrame)) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('offline'))
      }
    })
  }

  private onResponse(f: Extract<HostFrame, { t: 'res' }>): void {
    const pend = this.pending.get(f.id)
    if (!pend) return
    this.pending.delete(f.id)
    clearTimeout(pend.timer)
    if (!f.ok) return pend.reject(new Error(f.error.code))
    if (!('m' in f) || f.m !== pend.m) return pend.reject(new Error('failed'))
    pend.resolve(f.result)
  }

  private rejectAll(msg: string): void {
    this.closeMux()
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(msg))
    }
    this.pending.clear()
  }

  private explain(err: unknown): void {
    const code = err instanceof Error ? err.message : 'failed'
    if (code === 'offline' || code === 'closed') return this.toast('toast.offline')
    if (code === 'timeout') return this.toast('toast.timeout')
    this.toast(ERR_TOAST[code as RemoteErrorCode] ?? 'toast.failed')
  }

  // ── datos ──

  /** Lista de sesiones y, si hay un chat abierto, sus últimos mensajes. */
  async refreshAll(): Promise<void> {
    try {
      const r = await this.request('sessions.list', {})
      this.set({ sessions: sortSessions(r.sessions), permissions: r.permissions })
    } catch (e) {
      if (this.snap.sessions === null) this.set({ sessions: [] })
      this.explain(e)
    }
    const chat = this.snap.chat
    if (chat) void this.loadChat(chat.id)
  }

  openChat(id: string): void {
    this.touched.clear()
    this.set({ chat: { id, messages: [], hasMore: false, loading: true, loadingOlder: false } })
    void this.loadChat(id)
  }

  closeChat(): void {
    this.set({ chat: null })
  }

  private async loadChat(id: string): Promise<void> {
    try {
      const r = await this.request('session.messages', { sessionId: id, limit: LIMITS.defaultMessagesPerRequest })
      const chat = this.snap.chat
      if (!chat || chat.id !== id || r.sessionId !== id) return
      const byId = new Map(chat.messages.map((m) => [m.id, m]))
      const merged = r.messages.map((m) => (this.touched.has(m.id) ? (byId.get(m.id) ?? m) : m))
      for (const m of chat.messages) if (this.touched.has(m.id) && !merged.some((x) => x.id === m.id)) merged.push(m)
      this.set({ chat: { ...chat, messages: sortMessages(merged), hasMore: r.hasMore, loading: false } })
    } catch (e) {
      const chat = this.snap.chat
      if (chat && chat.id === id) this.set({ chat: { ...chat, loading: false } })
      this.explain(e)
    }
  }

  async loadOlder(): Promise<void> {
    const chat = this.snap.chat
    if (!chat || chat.loadingOlder || !chat.hasMore || chat.messages.length === 0) return
    const id = chat.id
    this.set({ chat: { ...chat, loadingOlder: true } })
    try {
      const r = await this.request('session.messages', {
        sessionId: id,
        limit: LIMITS.defaultMessagesPerRequest,
        before: chat.messages[0].id
      })
      const cur = this.snap.chat
      if (!cur || cur.id !== id) return
      const known = new Set(cur.messages.map((m) => m.id))
      const older = r.messages.filter((m) => !known.has(m.id))
      this.set({
        chat: {
          ...cur,
          messages: sortMessages([...older, ...cur.messages]).slice(-MAX_CHAT_MESSAGES),
          hasMore: r.hasMore,
          loadingOlder: false
        }
      })
    } catch (e) {
      const cur = this.snap.chat
      if (cur && cur.id === id) this.set({ chat: { ...cur, loadingOlder: false } })
      this.explain(e)
    }
  }

  /** `true` si el Mac aceptó el mensaje. */
  async sendPrompt(sessionId: string, text: string): Promise<boolean> {
    const clean = text.trim()
    if (clean.length === 0) return false
    if (clean.length > LIMITS.maxPromptChars) {
      this.toast('toast.tooLong')
      return false
    }
    const now = Date.now()
    this.promptTimes = this.promptTimes.filter((x) => now - x < 60_000)
    if (this.promptTimes.length >= LIMITS.promptsPerMinute) {
      this.toast('toast.promptRate')
      return false
    }
    this.promptTimes.push(now)
    try {
      await this.request('session.prompt', { sessionId, text: clean })
      return true
    } catch (e) {
      this.explain(e)
      return false
    }
  }

  async abort(sessionId: string): Promise<void> {
    try {
      await this.request('session.abort', { sessionId })
    } catch (e) {
      this.explain(e)
    }
  }

  /** Solo `once` o `reject`: `always` no existe en el protocolo. */
  async replyPermission(requestId: string, reply: Reply): Promise<void> {
    try {
      await this.request('permission.reply', { requestId, reply })
      this.set({ permissions: this.snap.permissions.filter((p) => p.requestId !== requestId) })
    } catch (e) {
      this.explain(e)
    }
  }

  // ── eventos ──

  private onEvent(ev: RemoteEvent): void {
    switch (ev.e) {
      case 'session.updated': {
        const list = (this.snap.sessions ?? []).filter((s) => s.id !== ev.session.id)
        list.push(ev.session)
        this.set({ sessions: sortSessions(list).slice(0, LIMITS.maxSessionsListed) })
        return
      }
      case 'session.removed': {
        const chat = this.snap.chat?.id === ev.sessionId ? null : this.snap.chat
        this.set({
          sessions: (this.snap.sessions ?? []).filter((s) => s.id !== ev.sessionId),
          permissions: this.snap.permissions.filter((p) => p.sessionId !== ev.sessionId),
          chat
        })
        return
      }
      case 'message.updated': {
        const chat = this.snap.chat
        if (!chat || chat.id !== ev.message.sessionId) return
        this.touched.add(ev.message.id)
        const msgs = chat.messages.filter((m) => m.id !== ev.message.id)
        msgs.push(ev.message)
        this.set({ chat: { ...chat, messages: sortMessages(msgs).slice(-MAX_CHAT_MESSAGES) } })
        return
      }
      case 'permission.asked': {
        const rest = this.snap.permissions.filter((p) => p.requestId !== ev.permission.requestId)
        rest.push(ev.permission)
        this.set({ permissions: rest.slice(-50) })
        return
      }
      case 'permission.resolved':
        this.set({ permissions: this.snap.permissions.filter((p) => p.requestId !== ev.requestId) })
        return
    }
  }
}

function sortSessions(l: RemoteSession[]): RemoteSession[] {
  return [...l].sort((a, b) => b.updatedAt - a.updatedAt)
}

function sortMessages(l: RemoteMessage[]): RemoteMessage[] {
  return [...l].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
