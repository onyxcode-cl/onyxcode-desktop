/**
 * Monitor de Tareas en main: fuente del estado "de fondo" de TODAS las carpetas.
 *
 * El renderer solo mantiene un stream SSE de la carpeta que mira, así que no sabe qué pasa en las
 * demás. El monitor sondea cada ~3 s cada servidor vivo (`session.status`, `permission.list`,
 * `question.list` + caché de `session.get` para `parentID` y título) y con eso:
 *  - emite `activity` (tareas raíz en curso o pendientes + servidores) cuando algo cambia;
 *  - notifica por tipo (terminó / pide permiso / pregunta / error) en servidores que el renderer
 *    NO está mirando;
 *  - avisa si hay trabajo en curso (mantener el Mac despierto);
 *  - detiene servidores ociosos (dos sondeos seguidos sin nada en curso, sin estar mirados y tras
 *    `idleStopMinutes`) y hace hueco cuando se alcanza `maxServers` (nunca mata trabajo en curso);
 *  - auto-archiva tareas viejas (cada hora por servidor; nunca fijadas ni en curso/en espera).
 *
 * INDEPENDIENTE de Electron: todo lo externo entra por `MonitorDeps` (probado contra un servidor
 * HTTP falso). El servidor de OpenCode se consulta con `fetch` y `?directory=<carpeta>`.
 */
import type { TasksActivitySnapshot, TasksPrefs, TasksTaskActivity, TasksTaskActivityState, TasksTaskMeta } from '@shared/ipc-tasks'
// Solo el TIPO (se borra al compilar): el monitor sigue sin depender de Electron en tiempo de
// ejecución aunque `auto-approver.ts` sí lo haga.
import type { AutoServer } from './auto-approver'

/** Petición de `GET /permission` tal como la entrega OpenCode, ya validada mínimamente. */
export interface RawPerm {
  id: string
  sessionID: string
  permission: string
  patterns?: string[]
  metadata?: Record<string, unknown>
}

/** Servidor vivo tal como lo entrega `TasksManager.liveServers()`. */
export interface MonitorServer {
  folder: string
  fullAccess: boolean
  baseUrl: string
  authorization: string
  startedAt: number
  lastStartCallAt: number
}

export type MonitorNotifyKind = 'done' | 'approval' | 'question' | 'error'

export interface MonitorNotifyEvent {
  kind: MonitorNotifyKind
  /** Sesión raíz de la tarea. */
  sessionId: string
  folder: string
  fullAccess: boolean
  title: string
}

/** Estado de la ventana principal: sin ventana, visible pero sin foco, o con foco. */
export type MonitorWindowState = 'none' | 'visible' | 'focused'

export interface MonitorDeps {
  servers: () => MonitorServer[]
  stop: (folder: string, fullAccess: boolean) => Promise<void>
  prefs: { get(): TasksPrefs }
  tasks: { list(): TasksTaskMeta[] }
  /** Ya filtrada por `prefs.notify` y por "lo estás mirando". El ajuste global lo aplica quien la implementa. */
  notify: (ev: MonitorNotifyEvent) => void
  /** Se llama tras archivar una tarea (p.ej. revocar su plan aprobado). */
  onArchived?: (sessionId: string) => void
  /** Recibe la instantánea cuando cambia. */
  onActivity?: (snap: TasksActivitySnapshot) => void
  /**
   * Lote C, Modo auto: recibe la lista CRUDA de `GET /permission` de cada servidor en cada sondeo
   * (antes de resolver raíces ni de nada propio del monitor). Quien la implementa decide qué
   * aprobar; el monitor solo la reenvía.
   */
  onPermissions?: (server: AutoServer, perms: RawPerm[]) => void

  /** true si hay alguna sesión en curso o pendiente en algún servidor (cambia → mantener despierto). */
  onBusyChange?: (anyBusy: boolean) => void
  /** Estado de la ventana (por defecto 'focused'). */
  windowState?: () => MonitorWindowState
  /** Normaliza rutas para comparar carpetas (p.ej. realpath). Por defecto quita `/` finales. */
  normalizeFolder?: (folder: string) => string
  now?: () => number
  pollMs?: number
  fetch?: typeof fetch
  requestTimeoutMs?: number
  log?: (...args: unknown[]) => void
}

