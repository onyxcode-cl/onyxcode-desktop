/**
 * Del motor al celular: recorte de mensajes/sesiones/permisos (texto y resumen de herramientas, NUNCA rutas
 * absolutas ni secretos) y puente de los eventos SSE del motor (`client.global.event()`), que solo corre
 * mientras haya un celular conectado.
 */
import type { Message, Part, PermissionRequest, Session } from '@opencode-ai/sdk/v2/client'
import { t } from '@shared/i18n'
import { maskSecretPatterns } from '@shared/redact-patterns'
import { LIMITS, utf8Length } from '@shared/remote/protocol'
import type { RemoteEvent, RemoteMessage, RemotePart, RemotePermission, RemoteSession, SessionStatus } from '@shared/remote/protocol'

// ───────────────────────────── recorte de texto ─────────────────────────────

const SEG = String.raw`[\w.@%+=~-]+`
/** Rutas absolutas POSIX (`/Users/x/y.ts`), de usuario (`~/x`) y de Windows (`C:\x\y`). */
const ABS_PATH_RE = new RegExp(
  [
    String.raw`(?<![\w:/.~])\/${SEG}(?:\/${SEG})+\/?`,
    String.raw`(?<![\w:/.])~\/${SEG}(?:\/${SEG})*\/?`,
    String.raw`\b[A-Za-z]:\\${SEG}(?:\\${SEG})*\\?`
  ].join('|'),
  'g'
)

/** Sustituye una ruta absoluta por `…/nombre` (solo el último componente). */
export function shortenPaths(text: string): string {
  return text.replace(ABS_PATH_RE, (m) => {
    const parts = m.split(/[\\/]/).filter(Boolean)
    const last = parts[parts.length - 1]
    return last ? `…/${last}` : '…'
  })
}

/** Texto que sale del equipo: sin secretos ni rutas absolutas, y recortado a `max`. */
export function scrubText(text: string, max: number): string {
  const clean = shortenPaths(maskSecretPatterns(text))
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean
}

