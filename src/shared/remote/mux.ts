/**
 * Multiplexor del protocolo v2 del control remoto (F8-B51). TypeScript puro, sin Node ni DOM: lo usan el escritorio
 * (`src/main/remote/peer-session.ts`) y la PWA (`pwa/src/client.ts`) con el MISMO código.
 *
 * Qué resuelve, sobre un único DataChannel ordenado y fiable de tramas ≤ 64 KiB:
 *  - `call`/`http` -> `res`, con mensajes grandes partidos en `chunk` (≤ 56 KiB de datos por trama) y ensamblados con
 *    tope de 16 MiB (subida) / 8 MiB (bajada). La cabecera anuncia el total (`ck`, bytes UTF-8) y se verifica al final.
 *  - Control de flujo por crédito: cada transferencia/stream empieza con una ventana de 256 KiB; el receptor devuelve
 *    `credit` al consumir. Un `credit` mayor que lo enviado sin confirmar es una violación.
 *  - Planificador de prioridad (`Outbox`): control/permisos > eventos > respuestas > bulk. Los bloques grandes se
 *    intercalan por turnos (un bloque por stream en cada vuelta) y solo se escribe mientras `bufferedAmount` esté bajo
 *    la marca alta; al bajar de la baja (`onBufferedAmountLow`) se vuelve a bombear. Así un evento nunca espera más que
 *    lo que ya hay en el búfer del canal (≈ marca alta / velocidad), no a los 10 MB de una descarga.
 *  - Tope de 32 llamadas en vuelo y 6 streams por conexión; ids estrictamente crecientes (anti-repetición); `cancel`.
 *  - Eventos con número de secuencia por motor y búfer circular (30 s / 2 MiB, `EventLog`) para reanudar con
 *    `sub{since}`; si falta algo se envía `reset` y el cliente resincroniza.
 *
 * NO sabe nada del motor: el despacho es la interfaz inyectable `MuxDispatch`. Sin despachador, todo se rechaza.
 * Todo lo recibido se trata como hostil: una trama fuera de orden, repetida o fuera de límites llama a `onViolation`.
 */
import { LIMITS, utf8Length } from './protocol'
import type {
  CallFrame,
  ChunkFrame,
  CreditFrame,
  EvFrame,
  HttpFrame,
  MuxClientFrame,
  MuxErrorCode,
  MuxHostFrame,
  ResetFrame,
  SubFrame
} from './protocol'

// ---------------------------------------------------------------------------------------------
// Prioridad y salida
// ---------------------------------------------------------------------------------------------

export const PRIO = { control: 0, event: 1, response: 2, bulk: 3 } as const
export type Prio = 0 | 1 | 2

/** Marcas del búfer del canal (bytes): se escribe por debajo de `high`; `low` es el umbral de `bufferedamountlow`. */
export const BUFFER = { high: 128 * 1024, low: 32 * 1024, hard: 512 * 1024 } as const

export interface MuxTransport {
  /** `false` = el canal ya no acepta tramas. */
  send(text: string): boolean
  bufferedAmount?(): number
}

export interface BulkSource {
  /** Identifica la transferencia (se puede descartar con `dropBulk`). */
  key: number
  /** Siguiente trama, `'blocked'` (sin crédito aún) o `'done'`. */
  next(): { text: string } | 'blocked' | 'done'
  onDone?(): void
}

export class Outbox {
  private readonly q: string[][] = [[], [], []]
  private bulk: BulkSource[] = []
  private rr = 0
  private pumping = false
  private dead = false

  constructor(
    private readonly transport: MuxTransport,
    private readonly marks: { high: number; hard: number } = BUFFER
  ) {}

  get isDead(): boolean {
    return this.dead
  }

  /** Tramas pendientes (para pruebas y métricas). */
  get pending(): number {
    return this.q[0].length + this.q[1].length + this.q[2].length + this.bulk.length
  }

  enqueue(prio: Prio, text: string): void {
    if (this.dead) return
    this.q[prio].push(text)
    this.pump()
  }

  addBulk(src: BulkSource): void {
    if (this.dead) return
    this.bulk.push(src)
    this.pump()
  }

  dropBulk(key: number): void {
    this.bulk = this.bulk.filter((s) => s.key !== key)
  }

  /**
   * Descarta los eventos (`ev` del multiplexor y `evt` del protocolo anterior) que aún no salieron. Lo usa el bloqueo: lo que ya
   * estaba en cola no debe llegar al celular después de pedir el PIN.
   */
  dropEvents(): void {
    this.q[1].length = 0
    this.q[0] = this.q[0].filter((t) => !t.startsWith('{"t":"ev"') && !t.startsWith('{"t":"evt"'))
  }

  /** Vacía todo (conexión cerrada). */
  kill(): void {
    this.dead = true
    for (const q of this.q) q.length = 0
    this.bulk = []
  }

