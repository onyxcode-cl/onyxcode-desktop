/**
 * Contrato IPC tipado de Tareas + Rutinas (tareas programadas).
 *
 * Expuesto en el renderer como `window.api.tasks` (ver src/preload/tasks-api.ts).
 * Todas las respuestas vienen envueltas en `IpcResult<T>` (nunca lanzan por el puente).
 */
import type { IpcResult } from './ipc'
import type { ModelRef } from './types'

// ───────────────────────────── Tareas ─────────────────────────────

/** Prefijo del error de `tasks:start {fullAccess:true}` sin `tasks:grantFullAccess` previo. */
export const FULL_ACCESS_NOT_GRANTED = 'FULL_ACCESS_NOT_GRANTED'

/** Carpeta autorizada por el usuario para Tareas. */
export interface TasksFolder {
  path: string
  name: string
  approvedAt: number
  lastUsedAt?: number
  /** Main lo rellena en `listFolders`: la carpeta tiene concedido el Control total del Mac. */
  fullAccess?: boolean
}

export type TasksServerState = 'starting' | 'ready' | 'stopped' | 'error'

/** Estado del `opencode serve` dedicado (y sandboxeado) de una carpeta. */
export interface TasksServerInfo {
  folder: string
  state: TasksServerState
  sandboxed: boolean
  /** Servidor de acceso completo (sin sandbox + control del computador). */
  fullAccess?: boolean
  error?: string
  version?: string
}

/** Datos para que el renderer cree un cliente SDK contra el servidor de la carpeta. */
export interface TasksConnection {
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

/** Orden de los niveles (mayor = más poder). */
export const APP_TIER_RANK: Record<AppTier, number> = { view: 0, click: 1, full: 2 }

/** Máximo de dos niveles (`null`/`undefined` = sin concesión). Devuelve `null` si ninguno tiene nivel. */
export function maxTier(a: AppTier | null | undefined, b: AppTier | null | undefined): AppTier | null {
  if (!a) return b ?? null
  if (!b) return a
  return APP_TIER_RANK[a] >= APP_TIER_RANK[b] ? a : b
}

/** Etiqueta en español de cada nivel. */
export const TIER_LABEL_ES: Record<AppTier, string> = { view: 'Solo ver', click: 'Ver y clic', full: 'Control total' }

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
  /** Nivel que DECLARA el agente (`levels` de `request_access`). Ausente = legado → 'click'. */
  requested?: AppTier
  /** Nivel ya concedido antes de esta tarjeta (`null` = ninguno). Lo rellena main. */
  current?: AppTier | null
  /** La app está en la lista de denegadas. Lo rellena main. */
  denied?: boolean
}

/**
 * Preselección de la tarjeta para una app: el nivel que pide el agente (por defecto 'click') y
 * nunca por debajo de lo ya concedido. Si la app estaba denegada, se preselecciona lo pedido.
 */
export function defaultAccessDecision(app: AccessRequestApp): AccessDecision {
  const requested = app.requested ?? 'click'
  if (app.denied) return requested
  return maxTier(app.current, requested) ?? 'click'
}

/** Tarjeta "¿Permitir que el agente use X?" pendiente de respuesta del usuario. */
export interface AccessRequest {
  id: string
  /** Puede ser `[]` SOLO si hay `plan` (plan sin apps: terminal, archivos o web). */
  apps: AccessRequestApp[]
  reason?: string
  /**
   * Plan de pasos (flujo Plan → Aprobar → Ejecutar): presente cuando `request_access` se llama AL
   * PRINCIPIO de una tarea con la lista completa de apps que el agente espera usar. Ausente cuando
   * es una petición de acceso a una app extra descubierta a mitad de tarea (el plan ya está
   * aprobado, solo hace falta el permiso nuevo).
   */
  plan?: string[]
  /** Sesión (tarea) de OpenCode que pidió la tarjeta (la inyecta el plugin `onyxcode-plan-gate`). */
  sessionId?: string
  /** Nombres de app que el agente pidió y no se encontraron instaladas. */
  unresolved?: string[]
  /**
   * Lote C: `'takeover'` = el agente trabajaba en segundo plano y pide tomar el ratón y el
   * teclado (`request_full_control`); `apps` trae solo la app implicada. Ausente/`'access'` =
   * tarjeta normal de `request_access`.
   */
  kind?: 'access' | 'takeover'
}

