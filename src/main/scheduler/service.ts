/**
 * Servicio de Rutinas (tareas programadas), persistidas en `userData/routines.json`.
 *
 * - Un "tick" cada 30 s (y al despertar el equipo) ejecuta las rutinas vencidas.
 *   La próxima ejecución se calcula desde max(lastRun, updatedAt), así que si la app
 *   estuvo cerrada y se perdió una o más ejecuciones, se ejecuta UNA vez al arrancar
 *   (trigger `catchup`) y luego sigue el calendario normal.
 * - Cada ejecución crea una sesión OpenCode, lanza `session.promptAsync` y espera a que la
 *   sesión quede inactiva sondeando `session.status` (NO `session.prompt` bloqueante: el `fetch`
 *   de Node corta a los 300 s — undici `headersTimeout` — y las rutinas largas fallaban, B1).
 *   Modo chat/code → sidecar principal; modo cowork → servidor sandboxeado de la carpeta.
 * - Ejecución desatendida: solo las reglas explícitas de la lista blanca de la rutina se aprueban
 *   solas (`approvals.ts`); el resto se rechaza (por defecto) o espera al usuario con una
 *   notificación (`onAsk: 'wait'`). Todo lo aprobado/rechazado y los hosts bloqueados quedan en el
 *   historial de la ejecución. Las preguntas se rechazan siempre.
 * - Control total: exige consentimiento explícito al crear la rutina y la aprobación HUMANA del plan
 *   en cada ejecución (siempre en una tarea nueva, para que ninguna aprobación se arrastre).
 * - Notificación nativa al terminar.
 */
import { app, Notification, powerMonitor } from 'electron'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createOpencodeClient, type AssistantMessage, type Message, type OpencodeClient, type Part } from '@opencode-ai/sdk/v2/client'
import type { RoutineAllowRule, RoutineInput, RoutineMode, RoutineRunRecord, RoutineTrigger, ScheduledRoutine } from '@shared/ipc-cowork'
import { buildCoworkSystemPrompt } from '@shared/cowork-prompt'
import type { NotifyTarget, Settings } from '@shared/types'
import type { CoworkManager } from '../cowork/manager'
import { loadManagedPolicy } from '../cowork/policy'
import { getMemory, type CoworkProjectsStore } from '../cowork/projects'
import { CHAT_AGENT_ID, COMPUTER_AGENT_ID, COWORK_AGENT_ID } from '../cowork/opencode-config'
import { decideUnattended } from './approvals'
import { nextRunAfter, validateSchedule } from './schedule'

const TICK_MS = 30_000
const FIRST_TICK_DELAY_MS = 8_000
const RUN_TIMEOUT_MS = 45 * 60_000
const PERMISSION_POLL_MS = 2_000
const STATUS_POLL_MS = 2_000
/** Si la sesión nunca llegó a verse ocupada ni hay respuesta, tras esto se da por terminada. */
const START_GRACE_MS = 60_000
const MAX_HISTORY = 300
const SUMMARY_MAX = 800
/** Límites del registro de permisos/hosts por ejecución (el historial se persiste en JSON). */
const MAX_LOGGED = 40
const MAX_PATTERNS_LOGGED = 8
const PATTERN_LOG_MAX = 300
const MAX_ALLOW_RULES = 50
const MAX_ALLOW_HOSTS = 50
const HOST_RE = /^[a-z0-9.-]{1,255}$/i
const PERM_RE = /^[A-Za-z0-9_*.:-]{1,200}$/

export interface SchedulerDeps {
  /** Conexión al sidecar principal (p.ej. `() => server.start()`). */
  getMainConnection: () => Promise<{ baseUrl: string; authorization: string }>
  /** Directorio del modo Chat (userData/chat-workspace). */
  chatDirectory: string
  cowork: CoworkManager
  /** Agente para rutinas en modo code (por defecto `build`). */
  codeAgent?: string
  /** Proyectos de Cowork (instrucciones/enlaces/memoria) para el prompt de las rutinas. */
  projects?: CoworkProjectsStore
  /** Ajustes de la app (p.ej. instrucciones globales de Cowork). */
  getSettings?: () => Settings
  /** Abre una tarea/sesión en la ventana principal (clic en una notificación de rutina). */
  openTarget?: (t: NotifyTarget) => void
}

interface Persisted {
  routines: ScheduledRoutine[]
  history: RoutineRunRecord[]
}

interface SchedulerEvents {
  changed: [ScheduledRoutine[]]
  run: [RoutineRunRecord]
}