function firstLine(s: string): string {
  const i = s.search(/[\r\n]/)
  return i < 0 ? s : s.slice(0, i)
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Resumen corto de una llamada a herramienta (sin rutas absolutas ni secretos). */
export function toolSummary(tool: string, input: Record<string, unknown> | undefined, title?: string): string {
  const i = input ?? {}
  let raw: string | null = null
  switch (tool) {
    case 'bash':
      raw = str(i.command)
      break
    case 'read':
    case 'edit':
    case 'write':
    case 'patch': {
      const p = str(i.filePath) ?? str(i.path)
      raw = p ? baseName(p) : null
      break
    }
    case 'glob':
    case 'grep':
      raw = str(i.pattern)
      break
    case 'webfetch': {
      const u = str(i.url)
      raw = u ? u.replace(/[?#].*$/, '') : null
      break
    }
    case 'websearch':
      raw = str(i.query)
      break
    case 'task':
      raw = str(i.description)
      break
    default:
      raw = null
  }
  const text = raw ?? title ?? ''
  return scrubText(firstLine(text), LIMITS.maxToolSummaryChars)
}

// ───────────────────────────── mensajes ─────────────────────────────

function toRemotePart(p: Part): RemotePart | null {
  if (p.type === 'text') {
    if (p.synthetic || p.ignored || !p.text.trim()) return null
    return { type: 'text', text: scrubText(p.text, LIMITS.maxTextPartChars) }
  }
  if (p.type === 'tool') {
    const st = p.state
    const status = st.status === 'completed' ? 'done' : st.status === 'error' ? 'error' : 'running'
    const title = st.status === 'running' || st.status === 'completed' ? st.title : undefined
    return { type: 'tool', name: scrubText(p.tool, 80), summary: toolSummary(p.tool, st.input, title), status }
  }
  return null
}

export function toRemoteMessage(info: Message, parts: readonly Part[]): RemoteMessage {
  const out: RemotePart[] = []
  for (const p of parts) {
    const r = toRemotePart(p)
    if (r) out.push(r)
    if (out.length >= LIMITS.maxPartsPerMessage) break
  }
  const streaming = info.role === 'assistant' && !info.time.completed && !info.error
  const msg: RemoteMessage = {
    id: info.id,
    sessionId: info.sessionID,
    role: info.role,
    createdAt: info.time.created,
    parts: out
  }
  if (streaming) msg.streaming = true
  return msg
}

/** Tamaño en bytes de un mensaje ya serializado dentro de una trama (con holgura). */
export function messageBytes(m: RemoteMessage): number {
  return utf8Length(JSON.stringify(m)) + 2
}

/**
 * Deja el mensaje por debajo de `maxBytes` recortando texto (el último texto primero) y, si hace falta,
 * quitando partes del principio. Nunca devuelve algo que no quepa.
 */
export function fitMessage(m: RemoteMessage, maxBytes: number): RemoteMessage {
  let cur = m
  let guard = 0
  while (messageBytes(cur) > maxBytes && guard++ < 200) {
    const parts = [...cur.parts]
    const idx = parts.findIndex((p) => p.type === 'text' && p.text.length > 200)
    if (idx >= 0) {
      const p = parts[idx] as Extract<RemotePart, { type: 'text' }>
      parts[idx] = { type: 'text', text: `${p.text.slice(0, Math.floor(p.text.length / 2))}…` }
    } else if (parts.length > 1) {
      parts.shift()
    } else {
      parts.length = 0
    }
    cur = { ...cur, parts }
    if (parts.length === 0) break
  }
  return cur
}

// ───────────────────────────── sesiones ─────────────────────────────

export function toRemoteSession(s: Session, kind: 'chat' | 'code', status: SessionStatus, project?: string): RemoteSession {
  const title = s.title && s.title.trim() ? scrubText(firstLine(s.title.trim()), LIMITS.maxTitleChars) : t('remote.session.untitled')
  const out: RemoteSession = { id: s.id, title, kind, updatedAt: s.time.updated, status }
  if (kind === 'code' && project) out.project = scrubText(project, 200)
  return out
}

// ───────────────────────────── permisos ─────────────────────────────

/** Permisos que se pueden aprobar «una vez» desde el celular. Todo lo demás se aprueba solo en el Mac. */
const ACTIONABLE = new Set(['bash', 'edit', 'write', 'patch', 'read', 'glob', 'grep', 'list', 'webfetch', 'websearch', 'task'])

function permTitle(permission: string): string {
  switch (permission) {
    case 'bash':
      return t('remote.perm.bash')
    case 'edit':
    case 'write':
    case 'patch':
      return t('remote.perm.edit')
    case 'read':
    case 'glob':
    case 'grep':
    case 'list':
      return t('remote.perm.read')
    case 'webfetch':
    case 'websearch':
      return t('remote.perm.web')
    case 'task':
      return t('remote.perm.task')
    case 'external_directory':
      return t('remote.perm.folder')
    default:
      return permission.startsWith('computer_') || permission.startsWith('browser_') ? t('remote.perm.mac') : t('remote.perm.other')
  }
}

export function toRemotePermission(p: PermissionRequest): RemotePermission {
  const actionable = ACTIONABLE.has(p.permission)
  const detail = (p.patterns ?? []).map((x) => firstLine(String(x))).join(', ')
  const summary = actionable
    ? scrubText(detail, LIMITS.maxPermissionSummaryChars)
    : scrubText(t('remote.perm.approveOnMac'), LIMITS.maxPermissionSummaryChars)
  return {
    requestId: p.id,
    sessionId: p.sessionID,
    title: scrubText(permTitle(p.permission), LIMITS.maxTitleChars),
    summary,
    actionable
  }
}

// ───────────────────────────── puente de eventos SSE ─────────────────────────────

/** Lo que el puente necesita del respaldo (ámbito de sesiones, lectura de mensajes). */
export interface EventSource {
  /** Sesión en el ámbito expuesto (Chat o proyectos recientes de Code), o `null`. Nunca Tareas. */
  scopeSession(sessionId: string, directory?: string): Promise<RemoteSession | null>
  /** Mensaje ya recortado, o `null` si no existe. */
  loadMessage(sessionId: string, messageId: string): Promise<RemoteMessage | null>
  /** Estado en caché de una sesión conocida. */
  cachedSession(sessionId: string): RemoteSession | null
  forgetSession(sessionId: string): void
  setCachedStatus(sessionId: string, status: SessionStatus): void
  /** Aplica la ficha de una sesión (evento `session.updated`); `null` si queda fuera del ámbito. */
  applySessionInfo(info: Session, directory?: string): RemoteSession | null
}

export interface GlobalEventLike {
  directory?: string
  payload: { type: string; properties?: Record<string, unknown> }
}

export type EventStreamClient = {
  global: {
    event(opts: { signal: AbortSignal; sseMaxRetryAttempts: number }): Promise<{ stream: AsyncIterable<unknown> }>
  }
}

const THROTTLE_MS = 400

export interface EventBridgeOptions {
  getClient: () => EventStreamClient | null
  source: EventSource
  emit: (ev: RemoteEvent) => void
  /** Se llama con cada permiso nuevo en el ámbito (para que quien lo use aplique su lógica). */
  onPermissionAsked?: (p: PermissionRequest) => RemotePermission | null
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

/** Suscripción al stream global del motor mientras haya un celular conectado. Cada evento se filtra por ámbito. */
export class EventBridge {
  private controller: AbortController | null = null
  private stopped = true
  private pendingMessages = new Map<string, unknown>()
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void

  constructor(private readonly o: EventBridgeOptions) {
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout))
  }

  get running(): boolean {
    return !this.stopped
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
    this.controller = null
    for (const h of this.pendingMessages.values()) this.clearTimer(h)
    this.pendingMessages.clear()
  }

  private async loop(): Promise<void> {
    let attempt = 0
    while (!this.stopped) {
      const client = this.o.getClient()
      if (client) {
        const controller = new AbortController()
        this.controller = controller
        try {
          const { stream } = await client.global.event({ signal: controller.signal, sseMaxRetryAttempts: 0 })
          for await (const ev of stream) {
            attempt = 0
            if (this.stopped) return
            await this.handle(ev as GlobalEventLike).catch(() => undefined)
          }
        } catch {
          // reconexión abajo
        }
      }
      if (this.stopped) return
      attempt++
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 10_000)))
    }
  }

  /** Procesa un evento (público para las pruebas). */
  async handle(ev: GlobalEventLike): Promise<void> {
    const type = ev?.payload?.type
    const p = ev?.payload?.properties
    if (typeof type !== 'string' || !p) return
    const dir = typeof ev.directory === 'string' ? ev.directory : undefined
    const sid = (typeof p.sessionID === 'string' ? p.sessionID : undefined) ?? undefined
    switch (type) {
      case 'session.updated': {
        const info = p.info as Session | undefined
        if (!info || typeof info.id !== 'string' || info.parentID) return
        const s = this.o.source.applySessionInfo(info, info.directory ?? dir)
        if (s) this.o.emit({ e: 'session.updated', session: s })
        return
      }
      case 'session.deleted': {
        const info = p.info as Session | undefined
        const id = info?.id ?? sid
        if (!id || !isSafeId(id)) return
        if (this.o.source.cachedSession(id)) {
          this.o.source.forgetSession(id)
          this.o.emit({ e: 'session.removed', sessionId: id })
        }
        return
      }
      case 'session.status':
      case 'session.idle': {
        if (!sid) return
        const cur = this.o.source.cachedSession(sid)
        if (!cur) return
        const raw = (p.status as { type?: string } | undefined)?.type
        const status: SessionStatus = type === 'session.idle' || raw === 'idle' ? 'idle' : 'busy'
        if (status !== cur.status) {
          this.o.source.setCachedStatus(sid, status)
          this.o.emit({ e: 'session.updated', session: { ...cur, status } })
        }
        return
      }
      case 'message.updated': {
        const info = p.info as Message | undefined
        if (!info || typeof info.id !== 'string' || !sid) return
        this.scheduleMessage(sid, info.id)
        return
      }
      case 'message.part.updated': {
        const part = p.part as Part | undefined
        if (!part || !sid || typeof part.messageID !== 'string') return
        this.scheduleMessage(sid, part.messageID)
        return
      }
      case 'message.part.delta': {
        const mid = typeof p.messageID === 'string' ? p.messageID : undefined
        if (!sid || !mid) return
        this.scheduleMessage(sid, mid)
        return
      }
      case 'permission.asked': {
        const req = p as unknown as PermissionRequest
        if (typeof req.id !== 'string' || typeof req.sessionID !== 'string') return
        const s = await this.o.source.scopeSession(req.sessionID, dir)
        if (!s) return
        const perm = this.o.onPermissionAsked ? this.o.onPermissionAsked(req) : toRemotePermission(req)
        if (perm) this.o.emit({ e: 'permission.asked', permission: perm })
        return
      }
      case 'permission.replied': {
        const rid = typeof p.requestID === 'string' ? p.requestID : undefined
        if (rid && isSafeId(rid)) this.o.emit({ e: 'permission.resolved', requestId: rid })
        return
      }
      default:
        return
    }
  }

  private scheduleMessage(sessionId: string, messageId: string): void {
    const key = `${sessionId}/${messageId}`
    if (this.pendingMessages.has(key)) return
    const h = this.setTimer(() => {
      this.pendingMessages.delete(key)
      if (this.stopped) return
      void this.o.source
        .scopeSession(sessionId)
        .then((s) => (s ? this.o.source.loadMessage(sessionId, messageId) : null))
        .then((m) => {
          if (m && !this.stopped) this.o.emit({ e: 'message.updated', message: m })
        })
        .catch(() => undefined)
    }, THROTTLE_MS)
    this.pendingMessages.set(key, h)
  }
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}