/** Estado de la aprobación del plan de una sesión (tarea) de Control total. */
export interface PlanApprovalState {
  sessionId: string
  approved: boolean
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
export interface TasksDeliverable {
  path: string
  relPath: string
  size: number
  mtime: number
  /** Carpeta vinculada de la que procede (ausente = carpeta principal de la tarea). */
  root?: string
}

/** Vista previa de un archivo de la carpeta (entregables). */
export interface TasksFilePreview {
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

/** "Proyecto" de Tareas: nombre + instrucciones propias de la carpeta. */
export interface TasksProject {
  folder: string
  name: string
  instructions: string
  createdAt: number
  updatedAt: number
  /** Enlaces de referencia del proyecto (http/https, máx. 50). */
  links?: string[]
  /** false = el agente no lee ni escribe la memoria del proyecto (por defecto activada). */
  memoryEnabled?: boolean
}

/** Contenido de `.onyxcode/memoria.md` dentro de la carpeta (notas que el agente guarda entre tareas). */
export interface TasksMemory {
  content: string
  exists: boolean
  updatedAt: number | null
}

// ───────────────────────────── Red de Tareas (egress) ─────────────────────────────

/** Interruptores de la lista blanca por defecto (npm, PyPI y búsqueda web del agente). */
export type NetworkToggleKey = 'npmEnabled' | 'pypiEnabled' | 'webSearchEnabled'

/** Estado de la lista blanca de red de los servidores Tareas sandboxeados. */
export interface NetworkPolicyState {
  /** Host del proveedor de modelos: siempre permitido, no editable. */
  providerHost: string
  npmEnabled: boolean
  pypiEnabled: boolean
  /** Búsqueda web del agente (herramienta `websearch`): permite `webSearchHosts`. */
  webSearchEnabled: boolean
  /** Hosts que abre el interruptor de búsqueda web (informativo, no editable). */
  webSearchHosts: string[]
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

export type RoutineMode = 'chat' | 'tasks' | 'code'

/** Cada ejecución empieza una tarea nueva ('fresh') o continúa la misma ('continue'). */
export type RoutineSessionMode = 'fresh' | 'continue'
/** Qué hacer si una ejecución desatendida pide un permiso fuera de la lista blanca. */
export type RoutineOnAsk = 'reject' | 'wait'
/** Regla de la lista blanca de una rutina: `pattern` admite `*` y `?`. */
export interface RoutineAllowRule {
  permission: string
  pattern: string
}

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
  /** Directorio de la sesión OpenCode (para abrirla desde Chat/Code/Tareas). */
  directory?: string
  /** Resumen (texto final del asistente, truncado). */
  summary?: string
  error?: string
  /** Permisos rechazados durante la ejecución desatendida (para mostrarlos en el historial). */
  rejected?: Array<{ permission: string; patterns: string[] }>
  /** Permisos aprobados automáticamente por la lista blanca de la rutina. */
  approved?: Array<{ permission: string; patterns: string[] }>
  /** Hosts que el proxy de red bloqueó durante la ejecución. */
  blockedHosts?: string[]
  /** true = la ejecución está esperando la aprobación del usuario (`onAsk: 'wait'`). */
  waiting?: boolean
}

export interface ScheduledRoutine {
  id: string
  name: string
  prompt: string
  mode: RoutineMode
  /** Obligatorio para `tasks` y `code`. */
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
  /** Id de la tarea de Tareas/Code desde la que se creó ("Programar esta tarea"), si aplica. */
  originSessionId?: string | null
  /** Empezar de cero en cada ejecución (por defecto) o continuar la misma tarea. */
  sessionMode?: RoutineSessionMode
  /** Qué hacer si la ejecución pide un permiso que no está en la lista blanca. */
  onAsk?: RoutineOnAsk
  /** Lista blanca "Permitir sin preguntar" (permiso + patrón). */
  allow?: RoutineAllowRule[]
  /** Sitios extra permitidos solo mientras dura la ejecución. */
  allowHosts?: string[]
  /** La rutina se ejecuta en Control total del Mac (solo modo tasks). */
  fullAccess?: boolean
  /** Momento del consentimiento explícito del usuario para Control total (epoch ms). */
  fullAccessConsentAt?: number | null
  /** Sesión de la última ejecución (para `sessionMode: 'continue'`). Lo rellena main. */
  lastSessionId?: string | null
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
  sessionMode?: RoutineSessionMode
  onAsk?: RoutineOnAsk
  allow?: RoutineAllowRule[]
  allowHosts?: string[]
  fullAccess?: boolean
  fullAccessConsentAt?: number | null
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

// ───────────────────────────── Lote B: carpetas ─────────────────────────────

/** Modo de acceso a una carpeta adicional: lectura y escritura, o solo lectura. */
export type FolderAccessMode = 'rw' | 'ro'

/** Etiquetas en español de cada modo de acceso. */
export const FOLDER_MODE_LABEL_ES: Record<FolderAccessMode, string> = { rw: 'Lectura y escritura', ro: 'Solo lectura' }

/** Carpeta adicional vinculada a un espacio de Tareas (servidor de la carpeta principal). */
export interface LinkedFolder {
  path: string
  name: string
  mode: FolderAccessMode
  addedAt: number
}

/** Carpeta de confianza: disponible para todas las tareas sin volver a preguntar. */
export interface TrustedFolder {
  path: string
  name: string
  mode: FolderAccessMode
  addedAt: number
}

/** Conjunto de carpetas de un espacio de Tareas. */
export interface TasksFolderSet {
  primary: string
  /** Vinculadas a este espacio (servidor de `primary`). */
  linked: LinkedFolder[]
  /** De confianza: todas las tareas, sin preguntar. */
  trusted: TrustedFolder[]
  /** false = el servidor sandbox en marcha arrancó con otro conjunto (falta reiniciar). */
  applied: boolean
}

/** Resultado de comprobar si una carpeta se puede autorizar/vincular. */
export interface FolderCheck {
  ok: boolean
  normalized: string
  /** Motivo accionable en español cuando `ok` es false. */
  reason?: string
}

/** Contenido de `AGENTS.md` en la raíz de la carpeta. */
export interface TasksAgentsMd {
  path: string
  content: string
  exists: boolean
}

// ───────────────────────────── Lote B: tareas y actividad ─────────────────────────────

/** Metadatos de una tarea de Tareas que main persiste (fijada, grupo, título). */
export interface TasksTaskMeta {
  sessionId: string
  folder: string
  fullAccess: boolean
  title: string
  pinned?: boolean
  group?: string | null
  updatedAt: number
}

export type TasksTaskActivityState = 'running' | 'waiting' | 'question'

/** Tarea raíz en curso o pendiente de respuesta, en cualquier carpeta. */
export interface TasksTaskActivity {
  sessionId: string
  folder: string
  fullAccess: boolean
  title: string
  state: TasksTaskActivityState
  since: number
}

/** Instantánea del monitor de main: tareas activas y servidores vivos. */
export interface TasksActivitySnapshot {
  at: number
  /** Solo tareas raíz (las hijas se agregan a su raíz). */
  tasks: TasksTaskActivity[]
  servers: Array<{ folder: string; fullAccess: boolean; idleSince: number | null }>
}

// ───────────────────────────── Lote B: preferencias ─────────────────────────────

/** Qué eventos de tareas en segundo plano generan notificación. */
export interface TasksNotifyPrefs {
  done: boolean
  approval: boolean
  question: boolean
  error: boolean
}

export interface TasksPrefs {
  /** Días sin actividad para archivar tareas (0 = nunca). */
  autoArchiveDays: number
  /** Minutos sin tareas para detener un servidor (0 = nunca). */
  idleStopMinutes: number
  /** Máximo de servidores Tareas vivos a la vez. */
  maxServers: number
  notify: TasksNotifyPrefs
}

export const DEFAULT_TASKS_PREFS: TasksPrefs = {
  autoArchiveDays: 0,
  idleStopMinutes: 15,
  maxServers: 4,
  notify: { done: true, approval: true, question: true, error: true }
}

// ───────────────────────────── Lote B: almacenamiento ─────────────────────────────

// ── Puntos de restauración (copia propia de la app, válida para cualquier carpeta) ──
export interface TasksRestorePoint {
  id: string
  sessionId: string
  folder: string
  createdAt: number
  label: string
  /** Archivos incluidos en la instantánea. */
  files: number
  /** Bytes copiados (suma de tamaños de los archivos incluidos). */
  bytes: number
  status: 'ok' | 'skipped'
  /** Motivo cuando `status` es `skipped`. */
  reason?: string
}

export interface TasksRestoreChange {
  /** Ruta relativa a la carpeta. */
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
  /** No se puede mostrar la diferencia (binario o demasiado grande). */
  binary: boolean
  /** Se puede deshacer (los archivos de más de 50 MB no se guardan). */
  restorable: boolean
  /** Diff unificado (solo texto). */
  patch?: string
}

export interface TasksStorageEntry {
  /** Clave del directorio `tasks-sandbox/<key>`. */
  key: string
  /** Carpeta de Tareas asociada (null si ya no se conoce). */
  folder: string | null
  bytes: number
  cacheBytes: number
  /** true = su servidor está vivo (no se puede limpiar). */
  running: boolean
}

export interface TasksStorageReport {
  entries: TasksStorageEntry[]
  screenshotsBytes: number
  totalBytes: number
  at: number
}

// ───────────────────────────── Lote B: permisos recordados, MCP y política ─────────────────────────────

/** Permiso "siempre permitir" recordado para una carpeta. */
export interface TasksPermissionRule {
  id: string
  folder: string
  permission: string
  pattern: string
  createdAt: number
}

/** Servidor MCP del usuario y cómo se expone en Tareas. */
export interface TasksMcpInfo {
  name: string
  type: 'local' | 'remote'
  enabled: boolean
  /** Disponible en Tareas. */
  tasks: boolean
  /** Preguntar en cada uso de sus herramientas. */
  askEachTool: boolean
  /** Hosts remotos que se suman a la red de Tareas. */
  hosts: string[]
  /** Usa OAuth: no disponible en el sandbox. */
  oauth: boolean
}

/** Política gestionada por la organización (`managed.json`), solo lectura. */
export interface ManagedPolicy {
  /** Ruta del archivo del que se leyó. */
  source: string
  disableFullAccess?: boolean
  allowedFolderRoots?: string[]
  disableCustomHosts?: boolean
  extraAllowedHosts?: string[]
  disableAlwaysAllow?: boolean
  disableRoutines?: boolean
  maxAutoArchiveDays?: number
  /** Lote C: apaga el Modo auto (aprobación automática de bajo riesgo) para toda la organización. */
  disableAutoMode?: boolean
  /** Apaga el navegador integrado del agente para toda la organización (originado en el Lote C). */
  disableBrowser?: boolean
}

// ───────────────────────────── Lote C: preferencias de computer use ─────────────────────────────

/** Cómo controla el agente las apps del Mac: en segundo plano (AX, sin mover el ratón) o con el ratón y el teclado. */
export type ComputerControlMode = 'background' | 'full'

/** Preferencias persistidas de computer use (`userData/computer-prefs.json`). */
export interface ComputerPrefs {
  mode: ComputerControlMode
  /** Oculta las demás apps mientras el agente controla la pantalla. */
  hideOtherApps: boolean
  /** Vuelve a mostrarlas al terminar (Detener, fin de la sesión de control). */
  unhideOnFinish: boolean
}

/** Decisión del usuario (2026-09-28): por defecto "En segundo plano" y ocultar otras apps. */
export const DEFAULT_COMPUTER_PREFS: ComputerPrefs = { mode: 'background', hideOtherApps: true, unhideOnFinish: true }

// ───────────────────────────── Lote C: Teach mode y grabar una skill ─────────────────────────────

/** Paso de Teach mode: el agente señala un elemento y explica qué haría, sin hacer clic. */
export interface TeachStep {
  id: string
  sessionId?: string
  text: string
  title?: string
  step?: number
  total?: number
  /** Punto de pantalla (puntos), si el paso señala un elemento concreto. */
  x?: number
  y?: number
}

/** Estado de la grabación de una skill en curso (o inactiva). */
export interface SkillRecordingState {
  active: boolean
  id: string | null
  startedAt: number | null
  steps: number
  mic: 'off' | 'recording' | 'denied'
  maxSeconds: number
}

/** Un evento registrado por `cu-helper record` (`events.jsonl`). */
export interface RecordedStep {
  t: number
  type: 'click' | 'key' | 'text' | 'app' | 'scroll' | 'warning'
  app?: { name: string; bundleId: string }
  element?: { role?: string; subrole?: string; title?: string; description?: string }
  x?: number
  y?: number
  button?: 'left' | 'right'
  keys?: string
  text?: string
  /** Ruta de la captura asociada a este paso (relativa al directorio de la grabación). */
  shot?: string
}

/** Grabación completa de una skill (eventos + capturas + transcripción, ya leída del disco). */
export interface SkillRecording {
  id: string
  dir: string
  startedAt: number
  durationMs: number
  steps: RecordedStep[]
  shots: string[]
  mic: 'off' | 'recorded' | 'denied'
  transcript: string | null
  transcriptError?: string
}

/** Mensajes de main a la ventana `assist` (Teach mode y píldora de grabación). */
export type AssistMessage =
  { type: 'teach'; step: TeachStep } | { type: 'teachClear' } | { type: 'recording'; state: SkillRecordingState } | { type: 'hide' }

// ───────────────────────────── Lote C: Modo auto ─────────────────────────────

/** Regla del clasificador que aprobó (o hubiera aprobado) algo automáticamente. */
export type AutoRuleId = 'mcp-readonly' | 'bash-readonly' | 'computer-view'

/** Ajustes persistidos del Modo auto (`userData/tasks-auto.json`). */
export interface AutoModeSettings {
  enabled: boolean
  folders: string[]
  tasks: string[]
  viewApps: string[]
}

/** Entrada del registro de aprobaciones automáticas. */
export interface AutoApprovalRecord {
  id: string
  at: number
  folder: string | null
  sessionId: string | null
  kind: 'permission' | 'access'
  permission: string
  patterns: string[]
  rule: AutoRuleId
  summary: string
  revocable: boolean
  revokedAt?: number
}

/** Estado completo del Modo auto para Ajustes. */
export interface AutoModeState {
  settings: AutoModeSettings
  log: AutoApprovalRecord[]
  policyDisabled: boolean
}

// ───────────────────────────── Navegador integrado: sitios permitidos ─────────────────────────────

/** Sitio (eTLD+1) con "Permitir siempre" para el navegador integrado (el «navegador propio» del Lote C ya no existe). */
export interface BrowserSite {
  site: string
  addedAt: number
}

// ───────────────────────────── Contrato ─────────────────────────────

export interface TasksInvokeContract {
  'tasks:pickFolder': { req: void; res: string | null }
  'tasks:listFolders': { req: void; res: TasksFolder[] }
  /** Autoriza una carpeta (tras confirmar en la UI). Rechaza carpetas peligrosas (/, ~, /System…). */
  'tasks:approveFolder': { req: { folder: string }; res: TasksFolder }
  'tasks:removeFolder': { req: { folder: string }; res: void }
  /**
   * Arranca (o reutiliza) el servidor de una carpeta autorizada. Por defecto sandboxeado;
   * `fullAccess: true` ⇒ servidor aparte SIN sandbox, con el agente `computer` y el MCP de control del Mac.
   */
  'tasks:start': { req: { folder: string; fullAccess?: boolean }; res: TasksConnection }
  /** Registra en main el consentimiento de acceso total (requerido por `tasks:start {fullAccess}`). */
  'tasks:grantFullAccess': { req: { folder: string }; res: void }
  /** Retira el consentimiento de acceso total y detiene ese servidor. */
  'tasks:revokeFullAccess': { req: { folder: string }; res: void }
  /** Archivos modificados en la carpeta desde `since` (epoch ms). */
  'tasks:deliverables': { req: { folder: string; since: number }; res: TasksDeliverable[] }
  /** Muestra el archivo/carpeta en Finder. */
  'tasks:reveal': { req: { path: string }; res: void }
  /**
   * Abre el archivo con la app por defecto. Rechaza ejecutables/lanzadores (.app, .command,
   * .sh, .pkg… o con bit de ejecución): para esos solo `tasks:reveal`.
   */
  'tasks:openPath': { req: { path: string }; res: void }
  /**
   * Abre un diálogo nativo para elegir archivos y los COPIA a la carpeta autorizada
   * (sin sobrescribir: añade " (2)"…). Devuelve los archivos copiados ([] si se cancela).
   */
  'tasks:importFiles': { req: { folder: string }; res: TasksDeliverable[] }
  /** Lee un archivo de una carpeta autorizada para previsualizarlo (texto recortado / imagen). */
  'tasks:previewFile': { req: { path: string; maxBytes?: number }; res: TasksFilePreview }

