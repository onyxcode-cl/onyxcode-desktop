/**
 * Motor del Modo auto: decide y ejecuta lo que `auto-mode.ts` (puro) permite, y lleva el registro.
 *
 * Dependencias inyectadas (para poder probarlo sin Electron ni un servidor de OpenCode real; ver el
 * arnés del paquete C3). Opt-in DOBLE y explícito: el interruptor maestro (`enabled`, apagado por
 * defecto = kill switch) Y ADEMÁS la carpeta o la tarea concreta. `policy.disableAutoMode` (gestionada
 * por la organización) desactiva todo sin tocar los ajustes del usuario.
 *
 * Persistencia: `userData/tasks-auto.json`. Nunca escribe si `policyDisabled()` es true (solo lee
 * para poder mostrar el banner), y nunca aprueba tampoco.
 *
 * V29: un comando dudoso (`review`) se manda a la revisión por IA del motor (`POST /permission/{id}/review`):
 * `allow` → «una vez»; `block` → rechazo con el motivo para que la IA cambie de camino (tras 3 seguidos o 20 en la
 * tarea, tarjeta con el motivo a la vista); `unavailable` → tarjeta.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AutoApprovalRecord, AutoModeSettings, AutoModeState, AutoRuleId } from '@shared/ipc-tasks'
import type { AutoAccessQuery, AutoAccessVerdict } from '../computer/service'
import { classifyAccess, classifyPermission, defaultAutoViewApps } from './auto-mode'
import { ReviewTracker, blockMessage, requestReview, type ReviewDecision } from '@shared/auto-review'
import type { RawPerm } from './monitor'

/** Servidor vivo de Tareas tal como lo entrega `TasksManager.liveServers()` (mismos campos). */
export interface AutoServer {
  folder: string
  /** Carpeta tal como la ve OpenCode (`?directory=`); ausente = `folder` (macOS). */
  directory?: string
  fullAccess: boolean
  baseUrl: string
  authorization: string
}

interface Persisted {
  version: 1
  enabled: boolean
  folders: string[]
  tasks: string[]
  taskModes: Record<string, boolean>
  viewApps: string[]
  log: AutoApprovalRecord[]
}

export interface AutoApproverDeps {
  /** Ruta de `userData/tasks-auto.json`. */
  file: string
  now?: () => number
  fetch?: typeof fetch
  /** Nombres de los MCP del usuario marcados "Disponible en Tareas" (nunca `computer`/`browser`). */
  mcpServers: () => string[]
  /** true si `managed.json` desactiva el Modo auto para toda la organización. */
  policyDisabled: () => boolean
  onApproved: (r: AutoApprovalRecord) => void
  servers: () => AutoServer[]
  grantAutoView: (sessionId: string, bundleIds: string[]) => void
  revokeAutoView: (sessionId: string, bundleId?: string) => void
  log?: (...args: unknown[]) => void
  /** Revisión por IA (inyectable en las pruebas); por defecto, la ruta del motor. */
  review?: (server: AutoServer, requestId: string) => Promise<ReviewDecision>
}

/** Resultado de considerar una petición: `auto` si ya no hace falta tarjeta; `note`, motivo del revisor para la tarjeta. */
export interface AutoConsideration {
  auto: boolean
  note?: string
}

const MAX_LOG = 500
const MAX_PARENT_DEPTH = 6
const MAX_DEDUPE = 4000
const HTTP_TIMEOUT_MS = 4000
const ACCESS_HTTP_TIMEOUT_MS = 1200
const ROOT_CACHE_TTL_MS = 5 * 60_000

const RULE_IDS: ReadonlySet<AutoRuleId> = new Set(['mcp-readonly', 'bash-readonly', 'computer-view'])