interface SessionInfo {
  parentID?: string
  title: string
  fetchedAt: number
}

interface RootEntry {
  title: string
  state: TasksTaskActivityState
  since: number
  /** Sondeos seguidos en que la raíz no aparece (se da por terminada a los 2). */
  missing: number
  routine: boolean
}

interface ServerState {
  key: string
  folder: string
  fullAccess: boolean
  baseUrl: string
  authorization: string
  startedAt: number
  lastStartCallAt: number
  /** Ya hubo al menos un sondeo. */
  polled: boolean
  /** El último sondeo respondió completo y bien. */
  ok: boolean
  busy: number
  pending: number
  idleSince: number | null
  idlePolls: number
  roots: Map<string, RootEntry>
  notifiedPerms: Set<string>
  notifiedQuestions: Set<string>
  info: Map<string, SessionInfo>
  lastArchiveAt: number
  archiving: boolean
  stopping: boolean
  inflight: Promise<void> | null
}

const DEFAULT_POLL_MS = 3000
const DEFAULT_TIMEOUT_MS = 4000
const ROUTINE_PREFIX = '⏰ '
const TITLE_REFRESH_MS = 30_000
const INFO_CACHE_MAX = 600
const ARCHIVE_EVERY_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const FINISH_AFTER_MISSES = 2
const IDLE_POLLS_TO_STOP = 2
const MAX_PARENT_DEPTH = 6

function serverKey(folder: string, fullAccess: boolean): string {
  return fullAccess ? `${folder}\u0000full` : folder
}

interface ReqOk<T> {
  ok: true
  data: T
}
interface ReqFail {
  ok: false
  status: number
}

export class TasksMonitor {
  private readonly states = new Map<string, ServerState>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private viewing: { folder: string; fullAccess?: boolean } | null = null
  private lastSignature = ''
  private lastBusy: boolean | null = null
  private polling: Promise<void> | null = null
  private readonly background = new Set<Promise<void>>()

