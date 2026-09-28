/**
 * Contrato IPC tipado de Cowork + Rutinas (tareas programadas).
 *
 * Expuesto en el renderer como `window.api.cowork` (ver src/preload/cowork-api.ts).
 * Todas las respuestas vienen envueltas en `IpcResult<T>` (nunca lanzan por el puente).
 */
import type { IpcResult } from './ipc'
import type { ModelRef } from './types'

// ───────────────────────────── Cowork ─────────────────────────────

/** Prefijo del error de `cowork:start {fullAccess:true}` sin `cowork:grantFullAccess` previo. */
export const FULL_ACCESS_NOT_GRANTED = 'FULL_ACCESS_NOT_GRANTED'

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

// ───────────────────────────── Computer use: concesión por app ─────────────────────────────

/** Nivel concedido a una app. */
export type AppTier = 'view' | 'click' | 'full'

export interface AppGrant {
  bundleId: string
  name: string
  tier: AppTier
  grantedAt: number
}

export interface GrantsSnapshot {
  grants: AppGrant[]
  denied: string[]
}

/** Decisión del usuario sobre una app pedida por `request_access`. */
export type AccessDecision = AppTier | 'deny'

export interface AccessRequestApp {
  bundleId: string
  name: string
}

/** Tarjeta "¿Permitir que el agente use X?" pendiente de respuesta del usuario. */
export interface AccessRequest {
  id: string
  apps: AccessRequestApp[]
  reason?: string
  /**
   * Plan de pasos (flujo Plan → Aprobar → Ejecutar): presente cuando `request_access` se llama AL
   * PRINCIPIO de una tarea con la lista completa de apps que el agente espera usar. Ausente cuando
   * es una petición de acceso a una app extra descubierta a mitad de tarea (el plan ya está
   * aprobado, solo hace falta el permiso nuevo).
   */
  plan?: string[]
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

/**
 * Estado del kill-switch del control del Mac. La fuente de verdad vive en memoria del proceso
 * principal (el MCP la consulta por el canal lateral autenticado antes de cada acción).
 */
export interface ComputerKillState {
  /** true = parado: toda acción del MCP se rechaza hasta `computer:resume` (acción explícita del usuario). */
  stopped: boolean
  stoppedAt: number | null
  /** false si el atajo global ⌘⇧Esc no se pudo registrar (otra app lo usa). */
  shortcutRegistered: boolean
  shortcut: string
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
  /** Sesión pausada: esperando que el usuario responda una tarjeta `request_access` (sin límite de tiempo). */
  | { type: 'waiting'; request: AccessRequest }
  /** Se resolvió (o se canceló) la tarjeta pendiente: la píldora vuelve al estado normal. */
  | { type: 'waitingCleared' }

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

// ───────────────────────────── Proyecto (por carpeta) y memoria ─────────────────────────────

/** "Proyecto" de Cowork: nombre + instrucciones propias de la carpeta. */
export interface CoworkProject {
  folder: string
  name: string
  instructions: string
  createdAt: number
  updatedAt: number
}

/** Contenido de `.lapis/memoria.md` dentro de la carpeta (notas que el agente guarda entre tareas). */
export interface CoworkMemory {
  content: string
  exists: boolean
  updatedAt: number | null
}

// ───────────────────────────── Red de Cowork (egress) ─────────────────────────────

/** Estado de la lista blanca de red de los servidores Cowork sandboxeados. */
export interface NetworkPolicyState {
  /** Host del proveedor de modelos: siempre permitido, no editable. */
  providerHost: string
  npmEnabled: boolean
  pypiEnabled: boolean
  /** Hosts añadidos por el usuario ("Permitir siempre" o desde Ajustes). */
  custom: string[]
  /** Hosts marcados "Mantener bloqueado" (informativo). */
  blocked: string[]
}

/** Intento de red bloqueado por el proxy de egress de un servidor sandboxeado. */
export interface NetworkBlockedEvent {
  folder: string
  host: string
  port: number
  at: number
  kind: 'connect' | 'http'
}

// ───────────────────────────── Mantener el Mac despierto ─────────────────────────────

export interface KeepAwakeState {
  /** Ajuste del usuario (persistido). */
  enabled: boolean
  /** true si el bloqueo de suspensión está activo ahora mismo. */
  active: boolean
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
  /** Id de la tarea de Cowork/Code desde la que se creó ("Programar esta tarea"), si aplica. */
  originSessionId?: string | null
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
  originSessionId?: string | null
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
  /** Registra en main el consentimiento de acceso total (requerido por `cowork:start {fullAccess}`). */
  'cowork:grantFullAccess': { req: { folder: string }; res: void }
  /** Retira el consentimiento de acceso total y detiene ese servidor. */
  'cowork:revokeFullAccess': { req: { folder: string }; res: void }
  /** Detiene el/los servidor(es) de la carpeta (ambos modos si `fullAccess` se omite). */
  'cowork:stop': { req: { folder: string; fullAccess?: boolean }; res: void }
  'cowork:servers': { req: void; res: CoworkServerInfo[] }
  /** Archivos modificados en la carpeta desde `since` (epoch ms). */
  'cowork:deliverables': { req: { folder: string; since: number }; res: CoworkDeliverable[] }
  /** Muestra el archivo/carpeta en Finder. */
  'cowork:reveal': { req: { path: string }; res: void }
  /**
   * Abre el archivo con la app por defecto. Rechaza ejecutables/lanzadores (.app, .command,
   * .sh, .pkg… o con bit de ejecución): para esos solo `cowork:reveal`.
   */
  'cowork:openPath': { req: { path: string }; res: void }
  /**
   * Abre un diálogo nativo para elegir archivos y los COPIA a la carpeta autorizada
   * (sin sobrescribir: añade " (2)"…). Devuelve los archivos copiados ([] si se cancela).
   */
  'cowork:importFiles': { req: { folder: string }; res: CoworkDeliverable[] }
  /** Lee un archivo de una carpeta autorizada para previsualizarlo (texto recortado / imagen). */
  'cowork:previewFile': { req: { path: string; maxBytes?: number }; res: CoworkFilePreview }