  /** Proyecto (nombre + instrucciones) de una carpeta autorizada. */
  'tasks:project:get': { req: { folder: string }; res: TasksProject }
  'tasks:project:save': {
    req: { folder: string; name?: string; instructions?: string; links?: string[]; memoryEnabled?: boolean }
    res: TasksProject
  }
  /** Memoria del proyecto: `.onyxcode/memoria.md` dentro de la carpeta. */
  'tasks:memory:get': { req: { folder: string }; res: TasksMemory }
  'tasks:memory:save': { req: { folder: string; content: string }; res: TasksMemory }
  'tasks:memory:delete': { req: { folder: string }; res: TasksMemory }

  /** Lista blanca de red efectiva para los servidores Tareas sandboxeados (egress proxy). */
  'tasks:network:state': { req: void; res: NetworkPolicyState }
  /** Interruptores "PyPI"/"npm"/"búsqueda web" de la lista blanca por defecto. */
  'tasks:network:setToggle': { req: { key: NetworkToggleKey; value: boolean }; res: NetworkPolicyState }
  /** "Permitir siempre" / "Mantener bloqueado" / quitar decisión para un host (persistido). */
  'tasks:network:setHost': { req: { host: string; decision: 'allow' | 'block' | 'unset' }; res: NetworkPolicyState }
  /** "Permitir esta vez" tras una tarjeta de bloqueo: solo para los servidores ya arrancados de esa carpeta. */
  'tasks:network:allowOnce': { req: { folder: string; host: string }; res: void }