function isValidRecord(r: unknown): r is AutoApprovalRecord {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.at === 'number' &&
    (o.folder === null || typeof o.folder === 'string') &&
    (o.sessionId === null || typeof o.sessionId === 'string') &&
    (o.kind === 'permission' || o.kind === 'access') &&
    typeof o.permission === 'string' &&
    Array.isArray(o.patterns) &&
    o.patterns.every((p) => typeof p === 'string') &&
    typeof o.rule === 'string' &&
    RULE_IDS.has(o.rule as AutoRuleId) &&
    typeof o.summary === 'string' &&
    typeof o.revocable === 'boolean' &&
    (o.revokedAt === undefined || typeof o.revokedAt === 'number')
  )
}

function defaultPersisted(): Persisted {
  return { version: 1, enabled: false, folders: [], tasks: [], taskModes: {}, viewApps: [...defaultAutoViewApps()], log: [] }
}

export class AutoApprover {
  private data: Persisted | null = null
  /** Deduplica por id de petición ya respondida en esta sesión de la app (evita doble respuesta entre el sondeo y la vía rápida). */
  private readonly seen = new Set<string>()
  private readonly rootCache = new Map<string, { root: string; at: number }>()
  /** V29: bloqueos del revisor por tarea raíz, decisiones ya tomadas (no se revisa dos veces) y revisiones en curso. */
  private readonly tracker = new ReviewTracker()
  private readonly decided = new Map<string, AutoConsideration>()
  private readonly inflight = new Map<string, Promise<AutoConsideration>>()