  constructor(private readonly deps: MonitorDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private norm(folder: string): string {
    if (this.deps.normalizeFolder) {
      try {
        return this.deps.normalizeFolder(folder)
      } catch {
        // caer al valor por defecto
      }
    }
    return folder.length > 1 ? folder.replace(/\/+$/, '') : folder
  }

  // ───────────────────────────── ciclo de vida ─────────────────────────────

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      void this.poll()
        .catch((err) => this.deps.log?.('[monitor] sondeo:', err))
        .finally(() => this.schedule())
    }, this.deps.pollMs ?? DEFAULT_POLL_MS)
    this.timer.unref?.()
  }

  /** Espera a las tareas de fondo pendientes (archivado). Útil en pruebas y al apagar. */
  async settle(): Promise<void> {
    while (this.background.size > 0) await Promise.allSettled([...this.background])
  }

  // ───────────────────────────── consulta ─────────────────────────────

  /** La ventana avisa qué carpeta/modo está mirando (null = ninguna). */
  setViewing(folder: string | null, fullAccess?: boolean): void {
    this.viewing = folder ? { folder: this.norm(folder), fullAccess } : null
  }

  private isViewed(st: ServerState): boolean {
    const v = this.viewing
    if (!v) return false
    if ((this.deps.windowState?.() ?? 'focused') === 'none') return false
    if (v.fullAccess !== undefined && v.fullAccess !== st.fullAccess) return false
    return this.norm(st.folder) === v.folder
  }

  /** ¿Suprimir la notificación? Solo si lo miras Y la ventana tiene el foco. */
  private isWatchedNow(st: ServerState): boolean {
    return this.isViewed(st) && (this.deps.windowState?.() ?? 'focused') === 'focused'
  }

  /** Hay alguna sesión en curso, esperando permiso o pregunta en algún servidor vivo. */
  anyBusy(): boolean {
    for (const st of this.states.values()) if (st.busy > 0 || st.pending > 0) return true
    return false
  }

  /** Hay trabajo (o algo pendiente) en algún servidor de Control total. */
  anyBusyFullAccess(): boolean {
    for (const st of this.states.values()) if (st.fullAccess && (st.busy > 0 || st.pending > 0)) return true
    return false
  }

  /** El servidor no tiene nada en curso según el último sondeo (false si aún no se sondeó o falló). */
  isIdle(folder: string, fullAccess: boolean): boolean {
    const st = this.states.get(serverKey(this.norm(folder), fullAccess)) ?? this.states.get(serverKey(folder, fullAccess))
    return !!st && st.polled && st.ok && st.busy === 0 && st.pending === 0
  }

  snapshot(): TasksActivitySnapshot {
    const tasks: TasksTaskActivity[] = []
    const servers: TasksActivitySnapshot['servers'] = []
    for (const st of this.states.values()) {
      servers.push({
        folder: st.folder,
        fullAccess: st.fullAccess,
        idleSince: st.busy === 0 && st.pending === 0 && st.polled ? st.idleSince : null
      })
      for (const [sessionId, r] of st.roots) {
        if (r.missing > 0 || r.routine) continue
        tasks.push({ sessionId, folder: st.folder, fullAccess: st.fullAccess, title: r.title, state: r.state, since: r.since })
      }
    }
    tasks.sort((a, b) => a.since - b.since)
    return { at: this.now(), tasks, servers }
  }

  // ───────────────────────────── HTTP ─────────────────────────────

  private async req<T>(st: ServerState, method: string, path: string, body?: unknown): Promise<ReqOk<T> | ReqFail> {
    const f = this.deps.fetch ?? fetch
    const sep = path.includes('?') ? '&' : '?'
    const url = `${st.baseUrl.replace(/\/+$/, '')}${path}${sep}directory=${encodeURIComponent(st.folder)}`
    try {
      const res = await f(url, {
        method,
        headers: {
          Authorization: st.authorization,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS)
      })
      if (!res.ok) return { ok: false, status: res.status }
      const text = await res.text()
      return { ok: true, data: (text ? JSON.parse(text) : null) as T }
    } catch (err) {
      this.deps.log?.(`[monitor] ${method} ${path}:`, err instanceof Error ? err.message : err)
      return { ok: false, status: 0 }
    }
  }

  // ───────────────────────────── caché de sesiones ─────────────────────────────

  private async getInfo(st: ServerState, id: string): Promise<SessionInfo | null> {
    const now = this.now()
    const cached = st.info.get(id)
    // Un hijo nunca cambia de padre; una raíz puede cambiar de título (se refresca de vez en cuando).
    if (cached && (cached.parentID || now - cached.fetchedAt < TITLE_REFRESH_MS)) return cached
    const r = await this.req<{ parentID?: string; title?: string }>(st, 'GET', `/session/${encodeURIComponent(id)}`)
    if (r.ok && r.data && typeof r.data === 'object') {
      const info: SessionInfo = {
        parentID: typeof r.data.parentID === 'string' && r.data.parentID ? r.data.parentID : undefined,
        title: typeof r.data.title === 'string' ? r.data.title : '',
        fetchedAt: now
      }
      if (st.info.size >= INFO_CACHE_MAX) st.info.clear()
      st.info.set(id, info)
      return info
    }
    if (!r.ok && r.status === 404) {
      // La sesión ya no existe: se trata como raíz sin título.
      const info: SessionInfo = { title: '', fetchedAt: now }
      st.info.set(id, info)
      return info
    }
    return cached ?? null
  }

  private async resolveRoot(st: ServerState, id: string): Promise<{ id: string; title: string; routine: boolean } | null> {
    let cur = id
    for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
      const info = await this.getInfo(st, cur)
      if (!info) return null
      if (!info.parentID) return { id: cur, title: info.title, routine: info.title.startsWith(ROUTINE_PREFIX) }
      cur = info.parentID
    }
    return null
  }

  // ───────────────────────────── sondeo ─────────────────────────────

  /** Un ciclo de sondeo de todos los servidores vivos. Público para pruebas. */
  poll(): Promise<void> {
    if (this.polling) return this.polling
    const p = this.pollAll().finally(() => {
      if (this.polling === p) this.polling = null
    })
    this.polling = p
    return p
  }

  private syncStates(): ServerState[] {
    const live = this.deps.servers()
    const seen = new Set<string>()
    const out: ServerState[] = []
    for (const s of live) {
      const key = serverKey(s.folder, s.fullAccess)
      seen.add(key)
      let st = this.states.get(key)
      // Servidor reiniciado (otra marca de arranque): estado nuevo, la caché ya no vale.
      if (st && st.startedAt !== s.startedAt) {
        this.states.delete(key)
        st = undefined
      }
      if (!st) {
        st = {
          key,
          folder: s.folder,
          fullAccess: s.fullAccess,
          baseUrl: s.baseUrl,
          authorization: s.authorization,
          startedAt: s.startedAt,
          lastStartCallAt: s.lastStartCallAt,
          polled: false,
          ok: false,
          busy: 0,
          pending: 0,
          idleSince: null,
          idlePolls: 0,
          roots: new Map(),
          notifiedPerms: new Set(),
          notifiedQuestions: new Set(),
          info: new Map(),
          lastArchiveAt: 0,
          archiving: false,
          stopping: false,
          inflight: null
        }
        this.states.set(key, st)
      }
      st.baseUrl = s.baseUrl
      st.authorization = s.authorization
      st.lastStartCallAt = s.lastStartCallAt
      out.push(st)
    }
    for (const key of [...this.states.keys()]) if (!seen.has(key)) this.states.delete(key)
    return out
  }

  private async pollAll(): Promise<void> {
    const sts = this.syncStates()
    await Promise.all(sts.map((st) => this.refresh(st).catch((err) => this.deps.log?.('[monitor] servidor:', err))))
    const now = this.now()
    const prefs = this.deps.prefs.get()
    for (const st of sts) {
      this.maybeStopIdle(st, prefs, now)
      this.maybeArchive(st, prefs, now)
    }
    this.publish()
  }

  /** Sondea un servidor evitando solapes (el gancho de límite también lo usa). */
  private refresh(st: ServerState): Promise<void> {
    if (st.inflight) return st.inflight
    const p = this.pollServer(st).finally(() => {
      if (st.inflight === p) st.inflight = null
    })
    st.inflight = p
    return p
  }

  private async pollServer(st: ServerState): Promise<void> {
    const [status, perms, questions] = await Promise.all([
      this.req<Record<string, { type?: string }>>(st, 'GET', '/session/status'),
      this.req<Array<{ id?: string; sessionID?: string; permission?: string; patterns?: unknown; metadata?: unknown }>>(
        st,
        'GET',
        '/permission'
      ),
      this.req<Array<{ id?: string; sessionID?: string }>>(st, 'GET', '/question')
    ])
    if (!status.ok || !perms.ok || !questions.ok) {
      // Sin datos fiables: no se cuenta como ocioso ni se da nada por terminado.
      st.ok = false
      st.idlePolls = 0
      return
    }
    const now = this.now()
    const busyIds = Object.entries(status.data && typeof status.data === 'object' ? status.data : {})
      .filter(([, s]) => s && typeof s === 'object' && s.type !== 'idle')
      .map(([id]) => id)
    const permList: RawPerm[] = (Array.isArray(perms.data) ? perms.data : [])
      .filter(
        (p): p is { id: string; sessionID: string; permission: string; patterns?: unknown; metadata?: unknown } =>
          typeof p?.id === 'string' && typeof p?.sessionID === 'string' && typeof p?.permission === 'string'
      )
      .map((p) => ({
        id: p.id,
        sessionID: p.sessionID,
        permission: p.permission,
        patterns: Array.isArray(p.patterns) ? p.patterns.filter((x): x is string => typeof x === 'string') : undefined,
        metadata:
          p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata) ? (p.metadata as Record<string, unknown>) : undefined
      }))
    const questionList = (Array.isArray(questions.data) ? questions.data : []).filter(
      (q): q is { id: string; sessionID: string } => typeof q?.id === 'string' && typeof q?.sessionID === 'string'
    )

    // Lote C, Modo auto: se avisa con la lista cruda de este sondeo (aparte del resto del monitor).
    if (this.deps.onPermissions) {
      try {
        this.deps.onPermissions(
          { folder: st.folder, fullAccess: st.fullAccess, baseUrl: st.baseUrl, authorization: st.authorization },
          permList
        )
      } catch (err) {
        this.deps.log?.('[monitor] onPermissions:', err)
      }
    }

    st.ok = true
    st.polled = true
    st.busy = busyIds.length
    st.pending = permList.length + questionList.length
    if (st.busy === 0 && st.pending === 0) {
      st.idlePolls += 1
      if (st.idleSince === null) st.idleSince = now
    } else {
      st.idlePolls = 0
      st.idleSince = null
    }

    // Raíces con actividad: waiting > question > running (los hijos se agregan a su raíz).
    const current = new Map<string, { title: string; routine: boolean; state: TasksTaskActivityState }>()
    const rank: Record<TasksTaskActivityState, number> = { running: 0, question: 1, waiting: 2 }
    let complete = true
    const add = async (sessionID: string, state: TasksTaskActivityState): Promise<string | null> => {
      const root = await this.resolveRoot(st, sessionID)
      if (!root) {
        complete = false
        return null
      }
      const prev = current.get(root.id)
      if (!prev || rank[state] > rank[prev.state]) current.set(root.id, { title: root.title, routine: root.routine, state })
      else prev.title = root.title
      return root.id
    }
    for (const id of busyIds) await add(id, 'running')
    const permRoots = new Map<string, string>()
    for (const p of permList) {
      const root = await add(p.sessionID, 'waiting')
      if (root) permRoots.set(p.id, root)
    }
    const questionRoots = new Map<string, string>()
    for (const q of questionList) {
      const root = await add(q.sessionID, 'question')
      if (root) questionRoots.set(q.id, root)
    }
    // Sin poder resolver alguna sesión no se toca lo ya conocido: se reintenta en el siguiente sondeo.
    if (!complete) return

    // Permisos y preguntas nuevas: una notificación por tarea y tipo.
    const notify = (kind: MonitorNotifyKind, rootId: string, title: string): void =>
      this.emitNotify(st, { kind, sessionId: rootId, folder: st.folder, fullAccess: st.fullAccess, title })
    const newPermRoots = new Set<string>()
    for (const [id, root] of permRoots) if (!st.notifiedPerms.has(id)) newPermRoots.add(root)
    const newQuestionRoots = new Set<string>()
    for (const [id, root] of questionRoots) if (!st.notifiedQuestions.has(id)) newQuestionRoots.add(root)
    st.notifiedPerms = new Set(permRoots.keys())
    st.notifiedQuestions = new Set(questionRoots.keys())
    for (const rootId of newPermRoots) {
      const c = current.get(rootId)
      if (c && !c.routine) notify('approval', rootId, c.title)
    }
    for (const rootId of newQuestionRoots) {
      const c = current.get(rootId)
      if (c && !c.routine) notify('question', rootId, c.title)
    }

    // Altas y cambios de estado.
    for (const [rootId, c] of current) {
      const prev = st.roots.get(rootId)
      st.roots.set(rootId, {
        title: c.title,
        state: c.state,
        routine: c.routine,
        since: prev && prev.state === c.state ? prev.since : now,
        missing: 0
      })
    }
    // Bajas: a la segunda ausencia seguida se da por terminada (evita falsos "terminó" entre turnos).
    for (const [rootId, r] of [...st.roots]) {
      if (current.has(rootId)) continue
      r.missing += 1
      if (r.missing < FINISH_AFTER_MISSES) continue
      st.roots.delete(rootId)
      if (!r.routine) await this.finishRoot(st, rootId, r.title)
    }
  }

  /** Tarea terminada: distingue error y aborto (sin aviso) del fin normal. */
  private async finishRoot(st: ServerState, rootId: string, title: string): Promise<void> {
    const prefs = this.deps.prefs.get()
    if (this.isWatchedNow(st) || (!prefs.notify.done && !prefs.notify.error)) return
    let kind: MonitorNotifyKind = 'done'
    const r = await this.req<Array<{ info?: { role?: string; error?: { name?: string } } }>>(
      st,
      'GET',
      `/session/${encodeURIComponent(rootId)}/message?limit=4`
    )
    if (r.ok && Array.isArray(r.data)) {
      const lastAssistant = [...r.data].reverse().find((m) => m?.info?.role === 'assistant')
      const err = lastAssistant?.info?.error
      if (err) {
        // El usuario paró la tarea: no hace falta avisarle.
        if (err.name === 'MessageAbortedError') return
        kind = 'error'
      }
    }
    this.emitNotify(st, { kind, sessionId: rootId, folder: st.folder, fullAccess: st.fullAccess, title })
  }

  private emitNotify(st: ServerState, ev: MonitorNotifyEvent): void {
    if (!this.deps.prefs.get().notify[ev.kind]) return
    if (this.isWatchedNow(st)) return
    try {
      this.deps.notify(ev)
    } catch (err) {
      this.deps.log?.('[monitor] notify:', err)
    }
  }

  private publish(): void {
    const snap = this.snapshot()
    const sig = JSON.stringify([
      snap.tasks.map((t) => [t.sessionId, t.state, t.title, t.since, t.folder, t.fullAccess]),
      snap.servers.map((s) => [s.folder, s.fullAccess, s.idleSince])
    ])
    if (sig !== this.lastSignature) {
      this.lastSignature = sig
      try {
        this.deps.onActivity?.(snap)
      } catch (err) {
        this.deps.log?.('[monitor] onActivity:', err)
      }
    }
    const busy = this.anyBusy()
    if (busy !== this.lastBusy) {
      this.lastBusy = busy
      try {
        this.deps.onBusyChange?.(busy)
      } catch (err) {
        this.deps.log?.('[monitor] onBusyChange:', err)
      }
    }
  }

  // ───────────────────────────── parada por inactividad y límite ─────────────────────────────

  private maybeStopIdle(st: ServerState, prefs: TasksPrefs, now: number): void {
    const minutes = prefs.idleStopMinutes
    if (minutes <= 0 || st.stopping) return
    if (!st.ok || st.busy > 0 || st.pending > 0 || st.idlePolls < IDLE_POLLS_TO_STOP) return
    if (this.isViewed(st)) return
    const since = Math.max(st.idleSince ?? now, st.lastStartCallAt)
    if (now - since < minutes * 60_000) return
    this.stopServer(st, 'inactividad')
  }

  private stopServer(st: ServerState, why: string): Promise<void> {
    st.stopping = true
    this.deps.log?.(`[monitor] deteniendo ${st.folder}${st.fullAccess ? ' (control total)' : ''}: ${why}`)
    // La llamada a `stop` ocurre síncrona; el resultado se espera aparte.
    const p = (async () => {
      try {
        await this.deps.stop(st.folder, st.fullAccess)
        this.states.delete(st.key)
      } finally {
        st.stopping = false
      }
    })()
    const tracked = p.catch((err) => this.deps.log?.('[monitor] stop:', err))
    this.background.add(tracked)
    void tracked.finally(() => this.background.delete(tracked))
    return p
  }

  /**
   * Gancho de `manager.setBeforeSpawn`: si ya hay `maxServers` vivos, detiene el ocioso menos
   * usado (comprobándolo con un sondeo fresco). Nunca detiene uno con trabajo en curso, en espera
   * o que el renderer esté mirando: si no hay ninguno, deja arrancar y se excede el límite.
   */
  async ensureCapacity(folder: string, fullAccess: boolean): Promise<void> {
    const target = serverKey(folder, fullAccess)
    for (let guard = 0; guard < 24; guard++) {
      const max = this.deps.prefs.get().maxServers
      const live = this.deps.servers().filter((s) => serverKey(s.folder, s.fullAccess) !== target)
      if (live.length < max) return
      const sts = this.syncStates()
      const byKey = new Map(sts.map((s) => [s.key, s]))
      const ordered = live
        .map((s) => ({ s, st: byKey.get(serverKey(s.folder, s.fullAccess)) }))
        .filter((x): x is { s: MonitorServer; st: ServerState } => !!x.st && !x.st.stopping)
        .sort((a, b) => Math.max(a.s.lastStartCallAt, a.s.startedAt) - Math.max(b.s.lastStartCallAt, b.s.startedAt))
      let stopped = false
      for (const { st } of ordered) {
        if (this.isViewed(st)) continue
        await this.refresh(st).catch(() => undefined)
        if (!st.ok || st.busy > 0 || st.pending > 0) continue
        try {
          await this.stopServer(st, 'límite de servidores')
          stopped = true
        } catch (err) {
          this.deps.log?.('[monitor] no se pudo detener para hacer hueco:', err)
        }
        break
      }
      if (!stopped) return
    }
  }

  // ───────────────────────────── auto-archivo ─────────────────────────────

  private maybeArchive(st: ServerState, prefs: TasksPrefs, now: number): void {
    if (prefs.autoArchiveDays <= 0 || st.archiving || st.stopping || !st.ok) return
    if (st.lastArchiveAt && now - st.lastArchiveAt < ARCHIVE_EVERY_MS) return
    st.lastArchiveAt = now
    st.archiving = true
    const tracked = this.archiveOld(st, prefs.autoArchiveDays, now)
      .catch((err) => this.deps.log?.('[monitor] auto-archivo:', err))
      .finally(() => {
        st.archiving = false
      })
    this.background.add(tracked)
    void tracked.finally(() => this.background.delete(tracked))
  }

  private async archiveOld(st: ServerState, days: number, now: number): Promise<void> {
    const list = await this.req<
      Array<{
        id?: string
        parentID?: string
        title?: string
        metadata?: { unarchivedAt?: number }
        time?: { created?: number; updated?: number; archived?: number }
      }>
    >(st, 'GET', '/session?roots=true&limit=5000')
    if (!list.ok || !Array.isArray(list.data)) return
    const cutoff = now - days * DAY_MS
    const pinned = new Set(
      this.deps.tasks
        .list()
        .filter((t) => t.pinned)
        .map((t) => t.sessionId)
    )
    for (const s of list.data) {
      if (!s || typeof s.id !== 'string' || s.parentID) continue
      const archived = s.time?.archived
      // Restaurada por el respaldo `metadata.unarchivedAt`: cuenta como no archivada.
      const isArchived = typeof archived === 'number' && archived > 0 && !((s.metadata?.unarchivedAt ?? 0) > archived)
      if (isArchived) continue
      const updated = s.time?.updated ?? s.time?.created
      if (typeof updated !== 'number' || !(updated < cutoff)) continue
      if (typeof s.title === 'string' && s.title.startsWith(ROUTINE_PREFIX)) continue
      if (pinned.has(s.id)) continue
      // Nunca una tarea en curso o esperando (en este momento, no solo en el sondeo anterior).
      if (st.roots.has(s.id)) continue
      const r = await this.req(st, 'PATCH', `/session/${encodeURIComponent(s.id)}`, { time: { archived: this.now() } })
      if (!r.ok) continue
      try {
        this.deps.onArchived?.(s.id)
      } catch (err) {
        this.deps.log?.('[monitor] onArchived:', err)
      }
    }
  }
}
