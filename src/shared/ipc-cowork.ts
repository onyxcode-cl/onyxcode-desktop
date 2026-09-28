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
  /** Servidor de acceso completo (sin sandbox + control del computador). */
  fullAccess?: boolean
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
  /** true = servidor SIN sandbox con el agente `computer` y el MCP de control del Mac. */
  fullAccess: boolean
  /** Estado del control del computador (solo relevante si fullAccess). */
  computerUse: ComputerUseInfo
}

// ───────────────────────────── Computer use ─────────────────────────────

export interface ComputerUseInfo {
  /** true si el helper nativo existe y el MCP quedó configurado en el servidor. */
  available: boolean
  accessibility: boolean
  screenRecording: boolean
  /** Motivo si no está disponible o faltan permisos. */
  reason?: string
}

export interface ComputerScreen {
  width: number
  height: number
  scale: number
}

export interface ComputerStatus {
  helperOk: boolean
  accessibility: boolean
  screenRecording: boolean
  screens: ComputerScreen[]
}

/** Acción ejecutada por el agente (para el overlay de actividad). Coordenadas en puntos de pantalla. */
export interface ComputerActionEvent {
  tool: string
  x?: number
  y?: number
  text?: string
  at: number
  /**
   * `start` = se emite ANTES de mover el ratón (el overlay marca el destino mientras el cursor
   * viaja); `end` = la acción terminó (onda del clic, destello de la captura). Sin fase = legado.
   */
  phase?: 'start' | 'end'
  /** Solo en `end`: false si la acción falló. */
  ok?: boolean
  /** Origen de un arrastre (puntos de pantalla). */
  fromX?: number
  fromY?: number
  /** Captura automática tras una acción (el overlay solo destella, sin etiqueta). */
  auto?: boolean
}

/** Mensajes del proceso principal al overlay de control (`src/renderer/overlay`). */
export type ComputerOverlayMessage =
  | {
      type: 'action'
      /** Coordenadas ya en píxeles CSS del overlay (pantalla principal). */
      action: ComputerActionEvent
      /** Posición del cursor (px CSS del overlay) al empezar la acción. */
      cursor?: { x: number; y: number }
      /** Duración estimada del movimiento del cursor hasta el destino (ms; 0 = instantáneo). */
      moveMs?: number
      /** true si x/y son la posición del cursor (acciones sin coordenadas: teclear, teclas…). */
      atCursor?: boolean
    }
  | { type: 'show'; label?: string }
  | { type: 'hide' }
  | { type: 'stopped' }
  | { type: 'dim'; dim: boolean }

/** Archivo de la carpeta creado/modificado durante una tarea. */
export interface CoworkDeliverable {
  path: string
  relPath: string
  size: number
  mtime: number
}

/** Vista previa de un archivo de la carpeta (entregables). */
export interface CoworkFilePreview {
  path: string
  size: number
  /** text = contenido UTF-8 (md, csv, txt…); image = data URL; unsupported = sin vista previa. */
  kind: 'text' | 'image' | 'unsupported'
  content?: string
  dataUrl?: string
  /** true si el texto se recortó a `maxBytes`. */
  truncated?: boolean
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
  /**
   * Arranca (o reutiliza) el servidor de una carpeta autorizada. Por defecto sandboxeado;
   * `fullAccess: true` ⇒ servidor aparte SIN sandbox, con el agente `computer` y el MCP de control del Mac.
   */
  'cowork:start': { req: { folder: string; fullAccess?: boolean }; res: CoworkConnection }
  /** Detiene el/los servidor(es) de la carpeta (ambos modos si `fullAccess` se omite). */
  'cowork:stop': { req: { folder: string; fullAccess?: boolean }; res: void }
  'cowork:servers': { req: void; res: CoworkServerInfo[] }
  /** Archivos modificados en la carpeta desde `since` (epoch ms). */
  'cowork:deliverables': { req: { folder: string; since: number }; res: CoworkDeliverable[] }
  /** Muestra el archivo/carpeta en Finder. */
  'cowork:reveal': { req: { path: string }; res: void }
  /** Abre el archivo con la app por defecto. */
  'cowork:openPath': { req: { path: string }; res: void }
  /**
   * Abre un diálogo nativo para elegir archivos y los COPIA a la carpeta autorizada
   * (sin sobrescribir: añade " (2)"…). Devuelve los archivos copiados ([] si se cancela).
   */
  'cowork:importFiles': { req: { folder: string }; res: CoworkDeliverable[] }
  /** Lee un archivo de una carpeta autorizada para previsualizarlo (texto recortado / imagen). */
  'cowork:previewFile': { req: { path: string; maxBytes?: number }; res: CoworkFilePreview }

  'routines:list': { req: void; res: ScheduledRoutine[] }
  'routines:save': { req: RoutineInput; res: ScheduledRoutine }
  'routines:delete': { req: { id: string }; res: void }
  'routines:toggle': { req: { id: string; enabled: boolean }; res: ScheduledRoutine }
  /** "Ejecutar ahora": responde en cuanto la ejecución arranca. */
  'routines:runNow': { req: { id: string }; res: RoutineRunRecord }
  'routines:history': { req: { id?: string; limit?: number }; res: RoutineRunRecord[] }
  'routines:preview': { req: { schedule: RoutineSchedule }; res: SchedulePreview }

  /** Estado del helper nativo y permisos de macOS. */
  'computer:status': { req: void; res: ComputerStatus }
  /** Lanza los prompts de macOS y abre Ajustes › Privacidad (Accesibilidad / Grabación de pantalla). */
  'computer:requestPermissions': { req: void; res: void }
  /** Kill-switch: crea el archivo de parada; toda herramienta del MCP falla sin actuar. */
  'computer:stop': { req: void; res: void }
  /** Quita el archivo de parada. */
  'computer:resume': { req: void; res: void }
  /**
   * Sesión de control activa (p.ej. al empezar una tarea de acceso completo): muestra el overlay
   * y la píldora "La IA está controlando tu Mac" y no los oculta por inactividad hasta `active: false`.
   * `label` = texto opcional para la píldora.
   */
  'computer:session': { req: { active: boolean; label?: string }; res: void }
}

export interface CoworkEventContract {
  'cowork:server': CoworkServerInfo
  'routines:changed': ScheduledRoutine[]
  'routines:run': RoutineRunRecord
  'computer:action': ComputerActionEvent
  /** Se detuvo el control (atajo global Cmd+Shift+Escape o computer:stop). */
  'computer:stopped': { at: number }
  /** Solo para las ventanas del overlay de control (no se difunde al resto). */
  'computer:overlay': ComputerOverlayMessage
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
  'cowork:importFiles',
  'cowork:previewFile',
  'routines:list',
  'routines:save',
  'routines:delete',
  'routines:toggle',
  'routines:runNow',
  'routines:history',
  'routines:preview',
  'computer:status',
  'computer:requestPermissions',
  'computer:stop',
  'computer:resume',
  'computer:session'
] as const satisfies readonly CoworkInvokeChannel[]

export const COWORK_EVENT_CHANNELS = [
  'cowork:server',
  'routines:changed',
  'routines:run',
  'computer:action',
  'computer:stopped',
  'computer:overlay'
] as const satisfies readonly CoworkEventChannel[]

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
