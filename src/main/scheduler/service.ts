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
 * - Ejecución desatendida: los permisos `ask` y preguntas se rechazan automáticamente.
 * - Notificación nativa al terminar.
 */
import { app, Notification, powerMonitor } from 'electron'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  createOpencodeClient,
  type AssistantMessage,
  type Message,
  type OpencodeClient,
  type Part
} from '@opencode-ai/sdk/v2/client'
import type {
  RoutineInput,
  RoutineMode,
  RoutineRunRecord,
  RoutineTrigger,
  ScheduledRoutine
} from '@shared/ipc-cowork'
import type { CoworkManager } from '../cowork/manager'
import { CHAT_AGENT_ID, COWORK_AGENT_ID } from '../cowork/opencode-config'
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

export interface SchedulerDeps {
  /** Conexión al sidecar principal (p.ej. `() => server.start()`). */
  getMainConnection: () => Promise<{ baseUrl: string; authorization: string }>
  /** Directorio del modo Chat (userData/chat-workspace). */
  chatDirectory: string
  cowork: CoworkManager
  /** Agente para rutinas en modo code (por defecto `build`). */
  codeAgent?: string
}

interface Persisted {
  routines: ScheduledRoutine[]
  history: RoutineRunRecord[]
}

interface SchedulerEvents {
  changed: [ScheduledRoutine[]]
  run: [RoutineRunRecord]
}

const AGENT_BY_MODE: Record<RoutineMode, string> = {
  chat: CHAT_AGENT_ID,
  cowork: COWORK_AGENT_ID,
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

export class SchedulerService extends EventEmitter<SchedulerEvents> {
  private data: Persisted | null = null
  private timer: NodeJS.Timeout | null = null
  private running = new Map<string, AbortController>()
  private readonly bootAt = Date.now()
  private firstTick = true
  private offResume: (() => void) | null = null

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
    const name = input.name?.trim()
    const prompt = input.prompt?.trim()
    if (!name) throw new Error('La rutina necesita un nombre')
    if (!prompt) throw new Error('La rutina necesita una instrucción (prompt)')
    if (!['chat', 'cowork', 'code'].includes(input.mode)) throw new Error('Modo inválido')
    if (!input.model?.providerID || !input.model?.modelID) throw new Error('Selecciona un modelo')
    validateSchedule(input.schedule)
    const folder = input.folder?.trim() || null
    if (input.mode !== 'chat') {
      if (!folder) throw new Error('Los modos Cowork y Code requieren una carpeta')
      if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`La carpeta no existe: ${folder}`)
      if (input.mode === 'cowork' && !this.deps.cowork.isApproved(folder)) {
        throw new Error('La carpeta no está autorizada para Cowork (autorízala primero desde Cowork).')
      }
    }

    const data = this.load()
    const now = Date.now()
    let routine: ScheduledRoutine
    const idx = input.id ? data.routines.findIndex((r) => r.id === input.id) : -1
    if (idx >= 0) {
      const prev = data.routines[idx]
      routine = {
        ...prev,
        name,
        prompt,
        mode: input.mode,
        folder: input.mode === 'chat' ? null : folder,
        model: input.model,
        schedule: input.schedule,
        enabled: input.enabled,
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
    const directory = r.mode === 'chat' ? this.deps.chatDirectory : r.folder
    if (!directory) throw new Error('La rutina no tiene carpeta')
    if (r.mode !== 'chat' && !existsSync(directory)) throw new Error(`La carpeta no existe: ${directory}`)

    let conn: { baseUrl: string; authorization: string }
    let dirForSession = directory
    if (r.mode === 'cowork') {
      const cw = await this.deps.cowork.start(directory)
      conn = cw
      dirForSession = cw.folder // ruta real (normalizada) de la carpeta
    } else {
      conn = await this.deps.getMainConnection()
    }
    const client: OpencodeClient = createOpencodeClient({
      baseUrl: conn.baseUrl,
      headers: { Authorization: conn.authorization }
    })
    const agent = r.mode === 'code' ? (this.deps.codeAgent ?? AGENT_BY_MODE.code) : AGENT_BY_MODE[r.mode]

    const created = await client.session.create({
      directory: dirForSession,
      title: `⏰ ${r.name}`,
      agent
    })
    if (created.error || !created.data) throw new Error(`No se pudo crear la sesión: ${errMsg(created.error)}`)
    const sessionID = created.data.id
    record.sessionId = sessionID
    record.directory = dirForSession
    this.emit('run', { ...record })

    // Rechaza automáticamente permisos/preguntas de esta sesión (nadie está mirando).
    const poll = setInterval(() => void this.rejectPending(client, dirForSession, sessionID), PERMISSION_POLL_MS)
    const onAbort = (): void => {
      void client.session.abort({ sessionID, directory: dirForSession })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => {
      record.error = `Tiempo máximo excedido (${RUN_TIMEOUT_MS / 60_000} min)`
      onAbort()
    }, RUN_TIMEOUT_MS)

    try {
      const sentAt = Date.now()
      const res = await client.session.promptAsync({
        sessionID,
        directory: dirForSession,
        agent,
        model: { providerID: r.model.providerID, modelID: r.model.modelID },
        system:
          'Esta es una ejecución PROGRAMADA y desatendida: nadie puede responder preguntas ni aprobar permisos. ' +
          'Completa la tarea con supuestos razonables y termina con un resumen breve del resultado.',
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
    }
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
        (m): m is { info: AssistantMessage; parts: Part[] } =>
          isAssistant(m.info) && m.info.parentID === user.info.id
      )
      return replies.at(-1) ?? null
    } catch {
      return null
    }
  }

  private async rejectPending(client: OpencodeClient, directory: string, sessionID: string): Promise<void> {
    try {
      const perms = await client.permission.list({ directory })
      for (const p of perms.data ?? []) {
        if (p.sessionID !== sessionID) continue
        await client.permission.reply({
          requestID: p.id,
          directory,
          reply: 'reject',
          message: 'Ejecución programada desatendida: no se pueden aprobar permisos. Continúa sin esta acción.'
        })
      }
      const qs = await client.question.list({ directory })
      for (const q of qs.data ?? []) {
        if (q.sessionID === sessionID) await client.question.reject({ requestID: q.id, directory })
      }
    } catch {
      // el servidor puede estar ocupado; se reintenta en el próximo poll
    }
  }

  private notify(record: RoutineRunRecord): void {
    if (!Notification.isSupported()) return
    const ok = record.status === 'success'
    const n = new Notification({
      title: ok ? `Rutina completada: ${record.routineName}` : `Rutina con error: ${record.routineName}`,
      body: truncate((ok ? record.summary : record.error) ?? '', 180),
      silent: false
    })
    n.show()
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