  /** "Permitir borrar" concedido para esta tarea (Seatbelt: `file-write-unlink` en la carpeta). */
  'tasks:deleteGrant:get': { req: { folder: string }; res: boolean }
  /** Concede/retira "Permitir borrar" (reinicia el servidor sandboxeado si estaba en marcha). */
  'tasks:deleteGrant:set': { req: { folder: string; allowed: boolean }; res: boolean }

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
   * `label` = texto opcional para la píldora. `sessionId` = sesión (tarea raíz) de OpenCode ocupada,
   * para relacionar la aprobación del plan con la tarea.
   */
  'computer:session': { req: { active: boolean; label?: string; sessionId?: string }; res: void }
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
   * `approvePlan` = aprueba el plan de la tarjeta aunque no se conceda ninguna app (plan sin apps).
   * `cancel` = Esc, ✕ o "Cancelar": no toca ninguna concesión ni aprueba nada (`decisions` puede ser `[]`).
   */
  'computer:respondAccess': {
    req: {
      id: string
      decisions: Array<{ bundleId: string; name: string; decision: AccessDecision }>
      feedback?: string
      approvePlan?: boolean
      cancel?: boolean
    }
    res: void
  }
  /**
   * Revoca la aprobación del plan de una sesión (botón "Revocar", o al archivar/borrar la tarea):
   * la siguiente acción del agente en esa tarea vuelve a pedir un plan.
   */
  'computer:revokePlan': { req: { sessionId: string }; res: void }
  /** Ids de las sesiones con el plan aprobado ahora mismo (para pintar "Plan aprobado" al cargar). */
  'computer:approvedPlans': { req: void; res: string[] }
  /**
   * "Editar en OnyxCode" desde la píldora: trae la ventana principal al frente (acción EXPLÍCITA del
   * usuario, la única que activa OnyxCode fuera de que él lo pida) para escribir el feedback de una
   * tarjeta `request_access` con más espacio que la píldora.
   */
  'computer:showMainWindow': { req: void; res: void }

