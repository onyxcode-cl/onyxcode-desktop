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
 *   Modo chat/code → sidecar principal; modo tasks → servidor sandboxeado de la carpeta.
 * - Ejecución desatendida: solo las reglas explícitas de la lista blanca de la rutina se aprueban
 *   solas (`approvals.ts`); el resto se rechaza (por defecto) o espera al usuario con una
 *   notificación (`onAsk: 'wait'`). Todo lo aprobado/rechazado y los hosts bloqueados quedan en el
 *   historial de la ejecución. Las preguntas se rechazan siempre.
 * - Control total: exige consentimiento explícito al crear la rutina y la aprobación HUMANA del plan
 *   en cada ejecución (siempre en una tarea nueva, para que ninguna aprobación se arrastre).
 * - Notificación nativa al terminar.
 * - Disparador por archivo (`schedule.kind === 'file'`): lo vigila `FileWatchManager`, que este servicio sincroniza con la lista
 *   de rutinas (nunca hay un vigilante sin rutina activa que lo respalde). Ver `file-trigger.ts`.
 * - Ejecuciones perdidas (app cerrada o equipo dormido): según `onMissed` se ejecuta UNA vez, se omite, o (por defecto) se
 *   pone en la bandeja para que la persona decida. Nunca se acumulan.
 * - Bandeja «Resultados por revisar» (`inbox`): cada ejecución terminada deja un elemento para aprobar o descartar.
 */
import { getLang, t } from '@shared/i18n'
import { app, Notification, powerMonitor } from 'electron'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createOpencodeClient, type AssistantMessage, type Message, type OpencodeClient, type Part } from '@opencode-ai/sdk/v2/client'
import type {
  RoutineAllowRule,
  RoutineFileSchedule,
  RoutineInboxAction,
  RoutineInboxItem,
  RoutineInput,
  RoutineMode,
  RoutineRunRecord,
  RoutineTrigger,
  ScheduledRoutine,
  TasksFolderSet
} from '@shared/ipc-tasks'
import { buildTasksSystemPrompt } from '@shared/tasks-prompt'
import type { NotifyTarget, Settings } from '@shared/types'
import { loadManagedPolicy } from '../tasks/policy'
import { getMemory, type TasksProjectsStore } from '../tasks/projects'
import { learnedMemoryForPrompt } from '../tasks/learned-memory'
import { enqueueFromRoutine } from '../tasks/learned-pending'
import { stripMemoryProposalBlock } from '@shared/memory-proposal'
import { stripSkillProposalBlock } from '@shared/skill-proposal'
import { CHAT_AGENT_ID, COMPUTER_AGENT_ID, TASKS_AGENT_ID } from '@shared/agents'
import { shouldRunUnattended } from '@shared/routines-terms'
import { decideUnattended } from './approvals'
import { pickRoutineModel } from './model'
import { nextRunAfter, missedRuns, validateSchedule } from './schedule'
import { buildFilePrompt, isSameOrInside, parsePatterns, watchFolderReason } from './file-trigger'
import { FileWatchManager, type FsLike } from './file-watch-manager'

const TICK_MS = 30_000
const FIRST_TICK_DELAY_MS = 8_000
const RUN_TIMEOUT_MS = 45 * 60_000
const PERMISSION_POLL_MS = 2_000
const STATUS_POLL_MS = 2_000
/** Si la sesión nunca llegó a verse ocupada ni hay respuesta, tras esto se da por terminada. */
const START_GRACE_MS = 60_000
const MAX_HISTORY = 300
/** Una ejecución que llega con más retraso que esto (equipo dormido, app cerrada) cuenta como perdida. */
export const MISSED_GRACE_MS = 3 * 60_000
const MAX_INBOX_RESOLVED = 50
const MAX_INBOX = 200
const MAX_FILES_LISTED = 20
const CAP_NOTE_MS = 30 * 60_000
const SUMMARY_MAX = 800
/** Límites del registro de permisos/hosts por ejecución (el historial se persiste en JSON). */
const MAX_LOGGED = 40
const MAX_PATTERNS_LOGGED = 8
const PATTERN_LOG_MAX = 300
const MAX_ALLOW_RULES = 50
const MAX_ALLOW_HOSTS = 50
const HOST_RE = /^[a-z0-9.-]{1,255}$/i
const PERM_RE = /^[A-Za-z0-9_*.:-]{1,200}$/

/**
 * Lo que el planificador necesita del gestor de Tareas (solo rutinas en modo Tareas). Una interfaz mínima
 * para no importar `tasks/manager` (Seatbelt, proxy…) fuera de macOS: allí se usa `NoTasksPort`.
 */
