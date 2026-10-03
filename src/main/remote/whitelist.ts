/**
 * Lista blanca estricta entre el celular y el motor. El celular NO recibe nunca la contraseña del sidecar ni
 * acceso directo a él: el escritorio es el intermediario y solo ejecuta estas cinco operaciones
 * (`sessions.list`, `session.messages`, `session.prompt`, `session.abort`, `permission.reply` solo `once`/`reject`).
 *
 * Ámbito: sesiones de Chat y de los proyectos recientes de Code (las mismas que lista la app en el motor
 * principal). Las de Tareas viven en otros motores y nunca se exponen; tampoco las subsesiones ni las marcadas
 * como Tareas. Un id fuera de ese ámbito responde `not-found`.
 */
import { existsSync } from 'node:fs'
import type { OpencodeClient, Session } from '@opencode-ai/sdk/v2/client'
import { CHAT_AGENT } from '@shared/types'
import { LIMITS, utf8Length } from '@shared/remote/protocol'
import type {
  HostFrame,
  RemoteErrorCode,
  RemoteMessage,
  RemotePermission,
  RemoteSession,
  Reply,
  RequestFrame,
  RequestResults,
  SessionStatus
} from '@shared/remote/protocol'
import { fitMessage, toRemoteMessage, toRemotePermission, toRemoteSession, messageBytes, type EventSource } from './events'

export class RemoteError extends Error {
  constructor(readonly code: RemoteErrorCode) {
    super(code)
  }
}

export interface RemoteBackend {
  listSessions(): Promise<RequestResults['sessions.list']>
  messages(sessionId: string, limit: number, before?: string): Promise<RequestResults['session.messages']>
  prompt(sessionId: string, text: string): Promise<void>
  abort(sessionId: string): Promise<void>
  replyPermission(requestId: string, reply: Reply): Promise<void>
}

/** Ejecuta una petición YA VALIDADA (`parseClientFrame`) y devuelve la trama de respuesta. Nunca lanza. */
export async function dispatch(frame: RequestFrame, backend: RemoteBackend): Promise<HostFrame> {
  const id = frame.id
  const fail = (code: RemoteErrorCode): HostFrame => ({ t: 'res', id, ok: false, error: { code } })
  try {
    switch (frame.m) {
      case 'sessions.list':
        return { t: 'res', id, ok: true, m: 'sessions.list', result: await backend.listSessions() }
      case 'session.messages':
        return {
          t: 'res',
          id,
          ok: true,
          m: 'session.messages',
          result: await backend.messages(frame.p.sessionId, frame.p.limit, frame.p.before)
        }
      case 'session.prompt':
        await backend.prompt(frame.p.sessionId, frame.p.text)
        return { t: 'res', id, ok: true, m: 'session.prompt', result: { accepted: true } }
      case 'session.abort':
        await backend.abort(frame.p.sessionId)
        return { t: 'res', id, ok: true, m: 'session.abort', result: { aborted: true } }
      case 'permission.reply':
        await backend.replyPermission(frame.p.requestId, frame.p.reply)
        return { t: 'res', id, ok: true, m: 'permission.reply', result: { replied: true } }
      default:
        return fail('bad-request')
    }
  } catch (err) {
    return fail(err instanceof RemoteError ? err.code : 'failed')
  }
}

// ───────────────────────────── respaldo real (SDK v2) ─────────────────────────────

export interface SidecarBackendDeps {
  /** Cliente del motor principal (lo arranca si hace falta); lanza si no está disponible. */
  getClient: () => Promise<OpencodeClient>
  chatDirectory: string
  /** Carpetas recientes de Code (más reciente primero). */
  getRecentFolders: () => string[]
  /** Modelo elegido para el modo (o `undefined` = el predeterminado del motor). */
  modelFor: (kind: 'chat' | 'code') => { providerID: string; modelID: string } | undefined
  dirExists?: (p: string) => boolean
  now?: () => number
}

interface ScopeEntry {
  directory: string
  kind: 'chat' | 'code'
  session: RemoteSession
  agent?: string
}

const MAX_CODE_DIRS = 5
const PER_DIR_LIMIT = 20
const REFRESH_MIN_MS = 1500
/** Presupuesto de bytes de las respuestas de mensajes (la trama admite 64 KiB). */
const MESSAGES_BUDGET = LIMITS.maxFrameBytes - 6 * 1024