  /** Estado actual (ajuste + si el bloqueo está activo). */
  'tasks:keepAwakeState': { req: void; res: KeepAwakeState }
  /** Cambia el ajuste "Mantener el Mac despierto mientras corren tareas" (persistido). */
  'tasks:keepAwakeSetting': { req: { enabled: boolean }; res: KeepAwakeState }
  /**
   * El renderer avisa si hay o no tareas en curso (running/waiting) en cualquier carpeta de
   * Tareas; main activa/desactiva el `powerSaveBlocker` según el ajuste.
   */
  'tasks:keepAwakeActive': { req: { active: boolean }; res: KeepAwakeState }

  // ── Lote B: carpetas ──
  /** Conjunto de carpetas (principal, vinculadas y de confianza) de un espacio. */
  'tasks:folders:get': { req: { folder: string }; res: TasksFolderSet }
  /** Comprueba si una carpeta se puede autorizar/vincular (con motivo accionable si no). */
  'tasks:folders:check': { req: { path: string }; res: FolderCheck }
  /** Vincula una carpeta adicional; `restart` (por defecto true) reinicia el sandbox solo si está en marcha. */
  'tasks:folders:link': {
    req: { folder: string; path: string; mode: FolderAccessMode; trust?: boolean; restart?: boolean }
    res: TasksFolderSet & { restarted: boolean }
  }
  'tasks:folders:unlink': {
    req: { folder: string; path: string; restart?: boolean }
    res: TasksFolderSet & { restarted: boolean }
  }
  'tasks:trusted:list': { req: void; res: TrustedFolder[] }
  'tasks:trusted:set': { req: { path: string; mode: FolderAccessMode }; res: TrustedFolder[] }
  'tasks:trusted:remove': { req: { path: string }; res: TrustedFolder[] }
  /** Política gestionada por la organización (null = sin política). */
  'tasks:policy': { req: void; res: ManagedPolicy | null }