  /** Escribe todo lo que quepa. Se llama al encolar, al recibir crédito y en `onBufferedAmountLow`. */
  pump(): void {
    if (this.pumping || this.dead) return
    this.pumping = true
    try {
      for (;;) {
        const buffered = this.transport.bufferedAmount?.() ?? 0
        if (this.q[0].length > 0 && buffered < this.marks.hard) {
          if (!this.write(this.q[0].shift() as string)) return
          continue
        }
        if (buffered >= this.marks.high) return
        const lower = this.q[1].length > 0 ? this.q[1] : this.q[2].length > 0 ? this.q[2] : null
        if (lower) {
          if (!this.write(lower.shift() as string)) return
          continue
        }
        if (!this.pumpBulkOnce()) return
      }
    } finally {
      this.pumping = false
    }
  }

  private write(text: string): boolean {
    let ok = false
    try {
      ok = this.transport.send(text)
    } catch {
      ok = false
    }
    if (!ok) this.kill()
    return ok
  }

  /** Un bloque del siguiente stream con datos (turnos). `false` = nada que enviar ahora. */
  private pumpBulkOnce(): boolean {
    const n = this.bulk.length
    for (let k = 0; k < n; k++) {
      if (this.bulk.length === 0) return false
      const i = (this.rr + k) % this.bulk.length
      const src = this.bulk[i]
      const r = src.next()
      if (r === 'blocked') continue
      if (r === 'done') {
        this.bulk.splice(i, 1)
        this.rr = i
        src.onDone?.()
        return true
      }
      this.rr = i + 1
      return this.write(r.text)
    }
    return false
  }
}

// ---------------------------------------------------------------------------------------------
// Partir texto en trozos
// ---------------------------------------------------------------------------------------------

export interface Piece {
  start: number
  end: number
  /** Bytes UTF-8 del trozo (lo que cuenta el receptor). */
  bytes: number
}

/**
 * Parte `text` en trozos cuyo JSON escapado cabe en `LIMITS.chunkBytes` (así la trama completa queda muy por debajo de
 * 64 KiB aunque el texto tenga comillas o caracteres de control). Nunca separa un par sustituto.
 */