const norm = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)
const sameDir = (a: string, b: string): boolean => norm(a) === norm(b)
const isTasksSession = (s: Session): boolean => s.metadata?.mode === 'tasks' || !!s.parentID

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export class SidecarBackend implements RemoteBackend, EventSource {
  private scope = new Map<string, ScopeEntry>()
  private lastRefresh = 0
  private refreshing: Promise<void> | null = null

  constructor(private readonly d: SidecarBackendDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  /** Directorios expuestos: Chat y los proyectos recientes de Code que existen. */
  allowedDirs(): Array<{ directory: string; kind: 'chat' | 'code' }> {
    const exists = this.d.dirExists ?? existsSync
    const out: Array<{ directory: string; kind: 'chat' | 'code' }> = [{ directory: this.d.chatDirectory, kind: 'chat' }]
    for (const f of this.d.getRecentFolders()) {
      if (out.length > MAX_CODE_DIRS) break
      if (typeof f !== 'string' || !f || sameDir(f, this.d.chatDirectory) || out.some((o) => sameDir(o.directory, f))) continue
      if (exists(f)) out.push({ directory: f, kind: 'code' })
    }
    return out
  }

  private dirKind(directory: string): 'chat' | 'code' | null {
    return this.allowedDirs().find((x) => sameDir(x.directory, directory))?.kind ?? null
  }

  /** Relee las sesiones del ámbito y rehace el mapa (una sola lectura en vuelo). */
  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const client = await this.d.getClient()
      const next = new Map<string, ScopeEntry>()
      await Promise.all(
        this.allowedDirs().map(async ({ directory, kind }) => {
          const [list, status] = await Promise.all([
            client.session.list({ directory, roots: true, limit: PER_DIR_LIMIT }).catch(() => null),
            client.session.status({ directory }).catch(() => null)
          ])
          const statuses = (status?.data ?? {}) as Record<string, { type?: string }>
          for (const s of list?.data ?? []) {
            if (isTasksSession(s) || typeof s.id !== 'string') continue
            const st: SessionStatus = statuses[s.id] && statuses[s.id].type !== 'idle' ? 'busy' : 'idle'
            next.set(s.id, {
              directory,
              kind,
              agent: s.agent,
              session: toRemoteSession(s, kind, st, kind === 'code' ? baseName(directory) : undefined)
            })
          }
        })
      )
      this.scope = next
      this.lastRefresh = this.now()
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** Entrada del ámbito para `sessionId`; relee una vez (con freno) si no se conoce. */
  private async entry(sessionId: string): Promise<ScopeEntry | null> {
    const hit = this.scope.get(sessionId)
    if (hit) return hit
    if (this.now() - this.lastRefresh >= REFRESH_MIN_MS) {
      await this.refresh()
      return this.scope.get(sessionId) ?? null
    }
    return null
  }

  async listSessions(): Promise<RequestResults['sessions.list']> {
    await this.refresh()
    const sessions = [...this.scope.values()]
      .map((e) => e.session)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, LIMITS.maxSessionsListed)
    const client = await this.d.getClient()
    const permissions: RemotePermission[] = []
    await Promise.all(
      this.allowedDirs().map(async ({ directory }) => {
        const res = await client.permission.list({ directory }).catch(() => null)
        for (const p of res?.data ?? []) {
          if (this.scope.has(p.sessionID)) permissions.push(toRemotePermission(p))
        }
      })
    )
    return { sessions, permissions: permissions.slice(0, 50) }
  }

  async messages(sessionId: string, limit: number, before?: string): Promise<RequestResults['session.messages']> {
    const e = await this.entry(sessionId)
    if (!e) throw new RemoteError('not-found')
    const client = await this.d.getClient()
    const res = await client.session.messages({ sessionID: sessionId, directory: e.directory })
    if (res.error || !res.data) throw new RemoteError('failed')
    const all = [...res.data].sort((a, b) => (a.info.id < b.info.id ? -1 : a.info.id > b.info.id ? 1 : 0))
    const eligible = before ? all.filter((m) => m.info.id < before) : all
    const wanted = eligible.slice(-limit)
    // De la más nueva hacia atrás hasta llenar el presupuesto de la trama.
    const picked: RemoteMessage[] = []
    let used = 0
    for (let i = wanted.length - 1; i >= 0; i--) {
      const m = fitMessage(toRemoteMessage(wanted[i].info, wanted[i].parts), MESSAGES_BUDGET)
      const size = messageBytes(m)
      if (used + size > MESSAGES_BUDGET && picked.length > 0) break
      picked.unshift(m)
      used += size
    }
    const hasMore = eligible.length > picked.length
    return { sessionId, messages: picked, hasMore }
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    if (utf8Length(text) > LIMITS.maxPromptChars * 4) throw new RemoteError('bad-request')
    const e = await this.entry(sessionId)
    if (!e) throw new RemoteError('not-found')
    const client = await this.d.getClient()
    const agent = e.kind === 'chat' ? CHAT_AGENT : e.agent === 'plan' ? 'plan' : 'build'
    const model = this.d.modelFor(e.kind)
    const res = await client.session.promptAsync({
      sessionID: sessionId,
      directory: e.directory,
      agent,
      model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      parts: [{ type: 'text', text }]
    })
    if ((res as { error?: unknown }).error) throw new RemoteError('failed')
  }

  async abort(sessionId: string): Promise<void> {
    const e = await this.entry(sessionId)
    if (!e) throw new RemoteError('not-found')
    const client = await this.d.getClient()
    const res = await client.session.abort({ sessionID: sessionId, directory: e.directory })
    if ((res as { error?: unknown }).error) throw new RemoteError('failed')
  }

  async replyPermission(requestId: string, reply: Reply): Promise<void> {
    if (reply !== 'once' && reply !== 'reject') throw new RemoteError('bad-request')
    const client = await this.d.getClient()
    await this.refresh()
    for (const { directory } of this.allowedDirs()) {
      const res = await client.permission.list({ directory }).catch(() => null)
      const found = (res?.data ?? []).find((p) => p.id === requestId)
      if (!found) continue
      if (!this.scope.has(found.sessionID)) throw new RemoteError('not-found')
      if (!toRemotePermission(found).actionable) throw new RemoteError('forbidden')
      const out = await client.permission.reply({ requestID: requestId, directory, reply })
      if ((out as { error?: unknown }).error) throw new RemoteError('failed')
      return
    }
    throw new RemoteError('not-found')
  }

  // ── EventSource ──

  async scopeSession(sessionId: string, directory?: string): Promise<RemoteSession | null> {
    const hit = this.scope.get(sessionId)
    if (hit) return hit.session
    if (directory) {
      const kind = this.dirKind(directory)
      if (kind) {
        const client = await this.d.getClient()
        const res = await client.session.get({ sessionID: sessionId, directory }).catch(() => null)
        const s = res?.data
        if (s && !isTasksSession(s)) {
          const dir = this.allowedDirs().find((x) => sameDir(x.directory, directory))!.directory
          const session = toRemoteSession(s, kind, 'idle', kind === 'code' ? baseName(dir) : undefined)
          this.scope.set(sessionId, { directory: dir, kind, agent: s.agent, session })
          return session
        }
        return null
      }
    }
    return (await this.entry(sessionId))?.session ?? null
  }

  async loadMessage(sessionId: string, messageId: string): Promise<RemoteMessage | null> {
    const e = this.scope.get(sessionId)
    if (!e) return null
    const client = await this.d.getClient()
    const res = await client.session.message({ sessionID: sessionId, messageID: messageId, directory: e.directory }).catch(() => null)
    const data = res?.data
    if (!data) return null
    return fitMessage(toRemoteMessage(data.info, data.parts), MESSAGES_BUDGET)
  }

  cachedSession(sessionId: string): RemoteSession | null {
    const e = this.scope.get(sessionId)
    return e ? e.session : null
  }

  forgetSession(sessionId: string): void {
    this.scope.delete(sessionId)
  }

  setCachedStatus(sessionId: string, status: SessionStatus): void {
    const e = this.scope.get(sessionId)
    if (e) e.session = { ...e.session, status }
  }

  applySessionInfo(info: Session, directory?: string): RemoteSession | null {
    if (isTasksSession(info) || typeof info.id !== 'string') return null
    const dir = directory ? this.allowedDirs().find((x) => sameDir(x.directory, directory)) : undefined
    const known = this.scope.get(info.id)
    const where = dir ?? (known ? { directory: known.directory, kind: known.kind } : undefined)
    if (!where) return null
    const status = known?.session.status ?? 'idle'
    const session = toRemoteSession(info, where.kind, status, where.kind === 'code' ? baseName(where.directory) : undefined)
    this.scope.set(info.id, { directory: where.directory, kind: where.kind, agent: info.agent, session })
    return session
  }
}