  // ── Lote B: actividad, tareas, preferencias y almacenamiento ──
  /** Instantánea actual de tareas activas y servidores (también llega por el evento `tasks:activity`). */
  'tasks:activity': { req: void; res: TasksActivitySnapshot }
  /** El renderer avisa qué servidor está mirando (para no notificar lo que el usuario ya ve). */
  'tasks:viewing': { req: { folder: string | null; fullAccess?: boolean }; res: void }
  'tasks:tasks:list': { req: void; res: TasksTaskMeta[] }
  'tasks:tasks:setMeta': {
    req: { sessionId: string; folder: string; fullAccess: boolean; title?: string; pinned?: boolean; group?: string | null }
    res: TasksTaskMeta
  }
  'tasks:tasks:forget': { req: { sessionId: string }; res: void }
  'tasks:prefs:get': { req: void; res: TasksPrefs }
  'tasks:prefs:set': {
    req: { autoArchiveDays?: number; idleStopMinutes?: number; maxServers?: number; notify?: Partial<TasksNotifyPrefs> }
    res: TasksPrefs
  }
  'tasks:storage:report': { req: void; res: TasksStorageReport }
  /** Limpia la caché (`cache`) o todo el directorio, incluido el historial (`all`), de un servidor parado. */
  'tasks:storage:clean': { req: { key: string; scope: 'cache' | 'all' }; res: TasksStorageReport }
  'tasks:storage:cleanScreenshots': { req: void; res: TasksStorageReport }