export interface RoutineTasksPort {
  isApproved(folder: string): boolean
  /** ¿Puede arrancar Control total en esa carpeta? (consentimiento del equipo o concesión antigua de la carpeta.) */
  canStartFullAccess(folder: string): boolean
  /** Motivo por el que la política de carpetas no admite `folder` (ya normalizada por el gestor), o null. */
  folderForbidden?(folder: string): string | null
  start(folder: string, fullAccess: boolean): Promise<{ baseUrl: string; authorization: string; folder: string; directory?: string }>
  folderSet(folder: string): TasksFolderSet
  networkAllowOnce(folder: string, host: string): void
  readonly network: { hasOnce(folder: string, host: string): boolean; revokeOnce(folder: string, host: string): void }
  on(event: 'networkBlocked', listener: (ev: { folder: string; host: string }) => void): unknown
  off(event: 'networkBlocked', listener: (ev: { folder: string; host: string }) => void): unknown
}

export interface SchedulerDeps {
  /** Conexión al sidecar principal (p.ej. `() => server.start()`). */
  getMainConnection: () => Promise<{ baseUrl: string; authorization: string }>
  /** Directorio del modo Chat (userData/chat-workspace). */
  chatDirectory: string
  tasks: RoutineTasksPort
  /** false = esta plataforma no tiene modo Tareas: guardar o ejecutar una rutina en modo Tareas se rechaza (por defecto true). */
  tasksSupported?: boolean
  /** Agente para rutinas en modo code (por defecto `build`). */
  codeAgent?: string
  /** Proyectos de Tareas (instrucciones/enlaces/memoria) para el prompt de las rutinas. */
  projects?: TasksProjectsStore
  /** Ajustes de la app (p.ej. instrucciones globales de Tareas). */
  getSettings?: () => Settings
  /** Abre una tarea/sesión en la ventana principal (clic en una notificación de rutina). */
  openTarget?: (t: NotifyTarget) => void
  /** ¿Se permiten avisos del sistema? (interruptor de la app). Por defecto sí. */
  notificationsEnabled?: () => boolean
  /** Archivos que dejó una ejecución en la carpeta (rutas relativas). */
  deliverables?: (folder: string, since: number) => string[]
  /** Acceso al sistema de archivos del disparador por archivo (solo pruebas). */
  watchFs?: FsLike
  /** Carpeta de datos de la app (para rechazarla como carpeta vigilada); por defecto `app.getPath('userData')`. */
  userDataDir?: string
}

interface Persisted {
  routines: ScheduledRoutine[]
  history: RoutineRunRecord[]
  inbox: RoutineInboxItem[]
}

interface SchedulerEvents {
  changed: [ScheduledRoutine[]]
  run: [RoutineRunRecord]
  inbox: [RoutineInboxItem[]]
}

/** Estado de una ejecución en curso para responder permisos pendientes. */
interface RunCtx {
  routineName: string
  client: OpencodeClient
  /** Carpeta tal como la ve OpenCode (`?directory=`): en Windows, la ruta dentro de la distro; en macOS, la misma carpeta. */
  directory: string
  /** Identidad de la carpeta (la de la interfaz): destino de las notificaciones. */
  folder: string
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
  tasks: TASKS_AGENT_ID,
  code: 'build'
}

function errMsg(err: unknown): string {
  if (!err) return t('merr.routine.unknownError')
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
    if (!PERM_RE.test(permission)) throw new Error(t('merr.routine.permInvalid', { permission: permission || t('merr.routine.empty') }))
    if (permission === '*') throw new Error(t('merr.routine.noWildcard'))
    if (!pattern) throw new Error(t('merr.routine.patternMissing', { permission }))
    if (pattern.length > 2000) throw new Error(t('merr.routine.patternLong'))
    if (!out.some((x) => x.permission === permission && x.pattern === pattern)) out.push({ permission, pattern })
  }
  if (out.length > MAX_ALLOW_RULES) throw new Error(t('merr.routine.maxRules', { max: MAX_ALLOW_RULES }))
  return out
}

/** Normaliza y valida los sitios permitidos durante la ejecución. */
function sanitizeHosts(raw: string[] | undefined): string[] {
  const out: string[] = []
  for (const h of raw ?? []) {
    const host = typeof h === 'string' ? h.trim().toLowerCase() : ''
    if (!host) continue
    if (!HOST_RE.test(host)) throw new Error(t('merr.routine.hostInvalid', { host }))
    if (!out.includes(host)) out.push(host)
  }
  if (out.length > MAX_ALLOW_HOSTS) throw new Error(t('merr.routine.maxHosts', { max: MAX_ALLOW_HOSTS }))
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
  return shown.join(', ') + (list.length > max ? `, ${t('merr.routine.moreCount', { count: list.length - max })}` : '')
}