  /** Proyecto (nombre + instrucciones) de una carpeta autorizada. */
  'cowork:project:get': { req: { folder: string }; res: CoworkProject }
  'cowork:project:save': { req: { folder: string; name?: string; instructions?: string }; res: CoworkProject }
  /** Memoria del proyecto: `.lapis/memoria.md` dentro de la carpeta. */
  'cowork:memory:get': { req: { folder: string }; res: CoworkMemory }
  'cowork:memory:save': { req: { folder: string; content: string }; res: CoworkMemory }
  'cowork:memory:delete': { req: { folder: string }; res: CoworkMemory }

  /** Lista blanca de red efectiva para los servidores Cowork sandboxeados (egress proxy). */
  'cowork:network:state': { req: void; res: NetworkPolicyState }
  /** Interruptores "PyPI"/"npm" (registros de paquetes) de la lista blanca por defecto. */
  'cowork:network:setToggle': { req: { key: 'npmEnabled' | 'pypiEnabled'; value: boolean }; res: NetworkPolicyState }
  /** "Permitir siempre" / "Mantener bloqueado" / quitar decisión para un host (persistido). */
  'cowork:network:setHost': { req: { host: string; decision: 'allow' | 'block' | 'unset' }; res: NetworkPolicyState }
  /** "Permitir esta vez" tras una tarjeta de bloqueo: solo para los servidores ya arrancados de esa carpeta. */
  'cowork:network:allowOnce': { req: { folder: string; host: string }; res: void }

