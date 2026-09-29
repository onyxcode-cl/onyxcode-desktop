/**
 * Motor del Modo auto: decide y ejecuta lo que `auto-mode.ts` (puro) permite, y lleva el registro.
 *
 * Dependencias inyectadas (para poder probarlo sin Electron ni un servidor de OpenCode real; ver el
 * arnés del paquete C3). Opt-in DOBLE y explícito: el interruptor maestro (`enabled`, apagado por
 * defecto = kill switch) Y ADEMÁS la carpeta o la tarea concreta. `policy.disableAutoMode` (gestionada
 * por la organización) desactiva todo sin tocar los ajustes del usuario.
 *
 * Persistencia: `userData/cowork-auto.json`. Nunca escribe si `policyDisabled()` es true (solo lee
 * para poder mostrar el banner), y nunca aprueba tampoco.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AutoApprovalRecord, AutoModeSettings, AutoModeState, AutoRuleId } from '@shared/ipc-cowork'
import type { AutoAccessQuery, AutoAccessVerdict } from '../computer/service'
import { classifyAccess, classifyPermission, DEFAULT_AUTO_VIEW_APPS } from './auto-mode'
import type { RawPerm } from './monitor'

/** Servidor vivo de Cowork tal como lo entrega `CoworkManager.liveServers()` (mismos campos). */
export interface AutoServer {
  folder: string
  fullAccess: boolean
  baseUrl: string
  authorization: string
}

interface Persisted {
  version: 1
  enabled: boolean
  folders: string[]
  tasks: string[]
  viewApps: string[]
  log: AutoApprovalRecord[]
}

export interface AutoApproverDeps {
  /** Ruta de `userData/cowork-auto.json`. */
  file: string
  now?: () => number
  fetch?: typeof fetch
  /** Nombres de los MCP del usuario marcados "Disponible en Cowork" (nunca `computer`/`browser`). */
  mcpServers: () => string[]
  /** true si `managed.json` desactiva el Modo auto para toda la organización. */
  policyDisabled: () => boolean
  onApproved: (r: AutoApprovalRecord) => void
  servers: () => AutoServer[]
  grantAutoView: (sessionId: string, bundleIds: string[]) => void
  revokeAutoView: (sessionId: string, bundleId?: string) => void
  log?: (...args: unknown[]) => void
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
  return { version: 1, enabled: false, folders: [], tasks: [], viewApps: [...DEFAULT_AUTO_VIEW_APPS], log: [] }
}

