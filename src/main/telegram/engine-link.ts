/**
 * Enlace de `main` con el motor OpenCode para el puente con Telegram.
 *
 * Hoy el renderer abre el flujo de eventos (`/global/event`) y contesta los permisos con el cliente del SDK; `main` no los veía.
 * Aquí `main` abre SU PROPIA suscripción (mismo cliente del SDK v2, mismas credenciales que ya conoce) y normaliza solo lo que el
 * puente necesita. No reutiliza nada del control remoto: es un módulo aparte, sin puertos y sin servidor.
 *
 * Responder un permiso es lo mismo que hace la pantalla (`replyPermission` del store de Code): `permission.reply` (v1) o
 * `v2.session.permission.reply` (v2). El motor contesta 404 si ya no está pendiente (lo contestó la pantalla): se informa como
 * `not-found` para que el puente diga «ya respondido en el computador».
 */
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { OpencodeConnection } from '@shared/types'
import { CHAT_AGENT } from '@shared/types'
import {
  effectiveModeFor,
  endsWithModeBlock,
  rulesetForMode,
  type PermissionModeId,
  type PermissionRuleLike
} from '@shared/permission-rules'

export interface EnginePermission {
  id: string
  sessionID: string
  /** Tipo (`bash`, `edit`, `external_directory`…). */
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  api: 'v1' | 'v2'
  /** Carpeta de la instancia del motor que lo pidió (hace falta para responder por la API v1). */
  directory?: string
}

export type EngineEvent =
  | { kind: 'permission-asked'; req: EnginePermission }
  | { kind: 'permission-replied'; id: string; reply: 'once' | 'always' | 'reject' }
  | { kind: 'question-asked'; id: string; sessionID: string; text: string }
  | { kind: 'question-closed'; id: string }
  | { kind: 'status'; sessionID: string; status: 'busy' | 'idle' | 'retry' }
  | { kind: 'session-info'; sessionID: string; title: string; parentID: string | null }
  | { kind: 'error'; sessionID: string | null; message: string }
  | { kind: 'activity'; sessionID: string }
  /** El flujo de eventos se abrió (de nuevo): puede haberse perdido algo mientras estuvo cortado. */
  | { kind: 'connected' }

/** Una sesión del motor, reducida a lo que el puente necesita (nada de su contenido). */
export interface EngineSessionInfo {
  id: string
  title: string
  /** Carpeta de la instancia del motor donde vive (hace falta para todas las llamadas). */
  directory: string
  kind: 'chat' | 'code'
  updatedAt: number
  busy: boolean
  /** Modo de permisos que reconoce la app por las reglas de la sesión; `unknown` si no coincide con ninguno. */
  mode: PermissionModeId | 'unknown'
  agent: string | null
}

/** Una parte de un mensaje, reducida. `output` solo viaja en herramientas terminadas (el puente decide si lo muestra). */
export interface EnginePart {
  id: string
  type: 'text' | 'reasoning' | 'tool' | 'file' | 'other'
  text?: string
  synthetic?: boolean
  ignored?: boolean
  tool?: string
  callID?: string
  state?: {
    status: string
    input: Record<string, unknown>
    title?: string
    output?: string
    error?: string
    diff?: string
    start?: number
    end?: number
  }
  filename?: string
  time?: { start?: number; end?: number }
}

export interface EngineMessage {
  id: string
  role: 'user' | 'assistant'
  created: number
  completed: boolean
  error: string
  agent: string | null
  model: { providerID: string; modelID: string } | null
  parts: EnginePart[]
}

export class EngineReplyError extends Error {
  constructor(
    readonly reason: 'not-found' | 'failed',
    message: string
  ) {
    super(message)
    this.name = 'EngineReplyError'
  }
}