  // ── Puntos de restauración ──
  'tasks:restore:create': { req: { folder: string; sessionId: string; label: string }; res: TasksRestorePoint }
  'tasks:restore:list': { req: { folder: string; sessionId: string }; res: TasksRestorePoint[] }
  'tasks:restore:changes': { req: { folder: string; pointId: string }; res: { changes: TasksRestoreChange[]; truncated: boolean } }
  'tasks:restore:apply': {
    req: { folder: string; pointId: string; paths?: string[] }
    res: { restored: number; trashed: number; undoPointId: string; failed: Array<{ path: string; reason: string }> }
  }
  /** Borra los puntos de una tarea (al eliminarla). */
  'tasks:restore:forget': { req: { sessionId: string }; res: void }

  // ── Lote B: proyecto, MCP y permisos recordados ──
  'tasks:agentsMd:get': { req: { folder: string }; res: TasksAgentsMd }
  'tasks:agentsMd:save': { req: { folder: string; content: string }; res: TasksAgentsMd }
  'tasks:mcp:list': { req: void; res: TasksMcpInfo[] }
  'tasks:mcp:set': { req: { name: string; tasks?: boolean; askEachTool?: boolean }; res: TasksMcpInfo[] }
  'tasks:rules:list': { req: { folder?: string }; res: TasksPermissionRule[] }
  'tasks:rules:add': { req: { folder: string; permission: string; patterns: string[] }; res: TasksPermissionRule[] }
  'tasks:rules:remove': { req: { id: string }; res: TasksPermissionRule[] }

  // ── Lote B: archivos ──
  /** Comprime archivos en un zip (diálogo de guardado). Devuelve la ruta o null si se cancela. */
  'tasks:zip': { req: { paths: string[]; suggestedName?: string }; res: string | null }
  /** Vista rápida de macOS (QuickLook) del archivo. */
  'tasks:quickLook': { req: { path: string }; res: void }
  /** Guarda una transcripción en Markdown (diálogo de guardado). Devuelve la ruta o null si se cancela. */
  'tasks:exportMarkdown': { req: { suggestedName: string; content: string }; res: string | null }
  /** Convierte un `.html`/`.htm` entregable a PDF (sin red) y devuelve el nuevo entregable. */
  'tasks:htmlToPdf': { req: { path: string }; res: TasksDeliverable }

  // ── Lote C: preferencias de computer use ──
  'computer:prefs:get': { req: void; res: ComputerPrefs }
  'computer:prefs:set': { req: Partial<ComputerPrefs>; res: ComputerPrefs }
  /** Respuesta de la ventana `assist` a un paso de Teach mode. */
  'computer:teachRespond': { req: { id: string; action: 'next' | 'exit' }; res: void }
  'computer:record:start': { req: { mic: boolean }; res: SkillRecordingState }
  /** Termina (o descarta) la grabación en curso. Solo la ventana `assist` puede invocarlo. */
  'computer:record:stop': { req: { discard?: boolean }; res: SkillRecording | null }
  /**
   * Copia las capturas de una grabación a la carpeta de la tarea y devuelve el prompt (en
   * español) para que el agente proponga generalizarla a una skill.
   */
  'computer:record:prepare': { req: { id: string; folder: string; includeTyped: boolean }; res: { prompt: string; relDir: string } }

  // ── Lote C: Modo auto (los handlers los registra C3) ──
  'tasks:auto:state': { req: void; res: AutoModeState }
  'tasks:auto:set': {
    req: {
      enabled?: boolean
      folder?: { path: string; on: boolean }
      task?: { sessionId: string; on: boolean }
      viewApps?: string[]
    }
    res: AutoModeState
  }
  'tasks:auto:revoke': { req: { id: string }; res: AutoModeState }
  'tasks:auto:clearLog': { req: void; res: AutoModeState }
  /** El renderer pide considerar una petición de acceso a apps a mitad de tarea (vía rápida). */
  'tasks:auto:consider': { req: { folder: string; fullAccess: boolean; requestId: string }; res: { auto: boolean } }
}

export interface TasksEventContract {
  'tasks:server': TasksServerInfo
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
  /** La tarjeta `request_access` con ese id ya se resolvió (en cualquier vista): las demás deben cerrarla. */
  'computer:accessResolved': { id: string }
  /** Cambió la aprobación del plan de una sesión (aprobado o revocado). */
  'computer:planState': PlanApprovalState
  /** El proxy de egress de un servidor sandboxeado bloqueó una conexión (host fuera de lista blanca). */
  'tasks:networkBlocked': NetworkBlockedEvent
  /** Lote B: instantánea de actividad (tareas activas y servidores) del monitor de main. */
  'tasks:activity': TasksActivitySnapshot