export function splitText(text: string, max: number = LIMITS.chunkBytes): Piece[] {
  const out: Piece[] = []
  const len = text.length
  let i = 0
  while (i < len) {
    const start = i
    let esc = 0
    while (i < len) {
      const c = text.charCodeAt(i)
      let cost: number
      let units = 1
      if (c === 0x22 || c === 0x5c) cost = 2
      else if (c < 0x20) cost = c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6
      else if (c < 0x80) cost = 1
      else if (c < 0x800) cost = 2
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < len && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        cost = 4
        units = 2
      } else if (c >= 0xd800 && c <= 0xdfff) cost = 6
      else cost = 3
      if (esc + cost > max) break
      esc += cost
      i += units
    }
    out.push({ start, end: i, bytes: utf8Length(text.slice(start, i)) })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Búfer circular de eventos (reanudación `since`)
// ---------------------------------------------------------------------------------------------

export interface LogEntry {
  seq: number
  /** `ch` = canal IPC, `oc` = tipo de evento de OpenCode. */
  kind: 'ch' | 'oc'
  name: string
  /** `p` ya serializado (`undefined` = sin carga). */
  pj: string | undefined
  at: number
  bytes: number
  urgent: boolean
  /** El evento no cabía en una trama: solo ocupa su número de secuencia y provoca `reset` al entregarse. */
  tomb: boolean
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/

/** Texto de la trama `ev` (se arma a mano para serializar `p` una sola vez, aunque se envíe a varios streams). */
export function evText(s: number, e: LogEntry): string {
  return `{"t":"ev","s":${s},"seq":${e.seq},"${e.kind}":"${e.name}"${e.pj === undefined ? '' : `,"p":${e.pj}`}}`
}

export class EventLog {
  private readonly rings = new Map<string, { head: number; items: LogEntry[]; bytes: number }>()
  private readonly subs = new Map<string, Set<() => void>>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxAgeMs: number = LIMITS.eventRingMs,
    private readonly maxBytes: number = LIMITS.eventRingBytes
  ) {}

  private ring(eng: string): { head: number; items: LogEntry[]; bytes: number } {
    let r = this.rings.get(eng)
    if (!r) {
      r = { head: 0, items: [], bytes: 0 }
      this.rings.set(eng, r)
    }
    return r
  }

  /** Añade un evento (ya filtrado/recortado por quien publica) y devuelve su `seq`. */
  append(eng: string, e: { ch?: string; oc?: string; p?: unknown; urgent?: boolean }): number {
    const r = this.ring(eng)
    const name = e.ch ?? e.oc ?? ''
    const kind: 'ch' | 'oc' = e.ch !== undefined ? 'ch' : 'oc'
    const seq = ++r.head
    let pj: string | undefined
    try {
      pj = e.p === undefined ? undefined : JSON.stringify(e.p)
    } catch {
      pj = undefined
    }
    const entry: LogEntry = { seq, kind, name, pj, at: this.now(), bytes: 0, urgent: e.urgent === true, tomb: false }
    entry.bytes = utf8Length(evText(2147483647, entry))
    if (!NAME_RE.test(name) || entry.bytes > LIMITS.maxFrameBytes - 16 || (e.p !== undefined && pj === undefined)) {
      entry.tomb = true
      entry.pj = undefined
      entry.bytes = 64
    }
    r.items.push(entry)
    r.bytes += entry.bytes
    this.evict(r)
    for (const cb of [...(this.subs.get(eng) ?? [])]) cb()
    return seq
  }

  /** Marca un hueco (p. ej. se reconectó el stream de subida y pudo perderse algo): los streams reciben `reset`. */
  markGap(eng: string): number {
    const r = this.ring(eng)
    const seq = ++r.head
    r.items.push({ seq, kind: 'oc', name: 'gap', pj: undefined, at: this.now(), bytes: 64, urgent: false, tomb: true })
    r.bytes += 64
    this.evict(r)
    for (const cb of [...(this.subs.get(eng) ?? [])]) cb()
    return seq
  }

  private evict(r: { items: LogEntry[]; bytes: number }): void {
    const t = this.now()
    let drop = 0
    while (drop < r.items.length && (t - r.items[drop].at > this.maxAgeMs || r.bytes > this.maxBytes)) {
      r.bytes -= r.items[drop].bytes
      drop++
    }
    if (drop > 0) r.items.splice(0, drop)
  }

  /** Último `seq` publicado para el motor (0 = ninguno). */
  head(eng: string): number {
    return this.rings.get(eng)?.head ?? 0
  }

  /**
   * Siguiente cosa que debe recibir un stream cuyo último `seq` entregado es `cursor`.
   * `gap` = lo siguiente ya no está en el búfer (o `cursor` es del futuro, p. ej. el Mac se reinició) o es una lápida.
   */
  next(eng: string, cursor: number): { kind: 'entry'; entry: LogEntry } | { kind: 'gap'; seq: number } | null {
    const r = this.rings.get(eng)
    if (!r) return cursor > 0 ? { kind: 'gap', seq: 0 } : null
    this.evict(r)
    if (cursor > r.head) return { kind: 'gap', seq: r.head }
    if (cursor === r.head) return null
    const first = r.items.length > 0 ? r.items[0].seq : r.head + 1
    if (cursor + 1 < first) return { kind: 'gap', seq: r.head }
    const e = r.items[cursor + 1 - first]
    if (e.tomb) return { kind: 'gap', seq: e.seq }
    return { kind: 'entry', entry: e }
  }

  /** Avisa cuando llega un evento nuevo al motor. Devuelve la función para cancelar. */
  subscribe(eng: string, cb: () => void): () => void {
    let set = this.subs.get(eng)
    if (!set) {
      set = new Set()
      this.subs.set(eng, set)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0 && this.subs.get(eng) === set) this.subs.delete(eng)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Errores y despacho
// ---------------------------------------------------------------------------------------------

export class MuxError extends Error {
  constructor(
    readonly code: MuxErrorCode,
    readonly detail?: string
  ) {
    super(code)
    this.name = 'MuxError'
  }
}

export interface DispatchCtx {
  id: number
  /** Se aborta con `cancel` o al cerrarse la conexión: el despachador debe abortar su `fetch` de subida. */
  signal: AbortSignal
}

export type CallRequest = { ch: string; p: unknown }
export type HttpRequest = Omit<HttpFrame, 't' | 'id' | 'ck'>

/** Gancho de despacho (lo implementan T2/T3/T4). Lanzar `MuxError(code)` responde con ese código; otro error = `failed`. */
export interface MuxDispatch {
  call(req: CallRequest, ctx: DispatchCtx): Promise<unknown>
  http(req: HttpRequest, ctx: DispatchCtx): Promise<unknown>
  /** ¿Puede este celular suscribirse a este motor? Sin esta función se permite (si hay `EventLog`). */
  allowSub?(eng: string): boolean
}

// ---------------------------------------------------------------------------------------------
// Multiplexor
// ---------------------------------------------------------------------------------------------

export interface MuxOptions {
  role: 'host' | 'client'
  out: Outbox
  /** Trama inválida, repetida, fuera de orden o fuera de límites. El dueño decide (contar y cortar). */
  onViolation?: (reason: string) => void
  /** Solo `host`. Sin despachador todo `call`/`http`/`sub` se responde `unavailable`. */
  dispatch?: MuxDispatch
  /** Solo `host`: fuente de eventos para `sub`. */
  events?: EventLog
  /** ¿Es una petición de control/permisos (prioridad máxima)? Por defecto no. */
  urgent?: (f: CallFrame | HttpFrame) => boolean
  /** Solo `host`: ¿se pueden emitir eventos ahora? (defensa en profundidad: con el acceso bloqueado, `drain` no envía nada). */
  canEmit?: () => boolean
  /** Solo `client`: generador de ids (compartido con quien ya use ids propios). Estrictamente crecientes. */
  nextId?: () => number
}

export interface Subscription {
  readonly id: number
  /** Último `seq` entregado (o el del acuse). Sirve para reanudar con `since` tras reconectar. */
  readonly lastSeq: number
  cancel(): void
}

export interface SubHandlers {
  /** Acuse del Mac con el `seq` actual. */
  onReady?(seq: number): void
  onEvent(ev: { seq: number; ch?: string; oc?: string; p?: unknown }): void
  /** Hubo un hueco: hay que resincronizar (volver a leer el estado). */
  onReset?(seq: number): void
  onEnd?(why: MuxErrorCode): void
}

export class MuxCallError extends Error {
  constructor(
    readonly code: MuxErrorCode,
    readonly detail?: string
  ) {
    super(code)
    this.name = code === 'cancelled' ? 'AbortError' : 'MuxCallError'
  }
}

interface Assembly {
  id: number
  head: CallFrame | HttpFrame | { t: 'res'; id: number; ok: true; ck: number }
  parts: string[]
  next: number
  got: number
  total: number
  /** Bytes de trama recibidos y aún sin devolver como crédito. */
  unacked: number
  owed: number
}

interface Outgoing {
  id: number
  credit: number
  sentUnacked: number
  held: { text: string; bytes: number } | null
  i: number
  pieces: Piece[]
  text: string
  src: BulkSource
}

interface HostSub {
  id: number
  eng: string
  cursor: number
  credit: number
  sentUnacked: number
  unsub: () => void
}

interface ClientSub {
  id: number
  eng: string
  h: SubHandlers
  last: number
  ready: boolean
  unacked: number
  owed: number
}

interface ClientCall {
  id: number
  resolve(v: unknown): void
  reject(e: Error): void
  signal?: AbortSignal
  onAbort?: () => void
  /** Ya tiene hueco en vuelo (si no, espera en la cola). */
  started: boolean
  start(): void
}

const CANCELLED_MEMORY = 256

export class Mux {
  private readonly out: Outbox
  private readonly host: boolean
  private readonly maxIn: number
  private readonly maxOut: number
  private closed = false
  private lastId = 0
  private readonly cancelled = new Set<number>()
  private readonly assemblies = new Map<number, Assembly>()
  private assemblingBytes = 0
  private readonly outgoing = new Map<number, Outgoing>()
  private outgoingBytes = 0
  // host
  private readonly inflight = new Map<number, AbortController | null>()
  private readonly hostSubs = new Map<number, HostSub>()
  // cliente
  private readonly calls = new Map<number, ClientCall>()
  private readonly waiting: ClientCall[] = []
  private readonly clientSubs = new Map<number, ClientSub>()
  private idSeed = 0

  constructor(private readonly o: MuxOptions) {
    this.out = o.out
    this.host = o.role === 'host'
    this.maxIn = this.host ? LIMITS.maxUploadBytes : LIMITS.maxDownloadBytes
    this.maxOut = this.host ? LIMITS.maxDownloadBytes : LIMITS.maxUploadBytes
  }

  /** Llamadas en vuelo (host: atendiéndose; cliente: enviadas sin respuesta). */
  get inFlight(): number {
    return this.host ? this.inflight.size : this.calls.size
  }

  get streams(): number {
    return this.host ? this.hostSubs.size : this.clientSubs.size
  }

  private bad(reason: string): void {
    this.o.onViolation?.(reason)
  }

  private remember(id: number): void {
    this.cancelled.add(id)
    if (this.cancelled.size > CANCELLED_MEMORY) {
      const first = this.cancelled.values().next().value
      if (first !== undefined) this.cancelled.delete(first)
    }
  }

  // ── entrada (ambos lados) ──

  /** Procesa una trama ya validada (`parseClientFrame`/`parseHostFrame`). `bytes` = tamaño de la trama en el canal. */
  receive(f: MuxClientFrame | MuxHostFrame, bytes: number): void {
    if (this.closed) return
    if (f.t === 'chunk') return this.onChunk(f, bytes)
    if (f.t === 'credit') return this.onCredit(f)
    if (this.host) {
      switch (f.t) {
        case 'call':
        case 'http':
          return this.hostRequest(f)
        case 'sub':
          return this.hostSub(f)
        case 'cancel':
          return this.hostCancel(f.id)
        default:
          return this.bad('role')
      }
    }
    switch (f.t) {
      case 'res':
        return this.clientRes(f)
      case 'ev':
        return this.clientEv(f, bytes)
      case 'reset':
        return this.clientReset(f)
      default:
        return this.bad('role')
    }
  }

  // ── transferencias salientes (chunks con crédito) ──

  private sendChunked(id: number, text: string, onDone: () => void): boolean {
    const pieces = splitText(text)
    const total = pieces.reduce((n, p) => n + p.bytes, 0)
    if (total > this.maxOut) return false
    const t: Outgoing = {
      id,
      credit: LIMITS.creditWindowBytes,
      sentUnacked: 0,
      held: null,
      i: 0,
      pieces,
      text,
      src: {
        key: id,
        next: () => {
          if (t.i >= t.pieces.length) return 'done'
          if (!t.held) {
            const p = t.pieces[t.i]
            const frame = `{"t":"chunk","id":${id},"n":${t.i},"last":${t.i === t.pieces.length - 1},"d":${JSON.stringify(t.text.slice(p.start, p.end))}}`
            t.held = { text: frame, bytes: utf8Length(frame) }
          }
          if (t.credit < t.held.bytes) return 'blocked'
          const h = t.held
          t.held = null
          t.credit -= h.bytes
          t.sentUnacked += h.bytes
          t.i++
          return { text: h.text }
        },
        onDone: () => {
          this.outgoing.delete(id)
          this.outgoingBytes -= total
          onDone()
        }
      }
    }
    this.outgoing.set(id, t)
    this.outgoingBytes += total
    this.out.addBulk(t.src)
    return true
  }

  private dropOutgoing(id: number): void {
    const t = this.outgoing.get(id)
    if (!t) return
    this.out.dropBulk(id)
    this.outgoing.delete(id)
    this.outgoingBytes -= t.pieces.reduce((n, p) => n + p.bytes, 0)
  }

  private onCredit(f: CreditFrame): void {
    const t = this.outgoing.get(f.id)
    if (t) {
      if (f.bytes > t.sentUnacked) return this.bad('credit')
      t.sentUnacked -= f.bytes
      t.credit += f.bytes
      this.out.pump()
      return
    }
    const s = this.hostSubs.get(f.id)
    if (s) {
      if (f.bytes > s.sentUnacked) return this.bad('credit')
      s.sentUnacked -= f.bytes
      s.credit += f.bytes
      this.drain(s)
      return
    }
    // Crédito de algo ya terminado o cancelado: carrera normal, se ignora (la inundación la frena el cubo de tramas).
  }

  // ── transferencias entrantes (ensamblado) ──

  private startAssembly(head: Assembly['head'], total: number): boolean {
    if (total > this.maxIn || this.assemblingBytes + total > LIMITS.maxAssemblingBytes) return false
    this.assemblingBytes += total
    this.assemblies.set(head.id, { id: head.id, head, parts: [], next: 0, got: 0, total, unacked: 0, owed: 0 })
    return true
  }

  private endAssembly(id: number): Assembly | undefined {
    const a = this.assemblies.get(id)
    if (a) {
      this.assemblies.delete(id)
      this.assemblingBytes -= a.total
    }
    return a
  }

  private grant(id: number, n: number): void {
    this.out.enqueue(PRIO.control, `{"t":"credit","id":${id},"bytes":${n}}`)
  }

  private onChunk(f: ChunkFrame, bytes: number): void {
    const a = this.assemblies.get(f.id)
    if (!a) {
      if (this.cancelled.has(f.id)) return
      return this.bad('chunk-orphan')
    }
    const piece = utf8Length(f.d)
    if (f.n !== a.next) return this.abortAssembly(a, 'chunk-order')
    a.unacked += bytes
    if (a.unacked > LIMITS.creditWindowBytes) return this.abortAssembly(a, 'flow')
    a.next++
    a.got += piece
    if (a.got > a.total) return this.abortAssembly(a, 'chunk-overflow')
    a.parts.push(f.d)
    if (f.last) {
      if (a.got !== a.total) return this.abortAssembly(a, 'chunk-size')
      this.endAssembly(a.id)
      return this.assembled(a)
    }
    a.owed += bytes
    if (a.owed >= LIMITS.creditGrantBytes) {
      this.grant(a.id, a.owed)
      a.unacked -= a.owed
      a.owed = 0
    }
  }

  private abortAssembly(a: Assembly, reason: string): void {
    this.endAssembly(a.id)
    this.bad(reason)
    if (this.host) {
      this.inflight.delete(a.id)
      this.out.enqueue(PRIO.response, this.errText(a.id, 'bad-request'))
    } else {
      this.finishCall(a.id, new MuxCallError('failed'))
    }
  }

  private assembled(a: Assembly): void {
    const text = a.parts.join('')
    const h = a.head
    if (h.t === 'http') return this.hostRun({ ...h, body: text, ck: undefined })
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      this.bad('bad-json')
      if (this.host) {
        this.inflight.delete(a.id)
        this.out.enqueue(PRIO.response, this.errText(a.id, 'bad-request'))
      } else this.finishCall(a.id, new MuxCallError('failed'))
      return
    }
    if (h.t === 'call') return this.hostRun({ ...h, p: value, ck: undefined })
    this.finishCall(a.id, undefined, value)
  }

  // ── host ──

  private errText(id: number, code: MuxErrorCode, msg?: string): string {
    const error: { code: MuxErrorCode; msg?: string } = { code }
    if (msg) error.msg = msg.slice(0, LIMITS.maxErrorMsgChars)
    return JSON.stringify({ t: 'res', id, ok: false, error })
  }

  private checkId(id: number): boolean {
    if (id <= this.lastId) {
      this.bad('id-not-increasing')
      return false
    }
    this.lastId = id
    return true
  }

  private hostRequest(f: CallFrame | HttpFrame): void {
    if (!this.checkId(f.id)) return
    const d = this.o.dispatch
    if (!d) return this.out.enqueue(PRIO.response, this.errText(f.id, 'unavailable'))
    if (this.inflight.size >= LIMITS.maxInFlightCalls) return this.out.enqueue(PRIO.response, this.errText(f.id, 'busy'))
    this.inflight.set(f.id, null)
    if (f.ck !== undefined) {
      if (!this.startAssembly(f, f.ck)) {
        this.inflight.delete(f.id)
        return this.out.enqueue(PRIO.response, this.errText(f.id, f.ck > this.maxIn ? 'too-large' : 'busy'))
      }
      return
    }
    this.hostRun(f)
  }

  private hostRun(f: CallFrame | HttpFrame): void {
    const d = this.o.dispatch
    if (!d || this.closed) return
    const ctrl = new AbortController()
    this.inflight.set(f.id, ctrl)
    const urgent = this.o.urgent?.(f) === true
    const ctx: DispatchCtx = { id: f.id, signal: ctrl.signal }
    let p: Promise<unknown>
    try {
      p =
        f.t === 'call'
          ? d.call({ ch: f.ch, p: f.p }, ctx)
          : d.http({ eng: f.eng, method: f.method, path: f.path, query: f.query, headers: f.headers, body: f.body }, ctx)
    } catch (err) {
      p = Promise.reject(err)
    }
    p.then(
      (data) => this.hostRespond(f.id, ctrl, urgent, data),
      (err: unknown) => {
        if (ctrl.signal.aborted || this.inflight.get(f.id) !== ctrl) return
        this.inflight.delete(f.id)
        const code = err instanceof MuxError ? err.code : 'failed'
        this.out.enqueue(urgent ? PRIO.control : PRIO.response, this.errText(f.id, code, err instanceof MuxError ? err.detail : undefined))
      }
    )
  }

  private hostRespond(id: number, ctrl: AbortController, urgent: boolean, data: unknown): void {
    if (ctrl.signal.aborted || this.inflight.get(id) !== ctrl || this.closed) return
    const prio = urgent ? PRIO.control : PRIO.response
    let frame: string
    try {
      frame = JSON.stringify({ t: 'res', id, ok: true, data: data === undefined ? null : data })
    } catch {
      this.inflight.delete(id)
      return this.out.enqueue(prio, this.errText(id, 'failed'))
    }
    if (utf8Length(frame) <= LIMITS.maxFrameBytes) {
      this.inflight.delete(id)
      return this.out.enqueue(prio, frame)
    }
    const json = JSON.stringify(data)
    if (utf8Length(json) > this.maxOut || this.outgoingBytes + json.length > LIMITS.maxAssemblingBytes) {
      this.inflight.delete(id)
      return this.out.enqueue(prio, this.errText(id, utf8Length(json) > this.maxOut ? 'too-large' : 'busy'))
    }
    const total = splitText(json).reduce((n, p) => n + p.bytes, 0)
    this.out.enqueue(prio, JSON.stringify({ t: 'res', id, ok: true, ck: total }))
    this.sendChunked(id, json, () => {
      if (this.inflight.get(id) === ctrl) this.inflight.delete(id)
    })
  }

  /**
   * Cierra TODAS las suscripciones abiertas (bloqueo del acceso): deja de escuchar el búfer, descarta los eventos en cola y manda
   * un `res` de error por suscripción (`forbidden` por defecto) para que el celular la dé por terminada sin tratarlo como violación.
   * Después de esto no sale ningún `ev` más; para volver a recibirlos hay que enviar un `sub` nuevo (con `since`).
   */
  endSubs(code: MuxErrorCode = 'forbidden', msg?: string): void {
    if (!this.host || this.hostSubs.size === 0) return
    const subs = [...this.hostSubs.values()]
    this.hostSubs.clear()
    for (const s of subs) s.unsub()
    this.out.dropEvents()
    for (const s of subs) this.out.enqueue(PRIO.control, this.errText(s.id, code, msg))
  }

  private hostCancel(id: number): void {
    this.remember(id)
    const ctrl = this.inflight.get(id)
    if (ctrl !== undefined) {
      this.inflight.delete(id)
      ctrl?.abort()
    }
    this.endAssembly(id)
    this.dropOutgoing(id)
    const s = this.hostSubs.get(id)
    if (s) {
      s.unsub()
      this.hostSubs.delete(id)
    }
  }

  private hostSub(f: SubFrame): void {
    if (!this.checkId(f.id)) return
    const d = this.o.dispatch
    const log = this.o.events
    if (!d || !log) return this.out.enqueue(PRIO.response, this.errText(f.id, 'unavailable'))
    if (d.allowSub && !d.allowSub(f.eng)) return this.out.enqueue(PRIO.response, this.errText(f.id, 'forbidden'))
    if (this.hostSubs.size >= LIMITS.maxStreams) return this.out.enqueue(PRIO.response, this.errText(f.id, 'busy'))
    const head = log.head(f.eng)
    const sub: HostSub = {
      id: f.id,
      eng: f.eng,
      cursor: f.since === undefined ? head : f.since,
      credit: LIMITS.creditWindowBytes,
      sentUnacked: 0,
      unsub: () => undefined
    }
    this.hostSubs.set(f.id, sub)
    // El acuse va con prioridad de control: siempre antes que cualquier `ev` del stream.
    this.out.enqueue(PRIO.control, JSON.stringify({ t: 'res', id: f.id, ok: true, data: { seq: sub.cursor > head ? head : sub.cursor } }))
    sub.unsub = log.subscribe(f.eng, () => this.drain(sub))
    this.drain(sub)
  }

  private drain(sub: HostSub): void {
    const log = this.o.events
    if (!log || this.closed || this.hostSubs.get(sub.id) !== sub) return
    if (this.o.canEmit && !this.o.canEmit()) return
    for (;;) {
      const n = log.next(sub.eng, sub.cursor)
      if (!n) return
      if (n.kind === 'gap') {
        const reset: ResetFrame = { t: 'reset', s: sub.id, seq: n.seq }
        this.out.enqueue(PRIO.control, JSON.stringify(reset))
        sub.cursor = n.seq
        continue
      }
      const text = evText(sub.id, n.entry)
      const bytes = utf8Length(text)
      if (sub.credit < bytes) return
      sub.credit -= bytes
      sub.sentUnacked += bytes
      sub.cursor = n.entry.seq
      this.out.enqueue(n.entry.urgent ? PRIO.control : PRIO.event, text)
    }
  }

  // ── cliente ──

  private allocId(): number {
    if (this.o.nextId) return this.o.nextId()
    return ++this.idSeed
  }

  /** `call`: invoca un canal IPC en el Mac. Rechaza con `MuxCallError` (`AbortError` si se cancela). */
  call(ch: string, p?: unknown, opts: { signal?: AbortSignal } = {}): Promise<unknown> {
    return this.submit(opts.signal, (id) => {
      const head: CallFrame = { t: 'call', id, ch }
      if (p !== undefined) head.p = p
      const urgent = this.o.urgent?.(head) === true
      const text = JSON.stringify(head)
      if (utf8Length(text) <= LIMITS.maxFrameBytes) {
        this.out.enqueue(urgent ? PRIO.control : PRIO.response, text)
        return true
      }
      delete head.p
      const json = JSON.stringify(p)
      return this.sendHead(id, urgent, { ...head, ck: 0 }, json)
    })
  }

  /** `http`: petición HTTP al motor `eng` a través del Mac. La respuesta es lo que devuelva el despachador. */
  http(req: HttpRequest, opts: { signal?: AbortSignal } = {}): Promise<unknown> {
    return this.submit(opts.signal, (id) => {
      const head: HttpFrame = { t: 'http', id, ...req }
      const urgent = this.o.urgent?.(head) === true
      const text = JSON.stringify(head)
      if (utf8Length(text) <= LIMITS.maxFrameBytes) {
        this.out.enqueue(urgent ? PRIO.control : PRIO.response, text)
        return true
      }
      if (req.body === undefined) return false
      const body = req.body
      delete head.body
      return this.sendHead(id, urgent, { ...head, ck: 0 }, body)
    })
  }

  /** Cabecera con `ck` real + trozos. `false` = demasiado grande. */
  private sendHead(id: number, urgent: boolean, head: CallFrame | HttpFrame, text: string): boolean {
    const total = splitText(text).reduce((n, p) => n + p.bytes, 0)
    if (total > this.maxOut || total < 1) return false
    head.ck = total
    this.out.enqueue(urgent ? PRIO.control : PRIO.response, JSON.stringify(head))
    return this.sendChunked(id, text, () => undefined)
  }

  private submit(signal: AbortSignal | undefined, send: (id: number) => boolean): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new MuxCallError('disconnected'))
      if (signal?.aborted) return reject(new MuxCallError('cancelled'))
      const call: ClientCall = {
        id: 0,
        resolve,
        reject,
        signal,
        started: false,
        start: () => {
          call.started = true
          call.id = this.allocId()
          this.calls.set(call.id, call)
          let ok = false
          try {
            ok = send(call.id)
          } catch {
            ok = false
          }
          if (!ok) this.finishCall(call.id, new MuxCallError('too-large'))
        }
      }
      if (signal) {
        call.onAbort = () => {
          if (call.started) return this.cancelCall(call.id)
          const i = this.waiting.indexOf(call)
          if (i >= 0) this.waiting.splice(i, 1)
          reject(new MuxCallError('cancelled'))
        }
        signal.addEventListener('abort', call.onAbort, { once: true })
      }
      if (this.calls.size >= LIMITS.maxInFlightCalls) this.waiting.push(call)
      else call.start()
    })
  }

  private cancelCall(id: number): void {
    if (!this.calls.has(id)) return
    this.out.enqueue(PRIO.control, `{"t":"cancel","id":${id}}`)
    this.remember(id)
    this.dropOutgoing(id)
    this.endAssembly(id)
    this.finishCall(id, new MuxCallError('cancelled'))
  }

  private finishCall(id: number, err?: Error, value?: unknown): void {
    const c = this.calls.get(id)
    if (!c) return
    this.calls.delete(id)
    if (c.signal && c.onAbort) c.signal.removeEventListener('abort', c.onAbort)
    if (err) c.reject(err)
    else c.resolve(value)
    const next = this.waiting.shift()
    if (next) next.start()
  }

  private clientRes(f: Extract<MuxHostFrame, { t: 'res' }>): void {
    const sub = this.clientSubs.get(f.id)
    if (sub?.ready && !f.ok) {
      // El Mac cerró una suscripción ya lista (bloqueo del acceso): termina sin violación; el dueño decide si vuelve a suscribirse.
      this.clientSubs.delete(f.id)
      sub.h.onEnd?.(f.error.code)
      return
    }
    if (sub && !sub.ready) {
      if (!f.ok) {
        this.clientSubs.delete(f.id)
        sub.h.onEnd?.(f.error.code)
        return
      }
      const d = f.data as { seq?: unknown } | undefined
      if (
        f.ck !== undefined ||
        typeof d !== 'object' ||
        d === null ||
        typeof d.seq !== 'number' ||
        !Number.isSafeInteger(d.seq) ||
        d.seq < 0
      )
        return this.bad('bad-sub-ack')
      sub.ready = true
      sub.last = d.seq
      sub.h.onReady?.(d.seq)
      return
    }
    const call = this.calls.get(f.id)
    if (!call) {
      if (this.cancelled.has(f.id)) return
      return this.bad('res-unknown')
    }
    if (this.assemblies.has(f.id)) return this.bad('res-duplicate')
    if (!f.ok) return this.finishCall(f.id, new MuxCallError(f.error.code, f.error.msg))
    if (f.ck !== undefined) {
      if (!this.startAssembly({ t: 'res', id: f.id, ok: true, ck: f.ck }, f.ck)) return this.finishCall(f.id, new MuxCallError('too-large'))
      return
    }
    this.finishCall(f.id, undefined, f.data)
  }

  /** Suscripción a eventos de un motor. `since` = último `seq` visto (reanuda); sin él, solo eventos nuevos. */
  subscribe(eng: string, h: SubHandlers, since?: number): Subscription {
    const id = this.allocId()
    const sub: ClientSub = { id, eng, h, last: since ?? 0, ready: false, unacked: 0, owed: 0 }
    if (this.closed || this.clientSubs.size >= LIMITS.maxStreams) {
      queueMicrotask(() => h.onEnd?.(this.closed ? 'disconnected' : 'busy'))
      return { id, lastSeq: sub.last, cancel: () => undefined }
    }
    this.clientSubs.set(id, sub)
    const frame: SubFrame = { t: 'sub', id, eng }
    if (since !== undefined) frame.since = since
    this.out.enqueue(PRIO.control, JSON.stringify(frame))
    return {
      id,
      get lastSeq() {
        return sub.last
      },
      cancel: () => {
        if (!this.clientSubs.delete(id)) return
        this.remember(id)
        this.out.enqueue(PRIO.control, `{"t":"cancel","id":${id}}`)
      }
    }
  }

  private clientEv(f: EvFrame, bytes: number): void {
    const sub = this.clientSubs.get(f.s)
    if (!sub) {
      if (this.cancelled.has(f.s)) return
      return this.bad('ev-unknown-stream')
    }
    if (!sub.ready) return this.bad('ev-before-ack')
    sub.unacked += bytes
    if (sub.unacked > LIMITS.creditWindowBytes) return this.bad('flow')
    sub.owed += bytes
    if (sub.owed >= LIMITS.creditGrantBytes) {
      this.grant(sub.id, sub.owed)
      sub.unacked -= sub.owed
      sub.owed = 0
    }
    if (f.seq <= sub.last) return // repetida (p. ej. anterior a un `reset`): se descarta
    if (f.seq !== sub.last + 1) return this.bad('ev-gap')
    sub.last = f.seq
    const ev: { seq: number; ch?: string; oc?: string; p?: unknown } = { seq: f.seq }
    if (f.ch !== undefined) ev.ch = f.ch
    if (f.oc !== undefined) ev.oc = f.oc
    if ('p' in f) ev.p = f.p
    sub.h.onEvent(ev)
  }

  private clientReset(f: ResetFrame): void {
    const sub = this.clientSubs.get(f.s)
    if (!sub) {
      if (this.cancelled.has(f.s)) return
      return this.bad('reset-unknown-stream')
    }
    if (!sub.ready) return this.bad('reset-before-ack')
    if (f.seq < sub.last) return this.bad('reset-backwards')
    sub.last = f.seq
    sub.h.onReset?.(f.seq)
  }

  // ── cierre ──

  /** La conexión terminó: lo que estaba en vuelo falla con `disconnected` (las mutaciones nunca se reintentan solas). */
  close(why: MuxErrorCode = 'disconnected'): void {
    if (this.closed) return
    this.closed = true
    for (const ctrl of this.inflight.values()) ctrl?.abort()
    this.inflight.clear()
    for (const s of this.hostSubs.values()) s.unsub()
    this.hostSubs.clear()
    this.assemblies.clear()
    this.assemblingBytes = 0
    for (const id of [...this.outgoing.keys()]) this.dropOutgoing(id)
    // La cola de salida la cierra su dueño (puede llevar todavía un `bye`).
    const calls = [...this.calls.values()]
    this.calls.clear()
    const waiting = this.waiting.splice(0)
    for (const c of [...calls, ...waiting]) {
      if (c.signal && c.onAbort) c.signal.removeEventListener('abort', c.onAbort)
      c.reject(new MuxCallError(why))
    }
    const subs = [...this.clientSubs.values()]
    this.clientSubs.clear()
    for (const s of subs) s.h.onEnd?.(why)
  }
}
