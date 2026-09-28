/**
 * Contrato IPC tipado de Cowork + Rutinas (tareas programadas).
 *
 * Expuesto en el renderer como `window.api.cowork` (ver src/preload/cowork-api.ts).
 * Todas las respuestas vienen envueltas en `IpcResult<T>` (nunca lanzan por el puente).
 */
import type { IpcResult } from './ipc'
import type { ModelRef } from './types'

// ───────────────────────────── Cowork ─────────────────────────────

/** Carpeta autorizada por el usuario para Cowork. */
export interface CoworkFolder {
  path: string
  name: string
  approvedAt: number
  lastUsedAt?: number
}

export type CoworkServerState = 'starting' | 'ready' | 'stopped' | 'error'

/** Estado del `opencode serve` dedicado (y sandboxeado) de una carpeta. */
export interface CoworkServerInfo {
  folder: string
  state: CoworkServerState
  sandboxed: boolean
  error?: string
  version?: string
}

/** Datos para que el renderer cree un cliente SDK contra el servidor de la carpeta. */
export interface CoworkConnection {
  folder: string
  baseUrl: string
  /** Valor completo del header Authorization (Basic …). */
  authorization: string
  sandboxed: boolean
  version?: string
}

/** Archivo de la carpeta creado/modificado durante una tarea. */
export interface CoworkDeliverable {
  path: string
  relPath: string
  size: number
  mtime: number
}

// ───────────────────────────── Rutinas ─────────────────────────────

export type RoutineMode = 'chat' | 'cowork' | 'code'

/** Programación: presets simples o cron de 5 campos. `time` = "HH:MM" (24h, hora local). */
export type RoutineSchedule =
  | { kind: 'daily'; time: string }
  /** day: 0 = domingo … 6 = sábado. */
  | { kind: 'weekly'; day: number; time: string }
  | { kind: 'interval'; hours: number }
  | { kind: 'cron'; expr: string }

export type RoutineTrigger = 'schedule' | 'manual' | 'catchup'
export type RoutineRunStatus = 'running' | 'success' | 'error'

export interface RoutineRunRecord {
  id: string
  routineId: string
  routineName: string
  trigger: RoutineTrigger
  status: RoutineRunStatus
  startedAt: number
  finishedAt?: number
  sessionId?: string
  /** Directorio de la sesión OpenCode (para abrirla desde Chat/Code/Cowork). */
  directory?: string
  /** Resumen (texto final del asistente, truncado). */
  summary?: string
  error?: string
}

export interface ScheduledRoutine {
  id: string
  name: string
  prompt: string
  mode: RoutineMode
  /** Obligatorio para `cowork` y `code`. */
  folder?: string | null
  model: ModelRef
  schedule: RoutineSchedule
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRun?: number
  lastResult?: RoutineRunRecord
  /** Calculado por main (no persistido). */
  nextRun?: number | null
  /** Calculado por main: true si hay una ejecución en curso. */
  running?: boolean
}

/** Datos editables al crear/actualizar (sin `id` = crear). */
export interface RoutineInput {
  id?: string
  name: string
  prompt: string
  mode: RoutineMode
  folder?: string | null
  model: ModelRef
  schedule: RoutineSchedule
  enabled: boolean
}

export interface SchedulePreview {
  valid: boolean
  error?: string
  /** Cron equivalente (para presets diario/semanal) o null para intervalos. */
  cron: string | null
  /** Próximas ejecuciones (epoch ms). */
  next: number[]
  /** Descripción legible en español. */
  label: string
}

// ───────────────────────────── Contrato ─────────────────────────────

export interface CoworkInvokeContract {
  'cowork:pickFolder': { req: void; res: string | null }
  'cowork:listFolders': { req: void; res: CoworkFolder[] }
  /** Autoriza una carpeta (tras confirmar en la UI). Rechaza carpetas peligrosas (/, ~, /System…). */
  'cowork:approveFolder': { req: { folder: string }; res: CoworkFolder }
  'cowork:removeFolder': { req: { folder: string }; res: void }
  /** Arranca (o reutiliza) el servidor sandboxeado de una carpeta autorizada. */
  'cowork:start': { req: { folder: string }; res: CoworkConnection }
  'cowork:stop': { req: { folder: string }; res: void }
  'cowork:servers': { req: void; res: CoworkServerInfo[] }
  /** Archivos modificados en la carpeta desde `since` (epoch ms). */
  'cowork:deliverables': { req: { folder: string; since: number }; res: CoworkDeliverable[] }
  /** Muestra el archivo/carpeta en Finder. */
  'cowork:reveal': { req: { path: string }; res: void }
  /** Abre el archivo con la app por defecto. */
  'cowork:openPath': { req: { path: string }; res: void }

  'routines:list': { req: void; res: ScheduledRoutine[] }
  'routines:save': { req: RoutineInput; res: ScheduledRoutine }
  'routines:delete': { req: { id: string }; res: void }
  'routines:toggle': { req: { id: string; enabled: boolean }; res: ScheduledRoutine }
  /** "Ejecutar ahora": responde en cuanto la ejecución arranca. */
  'routines:runNow': { req: { id: string }; res: RoutineRunRecord }
  'routines:history': { req: { id?: string; limit?: number }; res: RoutineRunRecord[] }
  'routines:preview': { req: { schedule: RoutineSchedule }; res: SchedulePreview }
}

export interface CoworkEventContract {
  'cowork:server': CoworkServerInfo
  'routines:changed': ScheduledRoutine[]
  'routines:run': RoutineRunRecord
}

export type CoworkInvokeChannel = keyof CoworkInvokeContract
export type CoworkEventChannel = keyof CoworkEventContract
export type CoworkRequest<C extends CoworkInvokeChannel> = CoworkInvokeContract[C]['req']
export type CoworkResponse<C extends CoworkInvokeChannel> = CoworkInvokeContract[C]['res']

export const COWORK_INVOKE_CHANNELS = [
  'cowork:pickFolder',
  'cowork:listFolders',
  'cowork:approveFolder',
  'cowork:removeFolder',
  'cowork:start',
  'cowork:stop',
  'cowork:servers',
  'cowork:deliverables',
  'cowork:reveal',
  'cowork:openPath',
  'routines:list',
  'routines:save',
  'routines:delete',
  'routines:toggle',
  'routines:runNow',
  'routines:history',
  'routines:preview'
] as const satisfies readonly CoworkInvokeChannel[]

export const COWORK_EVENT_CHANNELS = ['cowork:server', 'routines:changed', 'routines:run'] as const satisfies readonly CoworkEventChannel[]

type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
const _inv: Missing<CoworkInvokeChannel, (typeof COWORK_INVOKE_CHANNELS)[number]> extends never ? true : never = true
const _evt: Missing<CoworkEventChannel, (typeof COWORK_EVENT_CHANNELS)[number]> extends never ? true : never = true
void _inv
void _evt

/** API expuesta en `window.api.cowork`. */
export interface CoworkApi {
  invoke<C extends CoworkInvokeChannel>(
    channel: C,
    ...args: CoworkRequest<C> extends void ? [] : [req: CoworkRequest<C>]
  ): Promise<IpcResult<CoworkResponse<C>>>
  on<C extends CoworkEventChannel>(channel: C, listener: (payload: CoworkEventContract[C]) => void): () => void
}

export const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