  // ── Lote C ──
  /** Solo para la ventana `assist` (Teach mode y píldora de grabación). */
  'computer:assist': AssistMessage
  'computer:recordDone': SkillRecording
  /** El Modo auto aprobó algo automáticamente (para el aviso "Aprobado por el modo auto: …"). */
  'tasks:auto:approved': AutoApprovalRecord
}

export type TasksInvokeChannel = keyof TasksInvokeContract
export type TasksEventChannel = keyof TasksEventContract
export type TasksRequest<C extends TasksInvokeChannel> = TasksInvokeContract[C]['req']
export type TasksResponse<C extends TasksInvokeChannel> = TasksInvokeContract[C]['res']

export const TASKS_INVOKE_CHANNELS = [
  'tasks:pickFolder',
  'tasks:listFolders',
  'tasks:approveFolder',
  'tasks:removeFolder',
  'tasks:start',
  'tasks:grantFullAccess',
  'tasks:revokeFullAccess',
  'tasks:deliverables',
  'tasks:reveal',
  'tasks:openPath',
  'tasks:importFiles',
  'tasks:previewFile',
  'tasks:project:get',
  'tasks:project:save',
  'tasks:memory:get',
  'tasks:memory:save',
  'tasks:memory:delete',
  'tasks:network:state',
  'tasks:network:setToggle',
  'tasks:network:setHost',
  'tasks:network:allowOnce',
  'tasks:deleteGrant:get',
  'tasks:deleteGrant:set',
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
  'computer:revokePlan',
  'computer:approvedPlans',
  'computer:showMainWindow',
  'tasks:keepAwakeState',
  'tasks:keepAwakeSetting',
  'tasks:keepAwakeActive',
  'tasks:folders:get',
  'tasks:folders:check',
  'tasks:folders:link',
  'tasks:folders:unlink',
  'tasks:trusted:list',
  'tasks:trusted:set',
  'tasks:trusted:remove',
  'tasks:policy',
  'tasks:activity',
  'tasks:viewing',
  'tasks:tasks:list',
  'tasks:tasks:setMeta',
  'tasks:tasks:forget',
  'tasks:prefs:get',
  'tasks:prefs:set',
  'tasks:storage:report',
  'tasks:storage:clean',
  'tasks:storage:cleanScreenshots',
  'tasks:restore:create',
  'tasks:restore:list',
  'tasks:restore:changes',
  'tasks:restore:apply',
  'tasks:restore:forget',
  'tasks:agentsMd:get',
  'tasks:agentsMd:save',
  'tasks:mcp:list',
  'tasks:mcp:set',
  'tasks:rules:list',
  'tasks:rules:add',
  'tasks:rules:remove',
  'tasks:zip',
  'tasks:quickLook',
  'tasks:exportMarkdown',
  'tasks:htmlToPdf',
  'computer:prefs:get',
  'computer:prefs:set',
  'computer:teachRespond',
  'computer:record:start',
  'computer:record:stop',
  'computer:record:prepare',
  'tasks:auto:state',
  'tasks:auto:set',
  'tasks:auto:revoke',
  'tasks:auto:clearLog',
  'tasks:auto:consider'
] as const satisfies readonly TasksInvokeChannel[]

export const TASKS_EVENT_CHANNELS = [
  'tasks:server',
  'routines:changed',
  'routines:run',
  'computer:action',
  'computer:stopped',
  'computer:killState',
  'computer:overlay',
  'computer:accessRequest',
  'computer:accessResolved',
  'computer:planState',
  'tasks:networkBlocked',
  'tasks:activity',
  'computer:assist',
  'computer:recordDone',
  'tasks:auto:approved'
] as const satisfies readonly TasksEventChannel[]

type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
const _inv: Missing<TasksInvokeChannel, (typeof TASKS_INVOKE_CHANNELS)[number]> extends never ? true : never = true
const _evt: Missing<TasksEventChannel, (typeof TASKS_EVENT_CHANNELS)[number]> extends never ? true : never = true
void _inv
void _evt

/** API expuesta en `window.api.tasks`. */
export interface TasksApi {
  invoke<C extends TasksInvokeChannel>(
    channel: C,
    ...args: TasksRequest<C> extends void ? [] : [req: TasksRequest<C>]
  ): Promise<IpcResult<TasksResponse<C>>>
  on<C extends TasksEventChannel>(channel: C, listener: (payload: TasksEventContract[C]) => void): () => void
}

export const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