  /** "Permitir borrar" concedido para esta tarea (Seatbelt: `file-write-unlink` en la carpeta). */
  'cowork:deleteGrant:get': { req: { folder: string }; res: boolean }
  /** Concede/retira "Permitir borrar" (reinicia el servidor sandboxeado si estaba en marcha). */
  'cowork:deleteGrant:set': { req: { folder: string; allowed: boolean }; res: boolean }

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
  /**
   * Kill-switch (lo ejecuta el proceso principal, desde cualquier vista): marca el estado parado,
   * aborta toda sesión en curso de los servidores de acceso total, mata los `cu-helper` en vuelo y
   * avisa al renderer y al overlay.
   */
  'computer:stop': { req: void; res: void }
  /** "Reanudar control": acción explícita del usuario; quita la parada. */
  'computer:resume': { req: void; res: void }
  /** Estado actual del kill-switch (y del atajo global). */
  'computer:state': { req: void; res: ComputerKillState }
  /**
   * Sesión de control activa (p.ej. al empezar una tarea de acceso completo): muestra el overlay
   * y la píldora "La IA está controlando tu Mac" y no los oculta por inactividad hasta `active: false`.
   * `label` = texto opcional para la píldora.
   */
  'computer:session': { req: { active: boolean; label?: string }; res: void }
  /** Lista de apps concedidas (con nivel) y denegadas, para la pantalla de permisos. */
  'computer:grants': { req: void; res: GrantsSnapshot }
  /** Concede (o cambia el nivel de) una app manualmente desde Ajustes. */
  'computer:setGrant': { req: { bundleId: string; name: string; tier: AppTier }; res: GrantsSnapshot }
  /** Quita la concesión de una app (vuelve a "sin decidir": se pedirá de nuevo). */
  'computer:revokeGrant': { req: { bundleId: string }; res: GrantsSnapshot }
  /** Añade una app a la lista de denegadas (nunca se le pedirá acceso; toda acción se rechaza). */
  'computer:denyApp': { req: { bundleId: string; name: string }; res: GrantsSnapshot }
  /** Quita una app de la lista de denegadas. */
  'computer:undenyApp': { req: { bundleId: string }; res: GrantsSnapshot }
  /**
   * Respuesta del usuario a una tarjeta `computer:accessRequest` pendiente (herramienta
   * `request_access`). `feedback` = el usuario pidió cambios ("Editar") en vez de aprobar: no se
   * concede nada (aunque `decisions` traiga algo, se ignora) y el texto vuelve al agente en el
   * resultado de la herramienta para que replantee el plan.
   */
  'computer:respondAccess': {
    req: {
      id: string
      decisions: Array<{ bundleId: string; name: string; decision: AccessDecision }>
      feedback?: string
    }
    res: void
  }

  /** Estado actual (ajuste + si el bloqueo está activo). */
  'cowork:keepAwakeState': { req: void; res: KeepAwakeState }
  /** Cambia el ajuste "Mantener el Mac despierto mientras corren tareas" (persistido). */
  'cowork:keepAwakeSetting': { req: { enabled: boolean }; res: KeepAwakeState }
  /**
   * El renderer avisa si hay o no tareas en curso (running/waiting) en cualquier carpeta de
   * Cowork; main activa/desactiva el `powerSaveBlocker` según el ajuste.
   */
  'cowork:keepAwakeActive': { req: { active: boolean }; res: KeepAwakeState }
}

export interface CoworkEventContract {
  'cowork:server': CoworkServerInfo
  'routines:changed': ScheduledRoutine[]
  'routines:run': RoutineRunRecord
  'computer:action': ComputerActionEvent
  /** Se detuvo el control (atajo global Cmd+Shift+Escape o computer:stop). */
  'computer:stopped': { at: number }
  /** Cambio del kill-switch (parada, reanudación o fallo al registrar el atajo global). */
  'computer:killState': ComputerKillState
  /** Solo para las ventanas del overlay de control (no se difunde al resto). */
  'computer:overlay': ComputerOverlayMessage
  /** Tarjeta "¿Permitir que el agente use X?" (herramienta MCP `request_access`). */
  'computer:accessRequest': AccessRequest
  /** El proxy de egress de un servidor sandboxeado bloqueó una conexión (host fuera de lista blanca). */
  'cowork:networkBlocked': NetworkBlockedEvent
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
  'cowork:grantFullAccess',
  'cowork:revokeFullAccess',
  'cowork:stop',
  'cowork:servers',
  'cowork:deliverables',
  'cowork:reveal',
  'cowork:openPath',
  'cowork:importFiles',
  'cowork:previewFile',
  'cowork:project:get',
  'cowork:project:save',
  'cowork:memory:get',
  'cowork:memory:save',
  'cowork:memory:delete',
  'cowork:network:state',
  'cowork:network:setToggle',
  'cowork:network:setHost',
  'cowork:network:allowOnce',
  'cowork:deleteGrant:get',
  'cowork:deleteGrant:set',
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
  'computer:state',
  'computer:session',
  'computer:grants',
  'computer:setGrant',
  'computer:revokeGrant',
  'computer:denyApp',
  'computer:undenyApp',
  'computer:respondAccess',
  'cowork:keepAwakeState',
  'cowork:keepAwakeSetting',
  'cowork:keepAwakeActive'
] as const satisfies readonly CoworkInvokeChannel[]

export const COWORK_EVENT_CHANNELS = [
  'cowork:server',
  'routines:changed',
  'routines:run',
  'computer:action',
  'computer:stopped',
  'computer:killState',
  'computer:overlay',
  'computer:accessRequest',
  'cowork:networkBlocked'
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