export interface EngineLink {
  /** Empieza a escuchar (idempotente). */
  start(onEvent: (ev: EngineEvent) => void): void
  /** Deja de escuchar y cierra el flujo. */
  stop(): void
  /** Responde un permiso como lo hace la pantalla. Lanza `EngineReplyError`. */
  reply(req: EnginePermission, reply: 'once' | 'reject'): Promise<void>
  /** Ids de permisos que el motor tiene pendientes (para saber si ya los contestó la pantalla); `null` si no se pudo saber. */
  pendingIds(req: EnginePermission): Promise<Set<string> | null>
  /** Permisos pendientes conocidos al reconectar (mejor esfuerzo). */
  listPending(): Promise<EnginePermission[]>
  // ---- entrega 2: sesiones ----
  /** Sesiones recientes (sin subsesiones ni Tareas) de las carpetas dadas, más recientes primero. */
  listSessions(dirs: readonly { directory: string; kind: 'chat' | 'code' }[], limit: number): Promise<EngineSessionInfo[]>
  /** Una sesión; `null` si ya no existe (borrada); `'error'` si no se pudo leer. */
  getSession(directory: string, id: string, kind: 'chat' | 'code'): Promise<EngineSessionInfo | null | 'error'>
  /** Mensajes de una sesión (orden cronológico), o `null` si no se pudo leer. */
  messages(directory: string, id: string): Promise<EngineMessage[] | null>
  /** Manda un mensaje del usuario a la sesión (como `promptAsync` de la pantalla). Lanza `EngineReplyError`. */
  prompt(
    directory: string,
    id: string,
    input: {
      agent: string
      model?: { providerID: string; modelID: string }
      text: string
      files: { mime: string; filename: string; url: string }[]
    }
  ): Promise<void>
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Texto legible de un error de sesión del motor (nada de estructuras ni trazas). */
export function describeEngineError(err: unknown): string {
  const o = rec(err)
  if (!o) return typeof err === 'string' ? err : ''
  const data = rec(o.data)
  return str(data?.message) ?? str(o.message) ?? str(o.name) ?? ''
}

/** Convierte un evento global del motor (`{directory, payload}`) en lo que el puente entiende; `null` si no le interesa. */
export function normalizeEngineEvent(raw: unknown): EngineEvent | null {
  const ev = rec(raw)
  const payload = rec(ev?.payload)
  if (!ev || !payload) return null
  const type = str(payload.type)
  const p = rec(payload.properties)
  if (!type || !p) return null
  const directory = str(ev.directory) ?? undefined
  switch (type) {
    case 'permission.asked': {
      const id = str(p.id)
      const sessionID = str(p.sessionID)
      const permission = str(p.permission)
      if (!id || !sessionID || !permission) return null
      return {
        kind: 'permission-asked',
        req: {
          id,
          sessionID,
          permission,
          patterns: Array.isArray(p.patterns) ? p.patterns.filter((x): x is string => typeof x === 'string') : [],
          metadata: rec(p.metadata) ?? {},
          api: 'v1',
          directory
        }
      }
    }
    case 'permission.v2.asked': {
      const id = str(p.id)
      const sessionID = str(p.sessionID)
      const permission = str(p.action)
      if (!id || !sessionID || !permission) return null
      return {
        kind: 'permission-asked',
        req: {
          id,
          sessionID,
          permission,
          patterns: Array.isArray(p.resources) ? p.resources.filter((x): x is string => typeof x === 'string') : [],
          metadata: rec(p.metadata) ?? {},
          api: 'v2',
          directory
        }
      }
    }
    case 'permission.replied':
    case 'permission.v2.replied': {
      const id = str(p.requestID)
      const reply = p.reply
      if (!id) return null
      return { kind: 'permission-replied', id, reply: reply === 'always' || reply === 'reject' ? reply : 'once' }
    }
    case 'question.asked':
    case 'question.v2.asked': {
      const id = str(p.id)
      const sessionID = str(p.sessionID)
      if (!id || !sessionID) return null
      const first = Array.isArray(p.questions) ? rec(p.questions[0]) : null
      return { kind: 'question-asked', id, sessionID, text: str(first?.question) ?? str(first?.header) ?? '' }
    }
    case 'question.replied':
    case 'question.rejected':
    case 'question.v2.replied':
    case 'question.v2.rejected': {
      const id = str(p.requestID)
      return id ? { kind: 'question-closed', id } : null
    }
    case 'session.status': {
      const sessionID = str(p.sessionID)
      const st = str(rec(p.status)?.type)
      if (!sessionID || !st) return null
      return { kind: 'status', sessionID, status: st === 'idle' ? 'idle' : st === 'retry' ? 'retry' : 'busy' }
    }
    case 'session.idle': {
      const sessionID = str(p.sessionID)
      return sessionID ? { kind: 'status', sessionID, status: 'idle' } : null
    }
    case 'session.created':
    case 'session.updated': {
      const info = rec(p.info)
      const sessionID = str(info?.id)
      if (!info || !sessionID) return null
      return { kind: 'session-info', sessionID, title: str(info.title) ?? '', parentID: str(info.parentID) }
    }
    case 'session.error': {
      const error = rec(p.error)
      // El usuario detuvo la tarea: no es un error que avisar.
      if (str(error?.name) === 'MessageAbortedError') return null
      return { kind: 'error', sessionID: str(p.sessionID), message: describeEngineError(p.error) }
    }
    case 'message.updated': {
      const sid = str(rec(p.info)?.sessionID)
      return sid ? { kind: 'activity', sessionID: sid } : null
    }
    case 'message.part.updated': {
      const sid = str(rec(p.part)?.sessionID)
      return sid ? { kind: 'activity', sessionID: sid } : null
    }
    case 'message.part.delta': {
      const sid = str(p.sessionID)
      return sid ? { kind: 'activity', sessionID: sid } : null
    }
    default:
      return null
  }
}

/** Modo de permisos que tiene una sesión, deducido de sus reglas (el último bloque que la app le puso). */
export function permissionModeOf(
  rules: readonly PermissionRuleLike[] | undefined,
  agent: string | undefined
): PermissionModeId | 'unknown' {
  if (!rules || rules.length === 0) return 'unknown'
  for (const m of ['bypass', 'auto', 'acceptEdits', 'plan', 'manual'] as const) {
    if (endsWithModeBlock(rules, rulesetForMode(m))) return effectiveModeFor(m, agent)
  }
  return 'unknown'
}

const toPart = (raw: unknown): EnginePart => {
  const o = rec(raw) ?? {}
  const type = str(o.type)
  const id = str(o.id) ?? ''
  if (type === 'text' || type === 'reasoning') {
    const time = rec(o.time)
    return {
      id,
      type,
      text: str(o.text) ?? '',
      synthetic: o.synthetic === true,
      ignored: o.ignored === true,
      time: { start: typeof time?.start === 'number' ? time.start : undefined, end: typeof time?.end === 'number' ? time.end : undefined }
    }
  }
  if (type === 'tool') {
    const st = rec(o.state) ?? {}
    const time = rec(st.time)
    return {
      id,
      type: 'tool',
      tool: str(o.tool) ?? '',
      callID: str(o.callID) ?? undefined,
      state: {
        status: str(st.status) ?? 'pending',
        input: rec(st.input) ?? {},
        title: str(st.title) ?? undefined,
        output: str(st.output) ?? undefined,
        error: str(st.error) ?? undefined,
        diff: str(rec(st.metadata)?.diff) ?? undefined,
        start: typeof time?.start === 'number' ? time.start : undefined,
        end: typeof time?.end === 'number' ? time.end : undefined
      }
    }
  }
  if (type === 'file') return { id, type: 'file', filename: str(o.filename) ?? undefined }
  return { id, type: 'other' }
}

/** Convierte `{info, parts}` del motor en un mensaje reducido; `null` si no es un mensaje válido. */
export function toEngineMessage(raw: unknown): EngineMessage | null {
  const o = rec(raw)
  const info = rec(o?.info)
  const id = str(info?.id)
  const role = str(info?.role)
  if (!info || !id || (role !== 'user' && role !== 'assistant')) return null
  const time = rec(info.time)
  const model = rec(info.model)
  const err = rec(info.error)
  const providerID = str(model?.providerID)
  const modelID = str(model?.modelID)
  return {
    id,
    role,
    created: typeof time?.created === 'number' ? time.created : 0,
    completed: typeof time?.completed === 'number',
    error: err ? describeEngineError(err) || str(err.name) || 'error' : '',
    agent: str(info.agent),
    model: providerID && modelID ? { providerID, modelID } : null,
    parts: Array.isArray(o?.parts) ? o.parts.map(toPart) : []
  }
}

/** ¿Es una sesión de Tareas (Overdrive) o una subsesión? Esas nunca se ofrecen. */
export function isHiddenSession(s: Record<string, unknown>): boolean {
  return rec(s.metadata)?.mode === 'tasks' || !!str(s.parentID)
}

export function toSessionInfo(raw: unknown, directory: string, kind: 'chat' | 'code', busy: boolean): EngineSessionInfo | null {
  const s = rec(raw)
  const id = str(s?.id)
  if (!s || !id || isHiddenSession(s)) return null
  const time = rec(s.time)
  const rules = Array.isArray(s.permission) ? (s.permission as PermissionRuleLike[]) : undefined
  const agent = str(s.agent)
  return {
    id,
    title: str(s.title) ?? '',
    directory,
    kind,
    updatedAt: typeof time?.updated === 'number' ? time.updated : 0,
    busy,
    mode: kind === 'chat' ? 'unknown' : permissionModeOf(rules, agent ?? undefined),
    agent
  }
}

/** Agente con el que se escribe a una sesión: el de Chat, o `plan`/`build` en Code (como el celular). */
export function agentFor(kind: 'chat' | 'code', agent: string | null | undefined): string {
  return kind === 'chat' ? CHAT_AGENT : agent === 'plan' ? 'plan' : 'build'
}

export interface EngineLinkDeps {
  getConnection: () => Promise<OpencodeConnection>
  /** Tiempo entre reintentos (ms; crece al doble hasta 10 s). */
  backoffMs?: number
}

type ReplyResult = { error?: unknown; response?: { status?: number } }

export function createEngineLink(deps: EngineLinkDeps): EngineLink {
  let ctl: AbortController | null = null
  let cached: { key: string; client: OpencodeClient } | null = null

  const clientOf = async (): Promise<OpencodeClient> => {
    const conn = await deps.getConnection()
    const key = `${conn.baseUrl}|${conn.authorization}`
    if (cached?.key !== key) {
      cached = { key, client: createOpencodeClient({ baseUrl: conn.baseUrl, headers: { Authorization: conn.authorization } }) }
    }
    return cached.client
  }

  const loop = async (signal: AbortSignal, onEvent: (ev: EngineEvent) => void): Promise<void> => {
    let attempt = 0
    while (!signal.aborted) {
      try {
        const client = await clientOf()
        const { stream } = await client.global.event({ signal, sseMaxRetryAttempts: 0 })
        let opened = false
        for await (const raw of stream) {
          if (signal.aborted) return
          if (!opened) {
            opened = true
            attempt = 0
            onEvent({ kind: 'connected' })
          }
          const ev = normalizeEngineEvent(raw)
          if (ev) onEvent(ev)
        }
      } catch {
        /* se reintenta */
      }
      if (signal.aborted) return
      attempt++
      const base = deps.backoffMs ?? 500
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, Math.min(base * 2 ** attempt, 10_000))
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            resolve()
          },
          { once: true }
        )
      })
    }
  }

  return {
    start(onEvent) {
      if (ctl) return
      ctl = new AbortController()
      void loop(ctl.signal, onEvent)
    },
    stop() {
      ctl?.abort()
      ctl = null
    },
    async reply(req, reply) {
      let res: ReplyResult
      try {
        const client = await clientOf()
        if (req.api === 'v2') {
          res = (await client.v2.session.permission.reply({ sessionID: req.sessionID, requestID: req.id, reply })) as ReplyResult
        } else {
          res = (await client.permission.reply({ requestID: req.id, reply, directory: req.directory })) as ReplyResult
        }
      } catch (err) {
        throw new EngineReplyError('failed', err instanceof Error ? err.message : 'error')
      }
      if (res.error) {
        const status = res.response?.status
        const tag = rec(res.error)?._tag
        throw new EngineReplyError(status === 404 || tag === 'PermissionNotFoundError' ? 'not-found' : 'failed', `engine ${status ?? '?'}`)
      }
    },
    async pendingIds(req) {
      try {
        const client = await clientOf()
        const r = await client.permission.list({ directory: req.directory })
        const data = (r as { data?: unknown }).data
        if (!Array.isArray(data)) return null
        return new Set(data.map((x) => str(rec(x)?.id)).filter((x): x is string => !!x))
      } catch {
        return null
      }
    },
    async listSessions(dirs, limit) {
      const out: EngineSessionInfo[] = []
      try {
        const client = await clientOf()
        await Promise.all(
          dirs.map(async ({ directory, kind }) => {
            const [list, status] = await Promise.all([
              client.session.list({ directory, roots: true, limit }).catch(() => null),
              client.session.status({ directory }).catch(() => null)
            ])
            const statuses = (rec((status as { data?: unknown } | null)?.data) ?? {}) as Record<string, unknown>
            const data = (list as { data?: unknown } | null)?.data
            if (!Array.isArray(data)) return
            for (const x of data) {
              const id = str(rec(x)?.id)
              const busy = !!id && !!statuses[id] && str(rec(statuses[id])?.type) !== 'idle'
              const info = toSessionInfo(x, directory, kind, busy)
              if (info) out.push(info)
            }
          })
        )
      } catch {
        return []
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
    },
    async getSession(directory, id, kind) {
      try {
        const client = await clientOf()
        const [res, status] = await Promise.all([
          client.session.get({ sessionID: id, directory }),
          client.session.status({ directory }).catch(() => null)
        ])
        const r = res as { data?: unknown; error?: unknown; response?: { status?: number } }
        if (r.error || !r.data) return r.response?.status === 404 || rec(r.error)?._tag === 'NotFoundError' ? null : 'error'
        const statuses = (rec((status as { data?: unknown } | null)?.data) ?? {}) as Record<string, unknown>
        const busy = !!statuses[id] && str(rec(statuses[id])?.type) !== 'idle'
        return toSessionInfo(r.data, directory, kind, busy) ?? null
      } catch {
        return 'error'
      }
    },
    async messages(directory, id) {
      try {
        const client = await clientOf()
        const res = (await client.session.messages({ sessionID: id, directory })) as { data?: unknown; error?: unknown }
        if (res.error || !Array.isArray(res.data)) return null
        const out = res.data.map(toEngineMessage).filter((m): m is EngineMessage => m !== null)
        return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      } catch {
        return null
      }
    },
    async prompt(directory, id, input) {
      let res: { error?: unknown; response?: { status?: number } }
      try {
        const client = await clientOf()
        res = (await client.session.promptAsync({
          sessionID: id,
          directory,
          agent: input.agent,
          model: input.model ? { providerID: input.model.providerID, modelID: input.model.modelID } : undefined,
          parts: [
            ...(input.text || input.files.length === 0 ? [{ type: 'text' as const, text: input.text }] : []),
            ...input.files.map((f) => ({ type: 'file' as const, mime: f.mime, filename: f.filename, url: f.url }))
          ]
        })) as typeof res
      } catch (err) {
        throw new EngineReplyError('failed', err instanceof Error ? err.message : 'error')
      }
      if (res.error)
        throw new EngineReplyError(res.response?.status === 404 ? 'not-found' : 'failed', `engine ${res.response?.status ?? '?'}`)
    },
    async listPending() {
      try {
        const client = await clientOf()
        const r = await client.permission.list({})
        const data = (r as { data?: unknown }).data
        if (!Array.isArray(data)) return []
        const out: EnginePermission[] = []
        for (const x of data) {
          const o = rec(x)
          const id = str(o?.id)
          const sessionID = str(o?.sessionID)
          const permission = str(o?.permission)
          if (!o || !id || !sessionID || !permission) continue
          out.push({
            id,
            sessionID,
            permission,
            patterns: Array.isArray(o.patterns) ? o.patterns.filter((v): v is string => typeof v === 'string') : [],
            metadata: rec(o.metadata) ?? {},
            api: 'v1'
          })
        }
        return out
      } catch {
        return []
      }
    }
  }
}