export class SchedulerService extends EventEmitter<SchedulerEvents> {
  private data: Persisted | null = null
  private timer: NodeJS.Timeout | null = null
  private running = new Map<string, AbortController>()
  private readonly bootAt = Date.now()
  private firstTick = true
  /** Para registrar una sola vez (no cada tick) que se omiten las rutinas por falta del aviso. */
  private skippedForTerms = false
  private offResume: (() => void) | null = null
  /** Concesiones temporales de hosts por ejecución (con recuento: varias rutinas pueden solaparse). */
  private hostGrants = new Map<string, { count: number; owned: boolean }>()
  /** Referencias a las notificaciones vivas (si no, se recogen antes de poder hacer clic). */
  private liveNotifications = new Set<Notification>()
  private started = false
  private capNotedAt = new Map<string, number>()
  private readonly watch: FileWatchManager

  constructor(private readonly deps: SchedulerDeps) {
    super()
    this.watch = new FileWatchManager({
      fs: deps.watchFs,
      allowed: () => !loadManagedPolicy()?.disableRoutines && shouldRunUnattended(this.deps.getSettings?.()),
      isRunning: (id) => this.running.has(id),
      folderProblem: (r, s) => this.fileFolderProblem(r, s),
      onFire: (r, names, folder) => this.fireFile(r.id, names, folder),
      onCapped: (r) => this.noteCapped(r.id),
      onLost: () => this.emit('changed', this.list())
    })
  }

  // ───────────── persistencia ─────────────

  private get file(): string {
    return join(app.getPath('userData'), 'routines.json')
  }