export class AutoApprover {
  private data: Persisted | null = null
  /** Deduplica por id de petición ya respondida en esta sesión de la app (evita doble respuesta entre el sondeo y la vía rápida). */
  private readonly seen = new Set<string>()
  private readonly rootCache = new Map<string, { root: string; at: number }>()

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
          tasks: Array.isArray(raw.tasks) ? raw.tasks.filter((x): x is string => typeof x === 'string') : [],
          viewApps:
            Array.isArray(raw.viewApps) && raw.viewApps.length > 0 && raw.viewApps.every((x) => typeof x === 'string')
              ? [...new Set(raw.viewApps as string[])]
              : [...DEFAULT_AUTO_VIEW_APPS],
          log: Array.isArray(raw.log) ? raw.log.filter(isValidRecord) : []
        }
      }
    } catch (err) {
      this.deps.log?.('[cowork] cowork-auto.json inválido; se reinicia:', err)
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
          this.deps.log?.('[cowork] modo auto: revokeAutoView:', err)
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
      this.deps.log?.('[cowork] modo auto: onApproved:', err)
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
      const url = `${server.baseUrl.replace(/\/+$/, '')}${path}${sep}directory=${encodeURIComponent(server.folder)}`
      const res = await f(url, { headers: { Authorization: server.authorization }, signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) return null
      const text = await res.text()
      return (text ? JSON.parse(text) : null) as T
    } catch (err) {
      this.deps.log?.('[cowork] modo auto: GET', path, err instanceof Error ? err.message : err)
      return null
    }
  }

  /** `POST <baseUrl>/permission/<id>/reply` con `{reply:'once'}` (igual que el scheduler del Lote B). */
  private async replyOnce(server: AutoServer, requestId: string): Promise<boolean> {
    const f = this.deps.fetch ?? fetch
    try {
      const url = `${server.baseUrl.replace(/\/+$/, '')}/permission/${encodeURIComponent(requestId)}/reply?directory=${encodeURIComponent(server.folder)}`
      const res = await f(url, {
        method: 'POST',
        headers: { Authorization: server.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: 'once' }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      })
      return res.ok
    } catch (err) {
      this.deps.log?.('[cowork] modo auto: fallo al responder el permiso:', err instanceof Error ? err.message : err)
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

  private async tryApprovePermission(server: AutoServer, p: RawPerm): Promise<boolean> {
    if (this.deps.policyDisabled()) return false
    if (!this.load().enabled) return false
    const key = `${server.baseUrl}\u0000${server.folder}\u0000${server.fullAccess}\u0000${p.id}`
    if (this.seen.has(key)) return false
    const rootId = await this.resolveRoot(server, p.sessionID)
    if (!this.optedIn(server.folder, rootId)) return false
    const verdict = classifyPermission({ permission: p.permission, patterns: p.patterns ?? [], metadata: p.metadata }, { mcpServers: this.deps.mcpServers() })
    if (verdict.decision !== 'allow') return false
    this.markSeen(key)
    const ok = await this.replyOnce(server, p.id)
    if (!ok) {
      this.seen.delete(key)
      return false
    }
    this.record({
      folder: server.folder,
      sessionId: rootId,
      kind: 'permission',
      permission: p.permission,
      patterns: p.patterns ?? [],
      rule: verdict.rule,
      summary: verdict.summary,
      revocable: false
    })
    return true
  }

  /** Lo llama el monitor en cada sondeo (`MonitorDeps.onPermissions`) con la lista cruda de `GET /permission`. */
  async considerPermissions(server: AutoServer, perms: RawPerm[]): Promise<void> {
    if (this.deps.policyDisabled() || !this.load().enabled) return
    for (const p of perms) {
      try {
        await this.tryApprovePermission(server, p)
      } catch (err) {
        this.deps.log?.('[cowork] modo auto (sondeo):', err)
      }
    }
  }

  /**
   * Vía rápida desde el renderer (`cowork:auto:consider`): busca esa petición concreta en el
   * servidor de `folder`/`fullAccess` y la considera igual que el sondeo. Devuelve si se aprobó.
   */
  async considerOne(folder: string, fullAccess: boolean, requestId: string): Promise<boolean> {
    if (this.deps.policyDisabled() || !this.load().enabled) return false
    const server = this.deps.servers().find((s) => s.folder === folder && s.fullAccess === fullAccess)
    if (!server) return false
    const list = await this.fetchJson<Array<{ id?: string; sessionID?: string; permission?: string; patterns?: unknown; metadata?: unknown }>>(
      server,
      '/permission',
      HTTP_TIMEOUT_MS
    )
    const found = Array.isArray(list) ? list.find((p) => p?.id === requestId) : null
    if (!found || typeof found.sessionID !== 'string' || typeof found.permission !== 'string') return false
    const perm: RawPerm = {
      id: requestId,
      sessionID: found.sessionID,
      permission: found.permission,
      patterns: Array.isArray(found.patterns) ? found.patterns.filter((x): x is string => typeof x === 'string') : undefined,
      metadata: found.metadata && typeof found.metadata === 'object' && !Array.isArray(found.metadata) ? (found.metadata as Record<string, unknown>) : undefined
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
    const verdict = classifyAccess({ apps: q.apps, plan: q.plan, kind: q.kind, reason: q.reason }, { viewApps: this.load().viewApps })
    if (verdict.decision !== 'allow') return null
    if (rootId) {
      try {
        this.deps.grantAutoView(rootId, q.apps.map((a) => a.bundleId))
      } catch (err) {
        this.deps.log?.('[cowork] modo auto: grantAutoView:', err)
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

/** Instancia única, creada por `registerCoworkAutoHandlers` (`cowork-auto-handlers.ts`). */
export let autoApprover: AutoApprover | null = null

/** La crea `registerCoworkAutoHandlers`; el resto de main la consulta con `getAutoApprover()`. */
export function createAutoApprover(deps: AutoApproverDeps): AutoApprover {
  autoApprover = new AutoApprover(deps)
  return autoApprover
}

export function getAutoApprover(): AutoApprover | null {
  return autoApprover
}