  constructor(private readonly deps: AutoApproverDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  // ───────────────────────────── persistencia ─────────────────────────────

  private load(): Persisted {
    if (this.data) return this.data
    let data = defaultPersisted()
    try {
      if (existsSync(this.deps.file)) {
        const raw = JSON.parse(readFileSync(this.deps.file, 'utf8')) as Partial<Persisted>
        data = {
          version: 1,
          enabled: raw.enabled === true,
          folders: Array.isArray(raw.folders) ? raw.folders.filter((x): x is string => typeof x === 'string') : [],
          taskModes:
            raw.taskModes && typeof raw.taskModes === 'object' && !Array.isArray(raw.taskModes)
              ? Object.fromEntries(Object.entries(raw.taskModes).filter(([, v]) => typeof v === 'boolean'))
              : {},
          tasks: Array.isArray(raw.tasks) ? raw.tasks.filter((x): x is string => typeof x === 'string') : [],
          viewApps:
            Array.isArray(raw.viewApps) && raw.viewApps.length > 0 && raw.viewApps.every((x) => typeof x === 'string')
              ? [...new Set(raw.viewApps as string[])]
              : [...defaultAutoViewApps()],
          log: Array.isArray(raw.log) ? raw.log.filter(isValidRecord) : []
        }
      }
    } catch (err) {
      this.deps.log?.('[tasks] tasks-auto.json inválido; se reinicia:', err)
      data = defaultPersisted()
    }
    this.data = data
    return data
  }

  private persist(): void {
    const data = this.load()
    data.log = data.log.slice(-MAX_LOG)
    const file = this.deps.file
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  // ───────────────────────────── estado para Ajustes ─────────────────────────────

  state(): AutoModeState {
    const data = this.load()
    const settings: AutoModeSettings = {
      enabled: data.enabled,
      folders: [...data.folders],
      tasks: [...data.tasks],
      taskModes: { ...data.taskModes },
      viewApps: [...data.viewApps]
    }
    return { settings, log: [...data.log], policyDisabled: this.deps.policyDisabled() }
  }

  set(req: {
    enabled?: boolean
    folder?: { path: string; on: boolean }
    task?: { sessionId: string; on: boolean }
    viewApps?: string[]
  }): AutoModeState {
    const data = this.load()
    if (typeof req.enabled === 'boolean') data.enabled = req.enabled
    if (req.folder && typeof req.folder.path === 'string') {
      const { path, on } = req.folder
      data.folders = on ? [...new Set([...data.folders, path])] : data.folders.filter((f) => f !== path)
    }
    if (req.task && typeof req.task.sessionId === 'string') {
      const { sessionId, on } = req.task
      data.taskModes[sessionId] = on
      data.tasks = on ? [...new Set([...data.tasks, sessionId])] : data.tasks.filter((t) => t !== sessionId)
    }
    if (Array.isArray(req.viewApps)) {
      data.viewApps = [...new Set(req.viewApps.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))]
    }
    this.persist()
    return this.state()
  }

  revoke(id: string): AutoModeState {
    const data = this.load()
    const entry = data.log.find((r) => r.id === id)
    if (entry && entry.revocable && !entry.revokedAt) {
      entry.revokedAt = this.now()
      if (entry.kind === 'access' && entry.sessionId) {
        try {
          this.deps.revokeAutoView(entry.sessionId)
        } catch (err) {
          this.deps.log?.('[tasks] modo auto: revokeAutoView:', err)
        }
      }
      this.persist()
    }
    return this.state()
  }

  clearLog(): AutoModeState {
    const data = this.load()
    data.log = []
    this.persist()
    return this.state()
  }

  // ───────────────────────────── opt-in ─────────────────────────────

  private optedIn(folder: string, rootSessionId: string | null): boolean {
    const data = this.load()
    if (!data.enabled) return false
    if (rootSessionId && Object.hasOwn(data.taskModes, rootSessionId)) return data.taskModes[rootSessionId]!
    if (data.folders.includes(folder)) return true
    if (rootSessionId && data.tasks.includes(rootSessionId)) return true
    return false
  }

  private record(entry: Omit<AutoApprovalRecord, 'id' | 'at'>): AutoApprovalRecord {
    const rec: AutoApprovalRecord = { id: randomUUID(), at: this.now(), ...entry }
    const data = this.load()
    data.log.push(rec)
    data.log = data.log.slice(-MAX_LOG)
    this.persist()
    try {
      this.deps.onApproved(rec)
    } catch (err) {
      this.deps.log?.('[tasks] modo auto: onApproved:', err)
    }
    return rec
  }

  private markSeen(key: string): void {
    if (this.seen.size >= MAX_DEDUPE) this.seen.clear()
    this.seen.add(key)
  }

  // ───────────────────────────── HTTP contra el servidor de OpenCode ─────────────────────────────

  private async fetchJson<T>(server: AutoServer, path: string, timeoutMs: number): Promise<T | null> {
    const f = this.deps.fetch ?? fetch
    try {
      const sep = path.includes('?') ? '&' : '?'
      const url = `${server.baseUrl.replace(/\/+$/, '')}${path}${sep}directory=${encodeURIComponent(server.directory ?? server.folder)}`
      const res = await f(url, { headers: { Authorization: server.authorization }, signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) return null
      const text = await res.text()
      return (text ? JSON.parse(text) : null) as T
    } catch (err) {
      this.deps.log?.('[tasks] modo auto: GET', path, err instanceof Error ? err.message : err)
      return null
    }
  }

  /** `POST <baseUrl>/permission/<id>/reply` con `{reply:'once'}` (igual que el scheduler del Lote B) o un rechazo con motivo. */
  private async replyOnce(
    server: AutoServer,
    requestId: string,
    body: { reply: 'once' } | { reply: 'reject'; message: string } = { reply: 'once' }
  ): Promise<boolean> {
    const f = this.deps.fetch ?? fetch
    try {
      const url = `${server.baseUrl.replace(/\/+$/, '')}/permission/${encodeURIComponent(requestId)}/reply?directory=${encodeURIComponent(server.directory ?? server.folder)}`
      const res = await f(url, {
        method: 'POST',
        headers: { Authorization: server.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      })
      return res.ok
    } catch (err) {
      this.deps.log?.('[tasks] modo auto: fallo al responder el permiso:', err instanceof Error ? err.message : err)
      return false
    }
  }

  private async fetchSessionParent(server: AutoServer, id: string, timeoutMs: number): Promise<{ parentID?: string } | null> {
    const data = await this.fetchJson<{ parentID?: string }>(server, `/session/${encodeURIComponent(id)}`, timeoutMs)
    if (!data || typeof data !== 'object') return null
    return { parentID: typeof data.parentID === 'string' && data.parentID ? data.parentID : undefined }
  }

  /** Sube por `parentID` hasta la raíz (máx. 6 niveles), con caché. `null` si no se pudo resolver. */
  private async resolveRoot(server: AutoServer, sessionId: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<string | null> {
    const cacheKey = `${server.baseUrl}\u0000${server.folder}\u0000${sessionId}`
    const cached = this.rootCache.get(cacheKey)
    if (cached && this.now() - cached.at < ROOT_CACHE_TTL_MS) return cached.root
    let cur = sessionId
    for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
      const info = await this.fetchSessionParent(server, cur, timeoutMs)
      if (!info) return null
      if (!info.parentID) {
        this.rootCache.set(cacheKey, { root: cur, at: this.now() })
        return cur
      }
      cur = info.parentID
    }
    return null
  }

  // ───────────────────────────── permisos ─────────────────────────────

  /** La persona aprobó una petición de esta tarea: se corta la racha de bloqueos seguidos del revisor. */
  personApproved(sessionId: string): void {
    this.tracker.personApproved(sessionId)
  }

  private remember(key: string, result: AutoConsideration): AutoConsideration {
    if (this.decided.size >= MAX_DEDUPE) this.decided.delete(this.decided.keys().next().value!)
    this.decided.set(key, result)
    return result
  }

  private review(server: AutoServer, requestId: string): Promise<ReviewDecision> {
    if (this.deps.review) return this.deps.review(server, requestId)
    return requestReview(
      { baseUrl: server.baseUrl, authorization: server.authorization },
      { id: requestId, sessionID: '', api: 'v1', directory: server.directory ?? server.folder },
      this.deps.fetch ?? fetch
    )
  }

  private async tryApprovePermission(server: AutoServer, p: RawPerm): Promise<AutoConsideration> {
    if (this.deps.policyDisabled()) return { auto: false }
    if (!this.load().enabled) return { auto: false }
    const key = `${server.baseUrl}\u0000${server.folder}\u0000${server.fullAccess}\u0000${p.id}`
    if (this.seen.has(key)) return { auto: false }
    const done = this.decided.get(key)
    if (done) return done
    // El sondeo y la vía rápida pueden llegar a la vez: una sola revisión por petición.
    const running = this.inflight.get(key)
    if (running) return running
    const work = this.considerPermission(server, p, key)
    this.inflight.set(key, work)
    try {
      return await work
    } finally {
      this.inflight.delete(key)
    }
  }

  private async considerPermission(server: AutoServer, p: RawPerm, key: string): Promise<AutoConsideration> {
    const rootId = await this.resolveRoot(server, p.sessionID)
    if (!this.optedIn(server.folder, rootId)) return { auto: false }
    // Una petición de una HIJA (subagente) nunca se aprueba sola: el opt-in es de la tarea raíz y lo que
    // pide un subagente lo decide la persona. Si la raíz no se pudo resolver, tampoco (podría ser una hija).
    if (rootId !== p.sessionID) return { auto: false }
    let metadata = p.metadata
    // MCP pregunta con metadata:{} y patrón '*': la entrada vive en la parte enlazada por tool.
    if (p.permission === 'bgshell_start' || (p.permission === 'bash' && p.tool)) {
      if (!p.tool || typeof p.tool.messageID !== 'string' || typeof p.tool.callID !== 'string') return { auto: false }
      const message = await this.fetchJson<{
        parts?: Array<{ type?: string; tool?: string; callID?: string; state?: { input?: Record<string, unknown> } }>
      }>(server, `/session/${encodeURIComponent(p.sessionID)}/message/${encodeURIComponent(p.tool.messageID)}`, HTTP_TIMEOUT_MS)
      const part = Array.isArray(message?.parts)
        ? message.parts.find(
            (part) =>
              part?.type === 'tool' &&
              (part.tool === p.permission || (p.permission === 'bash' && part.tool === 'todowrite')) &&
              part.callID === p.tool!.callID
          )
        : undefined
      const input = part?.state?.input
      const verification = part?.tool === 'todowrite' && Array.isArray(input?.todos)
      const command = verification ? metadata?.command : input?.command
      if (typeof command !== 'string' || (p.permission === 'bgshell_start' && typeof input?.cwd !== 'string')) return { auto: false }
      if (p.permission === 'bash' && command !== metadata?.command) return { auto: false }
      metadata = {
        ...metadata,
        command,
        workdir: p.permission === 'bgshell_start' ? input?.cwd : verification ? metadata?.workdir : input?.workdir
      }
    }
    const verdict = classifyPermission(
      { permission: p.permission, patterns: p.patterns ?? [], metadata },
      { mcpServers: this.deps.mcpServers(), projectRoot: server.directory ?? server.folder }
    )
    if (verdict.decision === 'ask') return this.remember(key, { auto: false })
    let rule: AutoRuleId
    let summary: string
    let reviewed = false
    if (verdict.decision === 'review') {
      let result: ReviewDecision
      try {
        result = await this.review(server, p.id)
      } catch {
        result = { decision: 'unavailable', reason: '' }
      }
      // I4: la revisión tarda hasta 20 s; si en ese rato se apagó el Modo auto o la carpeta, la decide la persona.
      if (this.deps.policyDisabled() || !this.load().enabled || !this.optedIn(server.folder, rootId))
        return this.remember(key, { auto: false })
      if (result.decision === 'unavailable') return this.remember(key, { auto: false })
      if (result.decision === 'block') {
        if (this.tracker.onBlock(rootId) === 'card') return this.remember(key, { auto: false, note: result.reason || undefined })
        this.markSeen(key)
        if (await this.replyOnce(server, p.id, { reply: 'reject', message: blockMessage(result.reason) })) return { auto: true }
        this.seen.delete(key)
        return this.remember(key, { auto: false, note: result.reason || undefined })
      }
      this.tracker.reviewerAllowed(rootId)
      reviewed = true
      rule = 'bash-readonly'
      const command = typeof metadata?.command === 'string' ? metadata.command : ''
      summary = `comando revisado por la IA: ${command.length > 140 ? `${command.slice(0, 140)}…` : command}`
    } else {
      rule = verdict.rule
      summary = verdict.summary
    }
    this.markSeen(key)
    const ok = await this.replyOnce(server, p.id)
    if (!ok) {
      this.seen.delete(key)
      // M2: tras un `allow` del revisor, no repetir la llamada al modelo en cada sondeo si falló la respuesta.
      return reviewed ? this.remember(key, { auto: false }) : { auto: false }
    }
    this.record({
      folder: server.folder,
      sessionId: rootId,
      kind: 'permission',
      permission: p.permission,
      patterns: p.patterns ?? [],
      rule,
      summary,
      revocable: false
    })
    return { auto: true }
  }

  /** Lo llama el monitor en cada sondeo (`MonitorDeps.onPermissions`) con la lista cruda de `GET /permission`. */
  async considerPermissions(server: AutoServer, perms: RawPerm[]): Promise<void> {
    if (this.deps.policyDisabled() || !this.load().enabled) return
    // En paralelo: una revisión por IA (hasta 20 s) no debe frenar a las demás peticiones.
    await Promise.all(
      perms.map((p) =>
        this.tryApprovePermission(server, p).catch((err) => {
          this.deps.log?.('[tasks] modo auto (sondeo):', err)
        })
      )
    )
  }

  /**
   * Vía rápida desde el renderer (`tasks:auto:consider`): busca esa petición concreta en el
   * servidor de `folder`/`fullAccess` y la considera igual que el sondeo. Devuelve si se aprobó.
   */
  async considerOne(folder: string, fullAccess: boolean, requestId: string): Promise<AutoConsideration> {
    if (this.deps.policyDisabled() || !this.load().enabled) return { auto: false }
    const server = this.deps.servers().find((s) => s.folder === folder && s.fullAccess === fullAccess)
    if (!server) return { auto: false }
    const list = await this.fetchJson<
      Array<{ id?: string; sessionID?: string; permission?: string; patterns?: unknown; metadata?: unknown; tool?: RawPerm['tool'] }>
    >(server, '/permission', HTTP_TIMEOUT_MS)
    const found = Array.isArray(list) ? list.find((p) => p?.id === requestId) : null
    if (!found || typeof found.sessionID !== 'string' || typeof found.permission !== 'string') return { auto: false }
    const perm: RawPerm = {
      id: requestId,
      sessionID: found.sessionID,
      permission: found.permission,
      tool: found.tool,
      patterns: Array.isArray(found.patterns) ? found.patterns.filter((x): x is string => typeof x === 'string') : undefined,
      metadata:
        found.metadata && typeof found.metadata === 'object' && !Array.isArray(found.metadata)
          ? (found.metadata as Record<string, unknown>)
          : undefined
    }
    return this.tryApprovePermission(server, perm)
  }

  // ───────────────────────────── acceso a apps ("Solo ver") ─────────────────────────────

  /**
   * Antes de mostrar una tarjeta `request_access`/`request_full_control` a mitad de tarea
   * (`ComputerService.autoAccess`, con ≤1,5 s de espera desde quien llama). Concede un "Solo ver"
   * EFÍMERO para esa sesión (nunca persiste en `computer-grants.json`).
   */
  async considerAccess(q: AutoAccessQuery): Promise<AutoAccessVerdict | null> {
    if (this.deps.policyDisabled() || !this.load().enabled) return null
    if (!q.sessionId) return null
    const fullServers = this.deps.servers().filter((s) => s.fullAccess)
    let folder: string | null = null
    let rootId: string | null = null
    for (const s of fullServers) {
      const root = await this.resolveRoot(s, q.sessionId, ACCESS_HTTP_TIMEOUT_MS)
      if (root) {
        folder = s.folder
        rootId = root
        break
      }
    }
    if (!folder) return null
    if (!this.optedIn(folder, rootId)) return null
    // Igual que en los permisos: el acceso a apps que pide una hija no se concede solo.
    if (rootId !== q.sessionId) return null
    const verdict = classifyAccess({ apps: q.apps, plan: q.plan, kind: q.kind, reason: q.reason }, { viewApps: this.load().viewApps })
    if (verdict.decision !== 'allow') return null
    if (rootId) {
      try {
        this.deps.grantAutoView(
          rootId,
          q.apps.map((a) => a.bundleId)
        )
      } catch (err) {
        this.deps.log?.('[tasks] modo auto: grantAutoView:', err)
      }
    }
    const rec = this.record({
      folder,
      sessionId: rootId,
      kind: 'access',
      permission: q.kind === 'takeover' ? 'computer_takeover' : 'computer_access',
      patterns: q.apps.map((a) => a.bundleId),
      rule: verdict.rule,
      summary: verdict.summary,
      revocable: true
    })
    return { approve: true, recordId: rec.id }
  }
}

/** Instancia única, creada por `registerTasksAutoHandlers` (`tasks-auto-handlers.ts`). */
export let autoApprover: AutoApprover | null = null

/** La crea `registerTasksAutoHandlers`; el resto de main la consulta con `getAutoApprover()`. */
export function createAutoApprover(deps: AutoApproverDeps): AutoApprover {
  autoApprover = new AutoApprover(deps)
  return autoApprover
}

export function getAutoApprover(): AutoApprover | null {
  return autoApprover
}