  private load(): Persisted {
    if (this.data) return this.data
    let data: Persisted = { routines: [], history: [], inbox: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        data = {
          routines: Array.isArray(raw.routines) ? raw.routines.filter((r) => r && typeof r.id === 'string') : [],
          history: Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h.id === 'string') : [],
          inbox: Array.isArray(raw.inbox) ? raw.inbox.filter((i) => i && typeof i.id === 'string') : []
        }
        // Ejecuciones "running" de una sesión anterior de la app quedaron interrumpidas.
        for (const h of data.history) {
          if (h.status === 'running') {
            h.status = 'error'
            h.error = t('merr.routine.interrupted')
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
      history: d.history.slice(0, MAX_HISTORY),
      inbox: d.inbox
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
    let fileWatch: ScheduledRoutine['fileWatch']
    if (r.schedule.kind === 'file') {
      const st = r.enabled ? this.watch.state(r.id) : { state: 'off' as const }
      const snap = 'snapshot' in st ? st.snapshot : undefined
      fileWatch = { state: st.state, firedLastHour: snap?.firedLastHour ?? 0, capped: snap?.capped ?? false }
    }
    return { ...r, nextRun, running: this.running.has(r.id), ...(fileWatch ? { fileWatch } : {}) }
  }

  private basis(r: ScheduledRoutine): number {
    return Math.max(r.lastRun ?? 0, r.updatedAt, r.missedHandledAt ?? 0)
  }

  private emitChanged(): void {
    this.syncWatchers()
    this.emit('changed', this.list())
  }

  private emitInbox(): void {
    this.emit('inbox', this.inboxList())
  }

  /** Deja los vigilantes de carpeta exactamente como pide la lista de rutinas (solo con el planificador en marcha). */
  private syncWatchers(): void {
    if (!this.started) return
    try {
      this.watch.sync(this.load().routines)
    } catch (err) {
      console.error('[scheduler] vigilantes de carpeta:', err)
    }
  }

  // ───────────── disparador por archivo ─────────────

  /** Motivo por el que la carpeta vigilada no sirve ahora mismo (mensaje ya traducido), o null. */
  private fileFolderProblem(r: ScheduledRoutine, s: RoutineFileSchedule): string | null {
    const ctx = { home: homedir(), userData: this.deps.userDataDir ?? app.getPath('userData') }
    const reason = watchFolderReason(s.folder, ctx)
    if (reason) return t(`merr.routine.fileFolder.${reason}` as 'merr.routine.fileFolder.root')
    try {
      if (!statSync(s.folder).isDirectory()) return t('merr.task.noFolder', { folder: s.folder })
    } catch {
      return t('merr.task.noFolder', { folder: s.folder })
    }
    // Una carpeta enlazada fuera de lo permitido no cuela: se comprueba también la ruta real.
    try {
      const real = realpathSync(s.folder)
      if (real !== s.folder && watchFolderReason(real, ctx)) return t('merr.routine.fileFolder.root')
    } catch {
      return t('merr.task.noFolder', { folder: s.folder })
    }
    if (r.mode !== 'chat') {
      // Tareas y Code: la carpeta vigilada es la de la rutina (autorizada) o una dentro de ella.
      if (!r.folder || !isSameOrInside(s.folder, r.folder)) return t('merr.routine.fileFolderOutside')
      if (r.mode === 'tasks' && r.fullAccess !== true && !this.deps.tasks.isApproved(r.folder)) return t('merr.routine.folderNotAuthorized')
    }
    return this.deps.tasks.folderForbidden?.(s.folder) ?? null
  }

  private fireFile(routineId: string, names: string[], watchFolder: string): void {
    const r = this.load().routines.find((x) => x.id === routineId)
    if (!r || !r.enabled || this.running.has(routineId) || r.schedule.kind !== 'file') return
    this.execute(r, 'file', { files: names, watchFolder })
  }

  private noteCapped(routineId: string): void {
    const r = this.load().routines.find((x) => x.id === routineId)
    if (!r) return
    const at = Date.now()
    if (at - (this.capNotedAt.get(routineId) ?? 0) < CAP_NOTE_MS) return
    this.capNotedAt.set(routineId, at)
    this.notifyPlain(t('merr.notif.routineCapped', { name: r.name }), t('merr.notif.routineCappedBody'))
    this.emit('changed', this.list())
  }

  // ───────────── API pública ─────────────

  list(): ScheduledRoutine[] {
    return this.load().routines.map((r) => this.decorate(r))
  }

  get(id: string): ScheduledRoutine {
    const r = this.load().routines.find((x) => x.id === id)
    if (!r) throw new Error(t('merr.routine.notFound'))
    return r
  }

  saveRoutine(input: RoutineInput): ScheduledRoutine {
    if (loadManagedPolicy()?.disableRoutines) {
      throw new Error(t('merr.routine.orgDisabled'))
    }
    const name = input.name?.trim()
    const prompt = input.prompt?.trim()
    if (!name) throw new Error(t('merr.routine.needsName'))
    if (!prompt) throw new Error(t('merr.routine.needsPrompt'))
    if (!['chat', 'tasks', 'code'].includes(input.mode)) throw new Error(t('merr.routine.badMode'))
    if (input.mode === 'tasks' && this.deps.tasksSupported === false) throw new Error(t('merr.routine.platformUnsupported'))
    if (!input.model?.providerID || !input.model?.modelID) throw new Error(t('merr.routine.pickModel'))
    let schedule: RoutineInput['schedule'] = input.schedule
    if (schedule.kind === 'file') {
      schedule = { ...schedule, folder: schedule.folder.trim(), patterns: parsePatterns(schedule.patterns) }
    }
    validateSchedule(schedule)
    const folder = input.folder?.trim() || null
    if (input.mode !== 'chat') {
      if (!folder) throw new Error(t('merr.routine.needsFolder'))
      if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(t('merr.task.noFolder', { folder }))
      // Control total no confina a una carpeta: no exige que esté autorizada para Sandbox (sí el consentimiento del equipo).
      if (input.mode === 'tasks' && input.fullAccess !== true && !this.deps.tasks.isApproved(folder)) {
        throw new Error(t('merr.routine.folderNotAuthorized'))
      }
    }

    if (schedule.kind === 'file') {
      // La carpeta vigilada pasa por la misma validación que la de la rutina (autorizada, dentro de la de trabajo, política).
      const problem = this.fileFolderProblem(
        { ...({} as ScheduledRoutine), mode: input.mode, folder, fullAccess: input.fullAccess === true && input.mode === 'tasks' },
        schedule
      )
      if (problem) throw new Error(problem)
    }

    const data = this.load()
    const now = Date.now()
    const idx = input.id ? data.routines.findIndex((r) => r.id === input.id) : -1
    const prev = idx >= 0 ? data.routines[idx] : null
    const isTasks = input.mode === 'tasks'

    // Campos de Lote B (solo tienen sentido en modo Tareas; en otros modos se limpian).
    const sessionMode = input.sessionMode === 'continue' && isTasks ? 'continue' : 'fresh'
    const onAsk = input.onAsk === 'wait' && isTasks ? 'wait' : 'reject'
    const allow = isTasks ? sanitizeAllow(input.allow) : []

    // Control total: consentimiento explícito + concesión vigente de la carpeta. La aprobación del
    // plan sigue siendo humana en cada ejecución, así que estas rutinas no son 100 % desatendidas.
    const fullAccess = isTasks && input.fullAccess === true
    // Control total no usa el proxy del sandbox: los sitios permitidos no aplican.
    const allowHosts = isTasks && !fullAccess ? sanitizeHosts(input.allowHosts) : []
    let fullAccessConsentAt: number | null = null
    if (fullAccess) {
      const consent = input.fullAccessConsentAt ?? prev?.fullAccessConsentAt ?? null
      if (typeof consent !== 'number' || !Number.isFinite(consent) || consent <= 0 || consent > now + 60_000) {
        throw new Error(t('merr.routine.fullNeedsConsent'))
      }
      // Si cambia la carpeta, el consentimiento anterior no vale: debe darse de nuevo.
      const sameFolder = prev?.fullAccess === true && prev.folder === folder
      if (!sameFolder && consent <= (prev?.fullAccessConsentAt ?? 0)) {
        throw new Error(t('merr.routine.reconfirm'))
      }
      if (!folder || !this.deps.tasks.canStartFullAccess(folder)) {
        throw new Error(t('merr.routine.folderNoFull'))
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
        schedule,
        onMissed: input.onMissed ?? prev?.onMissed ?? 'ask',
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
        schedule,
        onMissed: input.onMissed ?? 'ask',
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
    // Sus avisos pendientes de decisión ya no tienen a quién ejecutar.
    const before = data.inbox.length
    data.inbox = data.inbox.filter((i) => !(i.routineId === id && i.kind === 'missed'))
    this.save()
    this.emitChanged()
    if (data.inbox.length !== before) this.emitInbox()
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
    if (this.running.has(id)) throw new Error(t('merr.routine.alreadyRunning'))
    return this.execute(r, 'manual')
  }

  start(): void {
    if (this.timer) return
    this.load()
    this.started = true
    this.syncWatchers()
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
    this.started = false
    this.watch.stopAll() // sin vigilantes huérfanos al cerrar la app
    for (const c of this.running.values()) c.abort()
  }

  /** Cantidad de vigilantes de carpeta vivos (diagnóstico y pruebas). */
  watcherCount(): number {
    return this.watch.size
  }

  // ───────────── ejecución ─────────────

  private async tick(): Promise<void> {
    const now = Date.now()
    const first = this.firstTick
    this.firstTick = false
    this.syncWatchers() // reintenta carpetas que estaban desconectadas y respeta el aviso de términos
    // Sin el reconocimiento del aviso sobre los términos de OpenCode no se ejecuta nada por horario.
    // «Ejecutar ahora» (`runNow`) no pasa por aquí y sigue funcionando siempre.
    if (!shouldRunUnattended(this.deps.getSettings?.())) {
      const active = this.load().routines.filter((r) => r.enabled).length
      if (active > 0 && !this.skippedForTerms) {
        console.warn(
          `[scheduler] ${active} rutina(s) activa(s) NO se ejecutan solas: falta reconocer el aviso sobre los términos de OpenCode (Rutinas). «Ejecutar ahora» sigue disponible.`
        )
      }
      this.skippedForTerms = active > 0
      return
    }
    this.skippedForTerms = false
    for (const r of this.load().routines) {
      if (!r.enabled || this.running.has(r.id)) continue
      let due: number | null
      try {
        due = nextRunAfter(r.schedule, this.basis(r))
      } catch {
        continue
      }
      if (due == null || due > now) continue
      if ((first && due < this.bootAt) || now - due > MISSED_GRACE_MS) {
        this.handleMissed(r, now)
        continue
      }
      this.execute(r, 'schedule')
    }
  }

  /**
   * La ejecución se perdió (app cerrada o equipo dormido). Se decide UNA vez por rutina, sobre la más reciente:
   * `run` la ejecuta, `skip` la omite y `ask` (por defecto) la deja en la bandeja. En los tres casos el calendario
   * sigue desde ahora, así que nunca se acumulan decenas de ejecuciones.
   */
  private handleMissed(r: ScheduledRoutine, now: number): void {
    const missed = missedRuns(r.schedule, this.basis(r), now)
    if (!missed) return
    r.missedHandledAt = now
    const mode = r.onMissed ?? 'ask'
    if (mode === 'run') {
      this.save()
      this.execute(r, 'catchup')
      return
    }
    if (mode === 'ask') {
      const inbox = this.load().inbox
      const existing = inbox.find((i) => i.kind === 'missed' && i.routineId === r.id && i.status === 'pending')
      if (existing) {
        existing.dueAt = missed.latest
        existing.missedCount = (existing.missedCount ?? 0) + missed.count
        existing.createdAt = now
      } else {
        inbox.unshift({
          id: randomUUID(),
          kind: 'missed',
          routineId: r.id,
          routineName: r.name,
          status: 'pending',
          createdAt: now,
          dueAt: missed.latest,
          missedCount: missed.count
        })
      }
      this.pruneInbox()
      this.save()
      this.emitInbox()
      this.notifyPlain(t('merr.notif.routineMissed', { name: r.name }), t('merr.notif.routineMissedBody'))
      return
    }
    this.save()
    this.emitChanged()
  }

  // ───────────── bandeja «Resultados por revisar» ─────────────

  inboxList(): RoutineInboxItem[] {
    return [...this.load().inbox].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Conserva todo lo pendiente y solo las últimas resueltas. */
  private pruneInbox(): void {
    const d = this.load()
    const pending = d.inbox.filter((i) => i.status === 'pending')
    const resolved = d.inbox.filter((i) => i.status !== 'pending').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
    d.inbox = [...pending, ...resolved.slice(0, MAX_INBOX_RESOLVED)].slice(0, MAX_INBOX)
  }

  /**
   * Resuelve un elemento: `approve`/`dismiss` cierran un resultado; `run` vuelve a ejecutar la rutina (y cierra el
   * elemento); `skip` omite una ejecución perdida. Una acción que no corresponde al tipo se rechaza.
   */
  resolveInbox(id: string, action: RoutineInboxAction): RoutineInboxItem[] {
    const item = this.load().inbox.find((i) => i.id === id)
    if (!item) throw new Error(t('merr.routine.inboxNotFound'))
    if (item.status !== 'pending') return this.inboxList()
    const allowed: RoutineInboxAction[] = item.kind === 'result' ? ['approve', 'dismiss', 'run'] : ['run', 'skip']
    if (!allowed.includes(action)) throw new Error(t('merr.routine.inboxBadAction'))
    if (action === 'run') {
      const r = this.get(item.routineId)
      if (this.running.has(r.id)) throw new Error(t('merr.routine.alreadyRunning'))
      this.execute(r, item.kind === 'missed' ? 'catchup' : 'manual')
    }
    item.status = action === 'approve' ? 'approved' : action === 'run' && item.kind === 'missed' ? 'approved' : 'dismissed'
    item.resolvedAt = Date.now()
    this.pruneInbox()
    this.save()
    this.emitInbox()
    return this.inboxList()
  }

  private addResultToInbox(r: ScheduledRoutine, record: RoutineRunRecord): void {
    if (record.error === 'Cancelada' && !this.load().routines.some((x) => x.id === r.id)) return
    const d = this.load()
    d.inbox.unshift({
      id: randomUUID(),
      kind: 'result',
      routineId: r.id,
      routineName: r.name,
      status: 'pending',
      createdAt: record.finishedAt ?? Date.now(),
      runId: record.id,
      runStatus: record.status,
      trigger: record.trigger,
      summary: record.summary,
      error: record.error,
      files: record.files,
      triggerFiles: record.triggerFiles,
      sessionId: record.sessionId,
      directory: record.directory,
      rejectedCount: record.rejected?.length ?? 0
    })
    this.pruneInbox()
  }

  private execute(r: ScheduledRoutine, trigger: RoutineTrigger, opts?: { files: string[]; watchFolder: string }): RoutineRunRecord {
    const data = this.load()
    const record: RoutineRunRecord = {
      id: randomUUID(),
      routineId: r.id,
      routineName: r.name,
      trigger,
      status: 'running',
      startedAt: Date.now(),
      ...(opts ? { triggerFiles: opts.files.slice(0, MAX_FILES_LISTED) } : {})
    }
    const fileCtx = opts ?? null
    const controller = new AbortController()
    this.running.set(r.id, controller)
    r.lastRun = record.startedAt
    r.lastResult = record
    data.history.unshift(record)
    this.save()
    this.emit('run', { ...record })
    this.emitChanged()

    void this.perform(r, record, controller.signal, fileCtx)
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
        if (record.status === 'success' && r.mode === 'tasks' && record.directory && this.deps.deliverables) {
          try {
            const trig = new Set(record.triggerFiles ?? [])
            const files = this.deps.deliverables(record.directory, record.startedAt).filter((f) => !trig.has(f))
            if (files.length > 0) record.files = files.slice(0, MAX_FILES_LISTED)
          } catch {
            // sin lista de archivos: el resumen basta
          }
        }
        this.watch.runFinished(r.id)
        const current = this.load().routines.find((x) => x.id === r.id)
        if (current) current.lastResult = { ...record }
        const h = this.load().history.find((x) => x.id === record.id)
        if (h) Object.assign(h, record)
        this.addResultToInbox(r, record)
        this.save()
        this.emit('run', { ...record })
        this.emitChanged()
        this.emitInbox()
        this.notify(record)
      })
    return { ...record }
  }

  private async perform(
    r: ScheduledRoutine,
    record: RoutineRunRecord,
    signal: AbortSignal,
    fileCtx: { files: string[]; watchFolder: string } | null = null
  ): Promise<string> {
    if (loadManagedPolicy()?.disableRoutines) {
      throw new Error(t('merr.routine.orgDisabled'))
    }
    if (r.mode === 'tasks' && this.deps.tasksSupported === false) throw new Error(t('merr.routine.platformUnsupported'))
    const directory = r.mode === 'chat' ? this.deps.chatDirectory : r.folder
    if (!directory) throw new Error(t('merr.routine.noSavedFolder'))
    if (r.mode !== 'chat' && !existsSync(directory)) throw new Error(t('merr.task.noFolder', { folder: directory }))

    const isTasks = r.mode === 'tasks'
    const fullAccess = isTasks && r.fullAccess === true
    if (fullAccess) {
      if (!r.fullAccessConsentAt) {
        throw new Error(t('merr.routine.noConsent'))
      }
      if (!this.deps.tasks.canStartFullAccess(directory)) {
        throw new Error(t('merr.routine.fullRevoked'))
      }
    }

    let conn: { baseUrl: string; authorization: string }
    let dirForSession = directory
    // Lo que entiende OpenCode (`?directory=`); la identidad (`dirForSession`) sigue siendo la carpeta de la interfaz.
    let ocDirectory = directory
    if (isTasks) {
      const cw = await this.deps.tasks.start(directory, fullAccess)
      conn = cw
      dirForSession = cw.folder // ruta real (normalizada) de la carpeta
      ocDirectory = cw.directory ?? cw.folder
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
          const got = await client.session.get({ sessionID: candidate, directory: ocDirectory })
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
        directory: ocDirectory,
        title: `⏰ ${r.name}`,
        agent
      })
      if (created.error || !created.data) throw new Error(t('merr.routine.sessionFailed', { detail: errMsg(created.error) }))
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
    if (isTasks && !fullAccess) {
      for (const h of r.allowHosts ?? []) if (this.acquireHost(dirForSession, h)) hostsToRelease.push(h)
      const onBlocked = (ev: { folder: string; host: string }): void => {
        if (ev.folder !== dirForSession) return
        const host = ev.host.toLowerCase()
        const list = (record.blockedHosts ??= [])
        if (list.includes(host) || list.length >= MAX_LOGGED) return
        list.push(host)
        this.touch(record)
      }
      this.deps.tasks.on('networkBlocked', onBlocked)
      offBlocked = () => this.deps.tasks.off('networkBlocked', onBlocked)
    }

    const run: RunCtx = {
      routineName: r.name,
      client,
      directory: ocDirectory,
      folder: dirForSession,
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
      void client.session.abort({ sessionID: run.root, directory: ocDirectory })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => {
      const min = RUN_TIMEOUT_MS / 60_000
      record.error = fullAccess
        ? t('merr.routine.timeoutFull', { min })
        : record.waiting
          ? t('merr.routine.timeoutWaiting', { min })
          : t('merr.routine.timeout', { min })
      onAbort()
    }, RUN_TIMEOUT_MS)

    if (fullAccess) {
      this.notifyPlain(t('merr.notif.routineNeedsPlan', { name: r.name }), t('merr.notif.routineFullBody'), {
        mode: 'tasks',
        id: sessionID,
        directory: dirForSession,
        fullAccess: true
      })
    }

    try {
      const sentAt = Date.now()
      const project = isTasks ? this.deps.projects?.get(dirForSession) : undefined
      const memory = isTasks && project?.memoryEnabled !== false ? getMemory(dirForSession).content : null
      const learned = isTasks ? learnedMemoryForPrompt(dirForSession) : null
      const folderSet = isTasks ? this.deps.tasks.folderSet(dirForSession) : null
      const system = buildTasksSystemPrompt({
        globalInstructions: isTasks ? this.deps.getSettings?.().tasksGlobalInstructions : null,
        project: project
          ? { name: project.name, instructions: project.instructions, links: project.links, memoryEnabled: project.memoryEnabled }
          : null,
        memory,
        learningEnabled: isTasks ? this.deps.getSettings?.().learningEnabled : undefined,
        learningSupported: isTasks,
        learnedUser: learned?.usuario,
        learnedProject: learned?.proyecto,
        folders: folderSet ? [...folderSet.linked, ...folderSet.trusted].map((f) => ({ path: f.path, mode: f.mode })) : [],
        unattended: true,
        lang: getLang()
      })
      // El modelo guardado en la rutina se reevalúa al ejecutar: si su proveedor ya no está (cuenta desconectada o cambiada), se usa
      // el de la IA conectada. Si no se puede consultar al motor, se intenta con el guardado.
      const provs = await (async () => {
        try {
          return (await client.config.providers({ directory: ocDirectory })).data ?? null
        } catch {
          return null
        }
      })()
      const model = pickRoutineModel(
        { providerID: r.model.providerID, modelID: r.model.modelID },
        provs ? { providers: provs.providers as never, default: provs.default } : null
      )
      if (!model) throw new Error(t('merr.routine.noAi'))
      const res = await client.session.promptAsync({
        sessionID,
        directory: ocDirectory,
        agent,
        model,
        system,
        parts: [{ type: 'text', text: this.promptFor(r, fileCtx, dirForSession) }]
      })
      if (res.error) throw new Error(errMsg(res.error))
      const final = await this.waitForCompletion(client, ocDirectory, sessionID, sentAt, signal, () => !!record.error)
      if (record.error) throw new Error(record.error)
      if (!final) throw new Error(t('merr.routine.noReply'))
      if (final.info.error) throw new Error(errMsg(final.info.error))
      const rawText = extractText(final.parts)
      // Requisito de seguridad (no un detalle visual): el resumen nunca lleva los bloques crudos de
      // propuesta, en NINGÚN modo, los proponga o no la memoria aprendida — `record.summary` llega a
      // notificaciones nativas, al historial (Markdown) y al evento `routines:run`, que SÍ alcanza al celular.
      const text = stripSkillProposalBlock(stripMemoryProposalBlock(rawText))
      if (isTasks && this.deps.getSettings?.().learningEnabled !== false) {
        enqueueFromRoutine({
          text: rawText,
          routineId: r.id,
          routineName: r.name,
          runId: record.id,
          folder: dirForSession,
          sessionId: sessionID,
          messageId: final.info.id
        })
      }
      return truncate(text || t('merr.routine.noText'), SUMMARY_MAX)
    } finally {
      clearInterval(poll)
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      offBlocked?.()
      for (const h of hostsToRelease) this.releaseHost(dirForSession, h)
      record.waiting = false
    }
  }

  /** Prompt de la ejecución: el de la rutina, y en disparos por archivo con las variables y el aviso de «datos». */
  private promptFor(r: ScheduledRoutine, fileCtx: { files: string[]; watchFolder: string } | null, base: string): string {
    if (r.schedule.kind !== 'file') return r.prompt
    const abs = (fileCtx?.files ?? []).map((n) => join(fileCtx!.watchFolder, n))
    return buildFilePrompt(r.prompt, fileCtx?.watchFolder ?? r.schedule.folder, abs, r.mode === 'chat' ? null : base)
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
    const foreign = this.deps.tasks.network.hasOnce(folder, host)
    if (!foreign) this.deps.tasks.networkAllowOnce(folder, host)
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
    if (cur.owned) this.deps.tasks.network.revokeOnce(folder, host)
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
              t('merr.notif.routineNeedsApproval', { name: run.routineName }),
              patterns[0] ? `${p.permission}: ${truncate(patterns[0], 140)}` : p.permission,
              { mode: 'tasks', id: run.root, directory: run.folder, fullAccess: run.fullAccess }
            )
          }
        } else {
          const res = await client.permission.reply({
            requestID: p.id,
            directory,
            reply: 'reject',
            message: t('merr.routine.unattendedReject')
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
    if (this.deps.notificationsEnabled && !this.deps.notificationsEnabled()) return
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
      extras.push(`${t('merr.notif.routineRejected', { count: rejected.length })}: ${describeEntries(rejected)}.`)
    }
    if ((record.blockedHosts?.length ?? 0) > 0) {
      extras.push(
        t('merr.notif.routineBlockedHosts', {
          hosts: `${record.blockedHosts!.slice(0, 4).join(', ')}${record.blockedHosts!.length > 4 ? '…' : ''}`
        })
      )
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
    this.notifyPlain(
      ok ? t('merr.notif.routineDone', { name: record.routineName }) : t('merr.notif.routineError', { name: record.routineName }),
      body,
      target
    )
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