/** Estado de una ejecución en curso para responder permisos pendientes. */
interface RunCtx {
  routineName: string
  client: OpencodeClient
  directory: string
  /** Sesión raíz de la ejecución. */
  root: string
  allow: RoutineAllowRule[]
  onAsk: 'reject' | 'wait'
  fullAccess: boolean
  record: RoutineRunRecord
  /** Peticiones en espera ya notificadas (una notificación por petición). */
  notified: Set<string>
  /** Sesiones descendientes (subagentes) conocidas. */
  children: Set<string>
  polling: boolean
}

const AGENT_BY_MODE: Record<RoutineMode, string> = {
  chat: CHAT_AGENT_ID,
  tasks: COWORK_AGENT_ID,
  code: 'build'
}

function errMsg(err: unknown): string {
  if (!err) return 'Error desconocido'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const o = err as { data?: { message?: unknown }; message?: unknown; name?: unknown }
    if (o.data && typeof o.data.message === 'string') return o.data.message
    if (typeof o.message === 'string') return o.message
    if (typeof o.name === 'string') return o.name
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Normaliza y valida la lista blanca de permisos de una rutina. */
function sanitizeAllow(raw: RoutineAllowRule[] | undefined): RoutineAllowRule[] {
  const out: RoutineAllowRule[] = []
  for (const r of raw ?? []) {
    const permission = typeof r?.permission === 'string' ? r.permission.trim() : ''
    const pattern = typeof r?.pattern === 'string' ? r.pattern.trim() : ''
    if (!permission && !pattern) continue
    if (!PERM_RE.test(permission)) throw new Error(`Permiso inválido en «Permitir sin preguntar»: ${permission || '(vacío)'}`)
    if (permission === '*')
      throw new Error('«Permitir sin preguntar» no admite «*» como permiso: indica el permiso concreto (p. ej. bash).')
    if (!pattern) throw new Error(`Falta el patrón de la regla «${permission}».`)
    if (pattern.length > 2000) throw new Error('Un patrón de «Permitir sin preguntar» es demasiado largo.')
    if (!out.some((x) => x.permission === permission && x.pattern === pattern)) out.push({ permission, pattern })
  }
  if (out.length > MAX_ALLOW_RULES) throw new Error(`Máximo ${MAX_ALLOW_RULES} reglas en «Permitir sin preguntar».`)
  return out
}

/** Normaliza y valida los sitios permitidos durante la ejecución. */
function sanitizeHosts(raw: string[] | undefined): string[] {
  const out: string[] = []
  for (const h of raw ?? []) {
    const host = typeof h === 'string' ? h.trim().toLowerCase() : ''
    if (!host) continue
    if (!HOST_RE.test(host)) throw new Error(`Sitio inválido: ${host}`)
    if (!out.includes(host)) out.push(host)
  }
  if (out.length > MAX_ALLOW_HOSTS) throw new Error(`Máximo ${MAX_ALLOW_HOSTS} sitios permitidos.`)
  return out
}

/** Añade `{permission, patterns}` a una lista de registro sin duplicados y con tope. */
function logEntry(list: Array<{ permission: string; patterns: string[] }>, permission: string, patterns: string[]): void {
  const pats = patterns.slice(0, MAX_PATTERNS_LOGGED).map((x) => truncate(x, PATTERN_LOG_MAX))
  const key = `${permission}\u0000${pats.join('\u0000')}`
  if (list.some((e) => `${e.permission}\u0000${e.patterns.join('\u0000')}` === key)) return
  if (list.length >= MAX_LOGGED) return
  list.push({ permission, patterns: pats })
}

/** Texto corto de una lista de permisos para la notificación ("bash (rm x), edit (…)"). */
function describeEntries(list: Array<{ permission: string; patterns: string[] }>, max = 3): string {
  const shown = list.slice(0, max).map((e) => (e.patterns[0] ? `${e.permission} (${truncate(e.patterns[0], 40)})` : e.permission))
  return shown.join(', ') + (list.length > max ? `, +${list.length - max} más` : '')
}

export class SchedulerService extends EventEmitter<SchedulerEvents> {
  private data: Persisted | null = null
  private timer: NodeJS.Timeout | null = null
  private running = new Map<string, AbortController>()
  private readonly bootAt = Date.now()
  private firstTick = true
  private offResume: (() => void) | null = null
  /** Concesiones temporales de hosts por ejecución (con recuento: varias rutinas pueden solaparse). */
  private hostGrants = new Map<string, { count: number; owned: boolean }>()
  /** Referencias a las notificaciones vivas (si no, se recogen antes de poder hacer clic). */
  private liveNotifications = new Set<Notification>()

  constructor(private readonly deps: SchedulerDeps) {
    super()
  }

  // ───────────── persistencia ─────────────

  private get file(): string {
    return join(app.getPath('userData'), 'routines.json')
  }

  private load(): Persisted {
    if (this.data) return this.data
    let data: Persisted = { routines: [], history: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        data = {
          routines: Array.isArray(raw.routines) ? raw.routines.filter((r) => r && typeof r.id === 'string') : [],
          history: Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h.id === 'string') : []
        }
        // Ejecuciones "running" de una sesión anterior de la app quedaron interrumpidas.
        for (const h of data.history) {
          if (h.status === 'running') {
            h.status = 'error'
            h.error = 'Interrumpida (la app se cerró durante la ejecución)'
            h.waiting = false
            h.finishedAt = h.finishedAt ?? h.startedAt
          }
        }
        for (const r of data.routines) {
          if (r.lastResult?.status === 'running') {
            r.lastResult = data.history.find((h) => h.id === r.lastResult?.id) ?? { ...r.lastResult, status: 'error' }
          }
        }
      }
    } catch (err) {
      console.error('[scheduler] routines.json inválido:', err)
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        // ignorar
      }
    }
    this.data = data
    return data
  }

  private save(): void {
    const file = this.file
    mkdirSync(dirname(file), { recursive: true })
    const d = this.load()
    const clean: Persisted = {
      routines: d.routines.map(({ nextRun: _n, running: _r, ...rest }) => rest),
      history: d.history.slice(0, MAX_HISTORY)
    }
    writeFileSync(`${file}.tmp`, JSON.stringify(clean, null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  private decorate(r: ScheduledRoutine): ScheduledRoutine {
    let nextRun: number | null = null
    if (r.enabled) {
      try {
        nextRun = nextRunAfter(r.schedule, this.basis(r))
      } catch {
        nextRun = null
      }
    }
    return { ...r, nextRun, running: this.running.has(r.id) }
  }

  private basis(r: ScheduledRoutine): number {
    return Math.max(r.lastRun ?? 0, r.updatedAt)
  }

  private emitChanged(): void {
    this.emit('changed', this.list())
  }

  // ───────────── API pública ─────────────

  list(): ScheduledRoutine[] {
    return this.load().routines.map((r) => this.decorate(r))
  }

  get(id: string): ScheduledRoutine {
    const r = this.load().routines.find((x) => x.id === id)
    if (!r) throw new Error('Rutina no encontrada')
    return r
  }

  saveRoutine(input: RoutineInput): ScheduledRoutine {
    if (loadManagedPolicy()?.disableRoutines) {
      throw new Error('Las rutinas están desactivadas por la política de tu organización.')
    }
    const name = input.name?.trim()
    const prompt = input.prompt?.trim()
    if (!name) throw new Error('La rutina necesita un nombre')
    if (!prompt) throw new Error('La rutina necesita una instrucción (prompt)')
    if (!['chat', 'tasks', 'code'].includes(input.mode)) throw new Error('Modo inválido')
    if (!input.model?.providerID || !input.model?.modelID) throw new Error('Selecciona un modelo')
    validateSchedule(input.schedule)
    const folder = input.folder?.trim() || null
    if (input.mode !== 'chat') {
      if (!folder) throw new Error('Los modos Tareas y Code requieren una carpeta')
      if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`La carpeta no existe: ${folder}`)
      if (input.mode === 'tasks' && !this.deps.cowork.isApproved(folder)) {
        throw new Error('La carpeta no está autorizada para las tareas (autorízala primero desde Tareas).')
      }
    }

    const data = this.load()
    const now = Date.now()
    const idx = input.id ? data.routines.findIndex((r) => r.id === input.id) : -1
    const prev = idx >= 0 ? data.routines[idx] : null
    const isCowork = input.mode === 'tasks'

    // Campos de Lote B (solo tienen sentido en modo Cowork; en otros modos se limpian).
    const sessionMode = input.sessionMode === 'continue' && isCowork ? 'continue' : 'fresh'
    const onAsk = input.onAsk === 'wait' && isCowork ? 'wait' : 'reject'
    const allow = isCowork ? sanitizeAllow(input.allow) : []

    // Control total: consentimiento explícito + concesión vigente de la carpeta. La aprobación del
    // plan sigue siendo humana en cada ejecución, así que estas rutinas no son 100 % desatendidas.
    const fullAccess = isCowork && input.fullAccess === true
    // Control total no usa el proxy del sandbox: los sitios permitidos no aplican.
    const allowHosts = isCowork && !fullAccess ? sanitizeHosts(input.allowHosts) : []
    let fullAccessConsentAt: number | null = null
    if (fullAccess) {
      const consent = input.fullAccessConsentAt ?? prev?.fullAccessConsentAt ?? null
      if (typeof consent !== 'number' || !Number.isFinite(consent) || consent <= 0 || consent > now + 60_000) {
        throw new Error('El Control total del Mac en una rutina requiere tu consentimiento explícito al crearla.')
      }
      // Si cambia la carpeta, el consentimiento anterior no vale: debe darse de nuevo.
      const sameFolder = prev?.fullAccess === true && prev.folder === folder
      if (!sameFolder && consent <= (prev?.fullAccessConsentAt ?? 0)) {
        throw new Error('Confirma de nuevo el consentimiento de Control total para esta carpeta.')
      }
      if (!folder || !this.deps.cowork.hasFullAccessGrant(folder)) {
        throw new Error('Esta carpeta no tiene Control total del Mac concedido (concédelo primero desde Tareas).')
      }
      fullAccessConsentAt = consent
    }

    let routine: ScheduledRoutine
    if (prev) {
      routine = {
        ...prev,
        name,
        prompt,
        mode: input.mode,
        folder: input.mode === 'chat' ? null : folder,
        model: input.model,
        schedule: input.schedule,
        enabled: input.enabled,
        originSessionId: input.originSessionId !== undefined ? input.originSessionId : prev.originSessionId,
        sessionMode: fullAccess ? 'fresh' : sessionMode,
        onAsk,
        allow,
        allowHosts,
        fullAccess,
        fullAccessConsentAt,
        // Si cambia la carpeta o el modo, la sesión anterior ya no corresponde.
        lastSessionId: prev.folder === folder && prev.mode === input.mode ? (prev.lastSessionId ?? null) : null,
        updatedAt: now
      }
      data.routines[idx] = routine
    } else {
      routine = {
        id: randomUUID(),
        name,
        prompt,
        mode: input.mode,
        folder: input.mode === 'chat' ? null : folder,
        model: input.model,
        schedule: input.schedule,
        enabled: input.enabled,
        originSessionId: input.originSessionId ?? null,
        sessionMode: fullAccess ? 'fresh' : sessionMode,
        onAsk,
        allow,
        allowHosts,
        fullAccess,
        fullAccessConsentAt,
        lastSessionId: null,
        createdAt: now,
        updatedAt: now
      }
      data.routines.push(routine)
    }
    this.save()
    this.emitChanged()
    return this.decorate(routine)
  }

  delete(id: string): void {
    const data = this.load()
    this.running.get(id)?.abort()
    data.routines = data.routines.filter((r) => r.id !== id)
    this.save()
    this.emitChanged()
  }

  toggle(id: string, enabled: boolean): ScheduledRoutine {
    const r = this.get(id)
    r.enabled = enabled
    // Al reactivar no se "recuperan" las ejecuciones perdidas mientras estuvo pausada.
    r.updatedAt = Date.now()
    this.save()
    this.emitChanged()
    return this.decorate(r)
  }

  history(id?: string, limit = 50): RoutineRunRecord[] {
    const h = this.load().history
    return (id ? h.filter((x) => x.routineId === id) : h).slice(0, limit)
  }

  /** "Ejecutar ahora": devuelve el registro inicial; el resultado llega por el evento `run`. */
  runNow(id: string): RoutineRunRecord {
    const r = this.get(id)
    if (this.running.has(id)) throw new Error('La rutina ya se está ejecutando')
    return this.execute(r, 'manual')
  }

  start(): void {
    if (this.timer) return
    this.load()
    setTimeout(() => void this.tick(), FIRST_TICK_DELAY_MS)
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    const onResume = (): void => void this.tick()
    powerMonitor.on('resume', onResume)
    this.offResume = () => powerMonitor.removeListener('resume', onResume)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.offResume?.()
    this.offResume = null
    for (const c of this.running.values()) c.abort()
  }

  // ───────────── ejecución ─────────────

  private async tick(): Promise<void> {
    const now = Date.now()
    const first = this.firstTick
    this.firstTick = false
    for (const r of this.load().routines) {
      if (!r.enabled || this.running.has(r.id)) continue
      let due: number | null
      try {
        due = nextRunAfter(r.schedule, this.basis(r))
      } catch {
        continue
      }
      if (due == null || due > now) continue
      const trigger: RoutineTrigger = first && due < this.bootAt ? 'catchup' : 'schedule'
      this.execute(r, trigger)
    }
  }

  private execute(r: ScheduledRoutine, trigger: RoutineTrigger): RoutineRunRecord {
    const data = this.load()
    const record: RoutineRunRecord = {
      id: randomUUID(),
      routineId: r.id,
      routineName: r.name,
      trigger,
      status: 'running',
      startedAt: Date.now()
    }
    const controller = new AbortController()
    this.running.set(r.id, controller)
    r.lastRun = record.startedAt
    r.lastResult = record
    data.history.unshift(record)
    this.save()
    this.emit('run', { ...record })
    this.emitChanged()

    void this.perform(r, record, controller.signal)
      .then((summary) => {
        record.status = 'success'
        record.summary = summary
      })
      .catch((err: unknown) => {
        record.status = 'error'
        record.error = controller.signal.aborted && !record.error ? 'Cancelada' : errMsg(err)
      })
      .finally(() => {
        record.finishedAt = Date.now()
        this.running.delete(r.id)
        const current = this.load().routines.find((x) => x.id === r.id)
        if (current) current.lastResult = { ...record }
        const h = this.load().history.find((x) => x.id === record.id)
        if (h) Object.assign(h, record)
        this.save()
        this.emit('run', { ...record })
        this.emitChanged()
        this.notify(record)
      })
    return { ...record }
  }

  private async perform(r: ScheduledRoutine, record: RoutineRunRecord, signal: AbortSignal): Promise<string> {
    if (loadManagedPolicy()?.disableRoutines) {
      throw new Error('Las rutinas están desactivadas por la política de tu organización.')
    }
    const directory = r.mode === 'chat' ? this.deps.chatDirectory : r.folder
    if (!directory) throw new Error('La rutina no tiene carpeta')
    if (r.mode !== 'chat' && !existsSync(directory)) throw new Error(`La carpeta no existe: ${directory}`)

    const isCowork = r.mode === 'tasks'
    const fullAccess = isCowork && r.fullAccess === true
    if (fullAccess) {
      if (!r.fullAccessConsentAt) {
        throw new Error('Esta rutina usa Control total del Mac pero no tiene consentimiento registrado: edítala y confírmalo.')
      }
      if (!this.deps.cowork.hasFullAccessGrant(directory)) {
        throw new Error('La carpeta ya no tiene Control total del Mac concedido: concédelo de nuevo desde Tareas o edita la rutina.')
      }
    }

    let conn: { baseUrl: string; authorization: string }
    let dirForSession = directory
    if (isCowork) {
      const cw = await this.deps.cowork.start(directory, fullAccess)
      conn = cw
      dirForSession = cw.folder // ruta real (normalizada) de la carpeta
    } else {
      conn = await this.deps.getMainConnection()
    }
    const client: OpencodeClient = createOpencodeClient({
      baseUrl: conn.baseUrl,
      headers: { Authorization: conn.authorization }
    })
    const agent = fullAccess ? COMPUTER_AGENT_ID : r.mode === 'code' ? (this.deps.codeAgent ?? AGENT_BY_MODE.code) : AGENT_BY_MODE[r.mode]

    // Sesión: 'continue' reutiliza la de la última ejecución (o la de origen) si sigue existiendo.
    // Control total siempre empieza una tarea nueva: así la aprobación del plan nunca se arrastra.
    let sessionID: string | null = null
    if (r.sessionMode === 'continue' && !fullAccess) {
      const candidate = r.lastSessionId ?? r.originSessionId ?? null
      if (candidate) {
        try {
          const got = await client.session.get({ sessionID: candidate, directory: dirForSession })
          if (!got.error && got.data) sessionID = candidate
        } catch {
          // no existe o el servidor no responde: se crea una nueva
        }
      }
    }
    if (!sessionID) {
      // Las reglas de la lista blanca NO se pasan a `session.create`: si OpenCode las aplicara solo,
      // nunca pediría permiso y no quedaría constancia de lo aprobado. Se responden desde aquí
      // (`handlePending`), que además funciona igual en sesiones reutilizadas.
      const created = await client.session.create({
        directory: dirForSession,
        title: `⏰ ${r.name}`,
        agent
      })
      if (created.error || !created.data) throw new Error(`No se pudo crear la sesión: ${errMsg(created.error)}`)
      sessionID = created.data.id
    }
    record.sessionId = sessionID
    record.directory = dirForSession
    const live = this.load().routines.find((x) => x.id === r.id)
    if (live) live.lastSessionId = sessionID
    this.save()
    this.emit('run', { ...record })

    // Sitios permitidos solo mientras dura la ejecución (proxy del sandbox) y hosts bloqueados.
    const hostsToRelease: string[] = []
    let offBlocked: (() => void) | null = null
    if (isCowork && !fullAccess) {
      for (const h of r.allowHosts ?? []) if (this.acquireHost(dirForSession, h)) hostsToRelease.push(h)
      const onBlocked = (ev: { folder: string; host: string }): void => {
        if (ev.folder !== dirForSession) return
        const host = ev.host.toLowerCase()
        const list = (record.blockedHosts ??= [])
        if (list.includes(host) || list.length >= MAX_LOGGED) return
        list.push(host)
        this.touch(record)
      }
      this.deps.cowork.on('networkBlocked', onBlocked)
      offBlocked = () => this.deps.cowork.off('networkBlocked', onBlocked)
    }

    const run: RunCtx = {
      routineName: r.name,
      client,
      directory: dirForSession,
      root: sessionID,
      allow: r.allow ?? [],
      onAsk: r.onAsk === 'wait' ? 'wait' : 'reject',
      fullAccess,
      record,
      notified: new Set(),
      children: new Set(),
      polling: false
    }
    // Responde (o rechaza) permisos/preguntas de esta sesión: nadie está mirando.
    const poll = setInterval(() => void this.handlePending(run), PERMISSION_POLL_MS)
    const onAbort = (): void => {
      void client.session.abort({ sessionID: run.root, directory: dirForSession })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => {
      record.error = fullAccess
        ? `Tiempo máximo excedido (${RUN_TIMEOUT_MS / 60_000} min). En Control total hay que aprobar el plan en persona y no se aprobó a tiempo.`
        : record.waiting
          ? `Tiempo máximo excedido (${RUN_TIMEOUT_MS / 60_000} min) esperando tu aprobación.`
          : `Tiempo máximo excedido (${RUN_TIMEOUT_MS / 60_000} min)`
      onAbort()
    }, RUN_TIMEOUT_MS)

    if (fullAccess) {
      this.notifyPlain(
        `La rutina «${r.name}» necesita que apruebes su plan`,
        'Usa Control total del Mac: abre la tarea y aprueba el plan para que continúe.',
        { mode: 'tasks', id: sessionID, directory: dirForSession, fullAccess: true }
      )
    }

    try {
      const sentAt = Date.now()
      const project = isCowork ? this.deps.projects?.get(dirForSession) : undefined
      const memory = isCowork && project?.memoryEnabled !== false ? getMemory(dirForSession).content : null
      const folderSet = isCowork ? this.deps.cowork.folderSet(dirForSession) : null
      const system = buildCoworkSystemPrompt({
        globalInstructions: isCowork ? this.deps.getSettings?.().tasksGlobalInstructions : null,
        project: project
          ? { name: project.name, instructions: project.instructions, links: project.links, memoryEnabled: project.memoryEnabled }
          : null,
        memory,
        folders: folderSet ? [...folderSet.linked, ...folderSet.trusted].map((f) => ({ path: f.path, mode: f.mode })) : [],
        unattended: true
      })
      const res = await client.session.promptAsync({
        sessionID,
        directory: dirForSession,
        agent,
        model: { providerID: r.model.providerID, modelID: r.model.modelID },
        system,
        parts: [{ type: 'text', text: r.prompt }]
      })
      if (res.error) throw new Error(errMsg(res.error))
      const final = await this.waitForCompletion(client, dirForSession, sessionID, sentAt, signal, () => !!record.error)
      if (record.error) throw new Error(record.error)
      if (!final) throw new Error('La sesión terminó sin respuesta del asistente')
      if (final.info.error) throw new Error(errMsg(final.info.error))
      return truncate(extractText(final.parts) || '(Sin texto de respuesta)', SUMMARY_MAX)
    } finally {
      clearInterval(poll)
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      offBlocked?.()
      for (const h of hostsToRelease) this.releaseHost(dirForSession, h)
      record.waiting = false
    }
  }

  // ───────────── sitios permitidos durante la ejecución ─────────────

  /** Concede `host` solo mientras dure alguna ejecución. Devuelve true si esta llamada debe liberarlo. */
  private acquireHost(folder: string, host: string): boolean {
    const key = `${folder}\u0000${host.toLowerCase()}`
    const cur = this.hostGrants.get(key)
    if (cur) {
      cur.count++
      return true
    }
    // Si ya había una concesión temporal del usuario ("Permitir esta vez"), no es nuestra: no se retira.
    const foreign = this.deps.cowork.network.hasOnce(folder, host)
    if (!foreign) this.deps.cowork.networkAllowOnce(folder, host)
    this.hostGrants.set(key, { count: 1, owned: !foreign })
    return true
  }

  private releaseHost(folder: string, host: string): void {
    const key = `${folder}\u0000${host.toLowerCase()}`
    const cur = this.hostGrants.get(key)
    if (!cur) return
    cur.count--
    if (cur.count > 0) return
    this.hostGrants.delete(key)
    if (cur.owned) this.deps.cowork.network.revokeOnce(folder, host)
  }

  /** Guarda y notifica al renderer un cambio en el registro de la ejecución en curso. */
  private touch(record: RoutineRunRecord): void {
    this.save()
    this.emit('run', { ...record })
  }

  /**
   * Espera a que la sesión termine el turno lanzado en `sentAt` y devuelve el último mensaje
   * del asistente de ese turno (o null). Sondea `session.status` (sin peticiones largas).
   */
  private async waitForCompletion(
    client: OpencodeClient,
    directory: string,
    sessionID: string,
    sentAt: number,
    signal: AbortSignal,
    timedOut: () => boolean
  ): Promise<{ info: AssistantMessage; parts: Part[] } | null> {
    let sawBusy = false
    let abortedPolls = 0
    for (;;) {
      await new Promise((r) => setTimeout(r, STATUS_POLL_MS))
      if (signal.aborted || timedOut()) abortedPolls++
      let busy = true
      try {
        const st = await client.session.status({ directory })
        const s = st.data?.[sessionID]
        busy = !!s && s.type !== 'idle'
      } catch {
        busy = true // servidor ocupado/reiniciando: reintentar
      }
      if (busy) {
        sawBusy = true
        if (abortedPolls < 15) continue // tras abortar, dar ~30 s para que se detenga
      }
      const turn = await this.lastTurn(client, directory, sessionID, sentAt)
      const done = !!turn && (!!turn.info.time.completed || !!turn.info.error)
      if (done || abortedPolls > 0) return turn
      // Idle sin respuesta completa: o aún no empezó, o terminó sin mensaje del asistente.
      if (sawBusy || Date.now() - sentAt > START_GRACE_MS) return turn
    }
  }

  /** Último mensaje del asistente que responde al mensaje de usuario enviado en `sentAt`. */
  private async lastTurn(
    client: OpencodeClient,
    directory: string,
    sessionID: string,
    sentAt: number
  ): Promise<{ info: AssistantMessage; parts: Part[] } | null> {
    try {
      const res = await client.session.messages({ sessionID, directory })
      const list = res.data ?? []
      const user = [...list].reverse().find((m) => m.info.role === 'user' && m.info.time.created >= sentAt - 5_000)
      if (!user) return null
      const replies = list.filter(
        (m): m is { info: AssistantMessage; parts: Part[] } => isAssistant(m.info) && m.info.parentID === user.info.id
      )
      return replies.at(-1) ?? null
    } catch {
      return null
    }
  }

  /** Sesiones descendientes (subagentes) de la raíz: sus permisos también hay que responderlos. */
  private async refreshChildren(run: RunCtx): Promise<void> {
    let frontier = [run.root]
    for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
      const next: string[] = []
      for (const id of frontier) {
        const res = await run.client.session.children({ sessionID: id, directory: run.directory })
        for (const c of res.data ?? []) {
          if (!run.children.has(c.id)) {
            run.children.add(c.id)
            next.push(c.id)
          }
        }
      }
      frontier = next
    }
  }

  /**
   * Trata los permisos y preguntas pendientes de la ejecución (raíz + subagentes):
   * - en la lista blanca → `once` y a `approved`;
   * - fuera de ella y `onAsk: 'reject'` → `reject` y a `rejected`;
   * - fuera de ella y `onAsk: 'wait'` → no se responde; se avisa una vez y se marca `waiting`.
   * Las preguntas se rechazan siempre. Solo se registra lo que el servidor confirmó.
   */
  private async handlePending(run: RunCtx): Promise<void> {
    if (run.polling) return
    run.polling = true
    try {
      const { client, directory, record } = run
      try {
        await this.refreshChildren(run)
      } catch {
        // sin árbol de hijas: se sigue con la raíz
      }
      const mine = (id: string): boolean => id === run.root || run.children.has(id)
      let changed = false
      const waitingNow = new Set<string>()

      const perms = await client.permission.list({ directory })
      for (const p of perms.data ?? []) {
        if (!mine(p.sessionID)) continue
        const patterns = Array.isArray(p.patterns) ? p.patterns : []
        if (decideUnattended({ permission: p.permission, patterns }, run.allow) === 'allow') {
          const res = await client.permission.reply({ requestID: p.id, directory, reply: 'once' })
          if (!res.error) {
            logEntry((record.approved ??= []), p.permission, patterns)
            changed = true
          }
        } else if (run.onAsk === 'wait') {
          waitingNow.add(p.id)
          if (!run.notified.has(p.id)) {
            run.notified.add(p.id)
            this.notifyPlain(
              `La rutina «${run.routineName}» necesita tu aprobación`,
              patterns[0] ? `${p.permission}: ${truncate(patterns[0], 140)}` : p.permission,
              { mode: 'tasks', id: run.root, directory, fullAccess: run.fullAccess }
            )
          }
        } else {
          const res = await client.permission.reply({
            requestID: p.id,
            directory,
            reply: 'reject',
            message:
              'Ejecución programada desatendida: este permiso no está en la lista «Permitir sin preguntar» de la rutina. Continúa sin esta acción.'
          })
          if (!res.error) {
            logEntry((record.rejected ??= []), p.permission, patterns)
            changed = true
          }
        }
      }

      const qs = await client.question.list({ directory })
      for (const q of qs.data ?? []) {
        if (!mine(q.sessionID)) continue
        const res = await client.question.reject({ requestID: q.id, directory })
        if (!res.error) {
          logEntry(
            (record.rejected ??= []),
            'question',
            (q.questions ?? []).map((x) => x.question)
          )
          changed = true
        }
      }

      const waiting = waitingNow.size > 0
      if (waiting !== !!record.waiting) {
        record.waiting = waiting
        changed = true
      }
      if (changed) this.touch(record)
    } catch {
      // el servidor puede estar ocupado; se reintenta en el próximo poll
    } finally {
      run.polling = false
    }
  }

  /** Notificación nativa; al hacer clic abre la tarea en la ventana principal. */
  private notifyPlain(title: string, body: string, target?: NotifyTarget): void {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body: truncate(body, 300), silent: false })
    this.liveNotifications.add(n)
    const drop = (): void => void this.liveNotifications.delete(n)
    n.on('click', () => {
      if (target) this.deps.openTarget?.(target)
      drop()
    })
    n.on('close', drop)
    n.show()
  }

  private notify(record: RoutineRunRecord): void {
    const ok = record.status === 'success'
    const rejected = record.rejected ?? []
    const extras: string[] = []
    if (rejected.length > 0) {
      extras.push(
        `${rejected.length === 1 ? 'Se rechazó 1 permiso' : `Se rechazaron ${rejected.length} permisos`}: ${describeEntries(rejected)}.`
      )
    }
    if ((record.blockedHosts?.length ?? 0) > 0) {
      extras.push(`Sitios bloqueados: ${record.blockedHosts!.slice(0, 4).join(', ')}${record.blockedHosts!.length > 4 ? '…' : ''}.`)
    }
    const main = truncate((ok ? record.summary : record.error) ?? '', 180)
    const body = [...extras, main].filter(Boolean).join('\n')
    const target: NotifyTarget | undefined =
      record.sessionId && record.directory && this.load().routines.find((x) => x.id === record.routineId)?.mode === 'tasks'
        ? {
            mode: 'tasks',
            id: record.sessionId,
            directory: record.directory,
            fullAccess: this.load().routines.find((x) => x.id === record.routineId)?.fullAccess === true
          }
        : undefined
    this.notifyPlain(ok ? `Rutina completada: ${record.routineName}` : `Rutina con error: ${record.routineName}`, body, target)
  }
}

function isAssistant(m: Message): m is AssistantMessage {
  return m.role === 'assistant'
}

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text' && !p.synthetic && !p.ignored)
    .map((p) => p.text)
    .join('\n\n')
}
