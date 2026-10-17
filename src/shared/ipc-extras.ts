/**
 * Contrato IPC de "extras": ajustes propios (atajos, modelos por modo), MCP administrado
 * por la app, Quick Entry, ventana de artifacts y bandeja del sistema.
 *
 * Canales con prefijo `extras:` y `mcp:`. Se registran en `src/main/ipc/extras-handlers.ts`
 * y se exponen en el preload como `window.api.extras` (`src/preload/extras-api.ts`).
 */
import type { KeybindingOverrides } from './keybindings'
import type { McpCatalogState } from './mcp-catalog'
import type { ModelRef } from './types'
import type { ViewerEventType, ViewerRect } from './ipc-tasks'
import type { DocxSpec, PptxSpec, XlsxSpec } from './chat-doc-spec'
import type { ExportDoc, ExportOptions } from './conversation-export'

/** Modos que usan un modelo (Rutinas elige el suyo por rutina). */
export type ModelMode = 'chat' | 'code' | 'tasks'

export interface ExtrasPrefs {
  /** Acelerador de Electron para Quick Entry (p.ej. "Alt+Space"). Vacío = desactivado. */
  quickEntryShortcut: string
  /** Modelo por modo; si falta, se usa `settings.defaultModel`. */
  modelsByMode: Partial<Record<ModelMode, ModelRef>>
  /** Mostrar icono en la barra de menús. */
  showTray: boolean
  /** Notificaciones nativas (Code/Tareas: sesión terminó o pide algo). */
  notificationsEnabled: boolean
  /** Sonido de las notificaciones (`Notification.silent` invertido). */
  soundEnabled: boolean
  /** Último editor elegido en «Abrir en…» (id del catálogo de main); vacío = ninguno. */
  lastEditor: string
  /** Atajos de la aplicación que el usuario cambió: `{ [idAcción]: atajo | null }` (`null` = desactivado, ausente = por defecto). */
  keybindings: KeybindingOverrides
}

export const DEFAULT_QUICK_ENTRY_SHORTCUT = 'Alt+Space'

/** En Windows `Alt+Space` abre el menú de sistema de la ventana: el atajo por defecto es `Alt+Shift+Space`. */
export function defaultQuickEntryShortcut(platform: string): string {
  return platform === 'win32' ? 'Alt+Shift+Space' : DEFAULT_QUICK_ENTRY_SHORTCUT
}

export const DEFAULT_EXTRAS_PREFS: ExtrasPrefs = {
  quickEntryShortcut: DEFAULT_QUICK_ENTRY_SHORTCUT,
  modelsByMode: {},
  showTray: true,
  notificationsEnabled: true,
  soundEnabled: true,
  lastEditor: '',
  keybindings: {}
}

export interface ExtrasPrefsState {
  prefs: ExtrasPrefs
  /** Error al registrar el atajo global (ocupado por otra app, inválido…). */
  shortcutError: string | null
}

export interface VersionsInfo {
  app: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
  osRelease: string
}

// ---- MCP administrado por la app ----

export interface McpLocalEntry {
  type: 'local'
  /** Comando + argumentos. */
  command: string[]
  environment?: Record<string, string>
  cwd?: string
  enabled?: boolean
  timeout?: number
}

export interface McpRemoteEntry {
  type: 'remote'
  url: string
  headers?: Record<string, string>
  enabled?: boolean
  timeout?: number
  /** `false` desactiva la autodetección OAuth. */
  oauth?: false | Record<string, string | number>
}

export type McpEntry = McpLocalEntry | McpRemoteEntry

export interface AppMcpConfig {
  /** Ruta del archivo JSON propiedad de la app (se pasa al sidecar vía OPENCODE_CONFIG). */
  path: string
  servers: Record<string, McpEntry>
}

export interface ArtifactPayload {
  title: string
  html: string
}

export interface QuickPromptEvent {
  text: string
}

// ───────────────── Documentos de Chat (PDF vía HTML, Excel/PowerPoint vía datos) ─────────────────

/**
 * Por qué `extras:chatDoc:open` no abrió nada: `failed` (la generación del archivo falló por algo inesperado), `invalid` (los datos no
 * pasaron la validación de main) o `no-craft` (falta el programa de ArtCraft que ese tipo de documento necesita). `detail` es un motivo
 * corto y ya apto para mostrar (nunca un mensaje crudo del sistema: solo textos propios de la app).
 */
export type ChatDocOpenReject = 'failed' | 'invalid' | 'no-craft'
/** `bytes` (opcional): peso real del archivo generado, para la tarjeta de documento del Chat. */
export type ChatDocOpenResult = { ok: true; bytes?: number } | { ok: false; reason: ChatDocOpenReject; detail?: string }

// ───────────────── Archivos que la IA crea o menciona en el Chat ─────────────────

/** Tipo de archivo: `blocked` = ejecutable o lanzador (solo «Mostrar en la carpeta»). */
export type ChatFileKind = 'image' | 'pdf' | 'office' | 'html' | 'markdown' | 'text' | 'code' | 'other' | 'blocked'

export interface ChatFileInfo {
  /** Ruta tal como la nombró el renderer (main revalida en cada acción). */
  path: string
  name: string
  bytes: number
  kind: ChatFileKind
  /** Se puede mostrar dentro de la app («Ver aquí»). */
  canView: boolean
  /** Se puede abrir con el programa predeterminado del sistema. */
  canOpen: boolean
}

export type ChatFileReadResult =
  | { ok: true; kind: 'image'; dataUrl: string }
  | { ok: true; kind: 'text' | 'markdown' | 'code' | 'html'; text: string; truncated: boolean }
  | { ok: false; reason: 'too-large' | 'unsupported' | 'unreadable' }

export type ChatFileViewResult = { ok: true } | { ok: false; reason: 'unsupported' | 'too-large' | 'failed' }

// ───────────────── Galería «Lo que has creado» ─────────────────

/** Tipo de creación para filtrar y dibujar la miniatura. */
export type GalleryType = 'document' | 'sheet' | 'slides' | 'web' | 'pdf' | 'image' | 'text'
/** De dónde viene: Chat o Overdrive (el modo Tareas). */
export type GalleryOrigin = 'chat' | 'overdrive'

export interface GalleryItem {
  /** Ruta real del archivo (sirve de identificador y es lo que se pasa a «Ver aquí» y compañía). */
  path: string
  name: string
  type: GalleryType
  origin: GalleryOrigin
  /** Fecha de creación o registro (ms). */
  createdAt: number
  bytes: number
  /** Datos de ChatFileInfo para las acciones. */
  kind: ChatFileKind
  canView: boolean
  canOpen: boolean
  /** El archivo ya no existe (o salió de las carpetas permitidas): solo se ofrece «Quitar de la lista». */
  missing: boolean
}

export interface GalleryListResult {
  items: GalleryItem[]
  /** Había más que el tope y se mostraron los más recientes. */
  truncated: boolean
}

/** Miniatura: imagen reducida real, primera línea de texto, o nada (la interfaz dibuja el ícono del tipo). */
export type GalleryThumbResult = { kind: 'image'; dataUrl: string } | { kind: 'text'; text: string } | { kind: 'none' }

interface ChatDocOpenCommon {
  title: string
  /** Carpeta temporal propia por sesión de chat (nunca una carpeta del usuario). */
  sessionId: string
  lang: 'es' | 'en'
  theme: 'light' | 'dark'
}

export type ChatDocOpenRequest =
  | (ChatDocOpenCommon & { kind: 'pdf'; html: string })
  | (ChatDocOpenCommon & { kind: 'xlsx'; data: XlsxSpec })
  | (ChatDocOpenCommon & { kind: 'pptx'; data: PptxSpec })
  | (ChatDocOpenCommon & { kind: 'docx'; data: DocxSpec })

/** Para `extras:downloadChatDoc` — solo xlsx/pptx (el PDF ya tiene su propio `downloadHtmlAsPdf`). */
export type ChatDocDownloadRequest = { title: string } & (
  { kind: 'xlsx'; data: XlsxSpec } | { kind: 'pptx'; data: PptxSpec } | { kind: 'docx'; data: DocxSpec }
)

/** Para `extras:chatDoc:openExternal`: como la descarga, más el PDF (HTML). */
export type ChatDocExternalRequest = ChatDocDownloadRequest | { title: string; kind: 'pdf'; html: string }

export interface ConversationExportRequest {
  format: 'md' | 'pdf'
  doc: ExportDoc
  options: ExportOptions
  lang: 'es' | 'en'
}
export interface ConversationExportResult {
  path: string | null
  /** Posibles claves tachadas. */
  redactions: number
}

// ───────────────────────────── Importar desde otras herramientas (Ajustes > Importar) ─────────────────────────────
/** Qué elige la persona en el diálogo nativo: una carpeta de proyecto (AGENTS.md/CLAUDE.md, `.mcp.json`) o un archivo de configuración MCP. */
export type ImportSource = 'project-folder' | 'mcp-file'
export type ImportItemKind = 'instructions' | 'mcp'
/** Motivos (códigos) por los que algo se descarta o se avisa; el texto lo pone el renderer (`import.reason.<code>`). Nunca llevan valores del archivo. */
export type ImportReasonCode =
  | 'secret-in-args'
  | 'secret-in-url'
  | 'secret-in-text'
  | 'url-credentials'
  | 'dangerous-command'
  | 'shell-wrapper'
  | 'shell-metachar'
  | 'invalid-entry'
  | 'invalid-name'
  | 'name-exists'
  | 'too-big'
  | 'empty'
  | 'unsupported-type'
  | 'refs-agents'
  | 'same-content'
  | 'already-native'
  | 'cwd-dropped'
  | 'values-referenced'
  | 'insecure-http'
  | 'unknown-command'
  | 'renamed'
  | 'append'
export interface ImportReason {
  code: ImportReasonCode
  /** Dato no sensible que ayuda a entender el motivo (nombre de un comando, de una variable o de un archivo; líneas de un texto). */
  detail?: string
}
export interface ImportItem {
  /** `i0`, `m1`…: identificador opaco dentro de esta vista previa. */
  id: string
  kind: ImportItemKind
  name: string
  /** Archivo de origen (relativo a la carpeta elegida o nombre del archivo). */
  origin: string
  /** Resumen sin secretos: comando o URL, o el comienzo del texto. */
  summary: string
  /** `ok` = se puede importar (con casilla); `discarded` = se descarta y se explica por qué. */
  status: 'ok' | 'discarded'
  reasons: ImportReason[]
  /** Variables de entorno que el servidor importado referencia por nombre (los valores NO se copian). */
  envRefs: string[]
}
export interface ImportPreview {
  token: string
  /** Nombre (no la ruta completa) de lo elegido. */
  label: string
  items: ImportItem[]
}
export interface ImportApplyRequest {
  token: string
  ids: string[]
}
export interface ImportApplyResult {
  results: { id: string; ok: boolean; error?: string }[]
  /** Configuración MCP vigente (enmascarada) tras importar. */
  mcp: AppMcpConfig
}

export interface IpcExtrasInvokeContract {
  'extras:getPrefs': { req: void; res: ExtrasPrefsState }
  'extras:setPrefs': { req: Partial<ExtrasPrefs>; res: ExtrasPrefsState }
  'extras:versions': { req: void; res: VersionsInfo }
  'extras:openArtifact': { req: ArtifactPayload; res: void }
  /** `html` → PDF, con diálogo nativo "Guardar como" (el usuario elige dónde). `null` si cancela. */
  'extras:downloadHtmlAsPdf': { req: ArtifactPayload; res: string | null }
  /** Un deck `​```slides` (HTML libre) → `.pptx` PROYECTABLE: una imagen por diapositiva, no editable
   * (ver `slides-deck-export.ts`) — alternativa a `extras:downloadHtmlAsPdf` para quien necesite
   * abrirlo y presentarlo en PowerPoint/Keynote. Mismo diálogo "Guardar como", `null` si cancela. */
  'extras:downloadSlidesAsPptx': { req: ArtifactPayload; res: string | null }
  /** "Presentar" un deck `​```slides` DENTRO de Lazunox: una ventana PROPIA (no la principal), en
   * pantalla completa de verdad del sistema operativo, solo con el HTML escalado a toda la pantalla
   * — nada de la app alrededor (ver `presentSlides`, `artifact-window.ts`). */
  'extras:presentSlides': { req: ArtifactPayload; res: void }
  /** Voz a texto 100% local (Whisper multilingüe vía `smart-whisper-electron`/whisper.cpp, ver
   * `voice-transcribe.ts`) — `samples` es PCM mono de 16 kHz (el renderer graba/remuestrea a eso).
   * El audio nunca sale de la máquina; devuelve el texto transcrito (`''` si no se entendió nada). */
  'extras:transcribeAudio': { req: { samples: Float32Array }; res: string }
  /** El archivo (PDF/Excel/PowerPoint) se genera y se guarda en una carpeta temporal propia de la sesión, mostrado en el visor nativo (panel lateral de Chat). */
  'extras:chatDoc:open': { req: ChatDocOpenRequest; res: ChatDocOpenResult }
  'extras:chatDoc:attach': { req: { rect: ViewerRect; visible: boolean }; res: void }
  /** Cierra el panel y borra los documentos temporales de esa sesión. */
  'extras:chatDoc:close': { req: { sessionId: string }; res: void }
  /** El documento se abre en el programa de ArtCraft de escritorio (o, si no está, en el del sistema): `via` dice cuál. */
  /** Archivos del Chat: solo dentro de las carpetas del chat y de los proyectos (`files/chat-files.ts`); cada acción revalida la ruta. */
  'extras:chatFile:info': { req: { paths: string[] }; res: ChatFileInfo[] }
  'extras:chatFile:read': { req: { path: string }; res: ChatFileReadResult }
  /** PDF/Word/Excel/PowerPoint en el visor nativo del panel lateral del Chat. */
  'extras:chatFile:viewNative': { req: { path: string; lang: 'es' | 'en'; theme: 'light' | 'dark' }; res: ChatFileViewResult }
  /** Abre con el programa predeterminado del sistema (nunca ejecutables ni lanzadores). */
  'extras:chatFile:open': { req: { path: string }; res: void }
  'extras:chatFile:reveal': { req: { path: string }; res: void }
  /** Galería: lista (reconstruye el índice local y comprueba que los archivos sigan existiendo), miniatura y «Quitar de la lista». */
  'extras:gallery:list': { req: void; res: GalleryListResult }
  'extras:gallery:thumb': { req: { path: string }; res: GalleryThumbResult }
  'extras:gallery:remove': { req: { path: string }; res: void }
  'extras:chatDoc:openExternal': { req: ChatDocExternalRequest; res: { ok: true; via: 'craft' | 'system' } | { ok: false } }
  /** `data` (Excel/PowerPoint) → archivo real, con diálogo nativo "Guardar como". `null` si cancela. */
  'extras:downloadChatDoc': { req: ChatDocDownloadRequest; res: string | null }
  /** Exporta una conversación a `.md` o `.pdf` con el diálogo nativo «Guardar como» (main genera el archivo, tacha claves y sanea el nombre). `path: null` si se cancela. */
  'extras:exportConversation': { req: ConversationExportRequest; res: ConversationExportResult }
  /** Desde la ventana Quick Entry. */
  'extras:quickSubmit': { req: QuickPromptEvent; res: void }
  'extras:quickHide': { req: void; res: void }
  'extras:quickToggle': { req: void; res: void }
  /** Suspende el atajo global mientras se graba uno nuevo en Ajustes. */
  'extras:suspendShortcut': { req: { suspended: boolean }; res: void }
  /** La ventana principal lo llama al montar: prompt de Quick Entry que llegó mientras cargaba. */
  'extras:takePendingPrompt': { req: void; res: QuickPromptEvent | null }
  /** Diálogo nativo → lee SOLO lo elegido y devuelve una vista previa sin secretos (`null` si se cancela). No escribe nada. */
  'extras:import:pick': { req: { source: ImportSource }; res: ImportPreview | null }
  /** Importa los elementos marcados de la última vista previa (MCP siempre desactivado). */
  'extras:import:apply': { req: ImportApplyRequest; res: ImportApplyResult }
  'mcp:getConfig': { req: void; res: AppMcpConfig }
  'mcp:save': { req: { name: string; entry: McpEntry; previousName?: string }; res: AppMcpConfig }
  'mcp:remove': { req: { name: string }; res: AppMcpConfig }
  'mcp:setEnabled': { req: { name: string; enabled: boolean }; res: AppMcpConfig }
  'mcp:revealConfig': { req: void; res: void }
  /** Catálogo curado (incluido en la app) + qué servidores instalados vienen de él. */
  'mcp:catalog': { req: void; res: McpCatalogState }
  /** Instala un servidor del catálogo: main construye la entrada desde su copia; el renderer solo manda entradas. */
  'mcp:installCatalog': {
    req: { id: string; name: string; inputs: Record<string, string>; enable: boolean; askEachUse: boolean }
    res: AppMcpConfig
  }
}

export interface IpcExtrasEventContract {
  /** Main → ventana principal: abrir Chat con este prompt. */
  'extras:quick-prompt': QuickPromptEvent
  /** Main → ventana principal: nueva conversación (bandeja). */
  'extras:new-conversation': void
  /** Main → ventana principal: abrir ajustes. */
  'extras:open-settings': void
  'extras:prefs-changed': ExtrasPrefsState
  /** Main → Quick Entry: la ventana se mostró (enfocar/limpiar input). */
  'extras:quick-shown': void
  /** El archivo MCP de la app cambió. */
  'mcp:changed': AppMcpConfig
  /** Avisos del panel de documento de Chat (escape, caída del proceso, carga, error) — igual que `tasks:viewer:event`. */
  'extras:chatDoc:event': { type: ViewerEventType }
  /** Progreso de la descarga del modelo de voz (solo la primera vez que se dicta algo, ver
   * `voice-transcribe.ts`) — sin esto, la primera transcripción se sentía colgada sin avisar que en
   * realidad estaba bajando el modelo. `progress` de 0 a 100. */
  'extras:voiceModelProgress': { status: 'downloading' | 'ready'; progress: number }
}

export type IpcExtrasInvokeChannel = keyof IpcExtrasInvokeContract
export type IpcExtrasEventChannel = keyof IpcExtrasEventContract

export const IPC_EXTRAS_INVOKE_CHANNELS = [
  'extras:getPrefs',
  'extras:setPrefs',
  'extras:versions',
  'extras:openArtifact',
  'extras:downloadHtmlAsPdf',
  'extras:downloadSlidesAsPptx',
  'extras:presentSlides',
  'extras:transcribeAudio',
  'extras:chatDoc:open',
  'extras:chatDoc:attach',
  'extras:chatDoc:close',
  'extras:chatDoc:openExternal',
  'extras:chatFile:info',
  'extras:chatFile:read',
  'extras:chatFile:viewNative',
  'extras:chatFile:open',
  'extras:chatFile:reveal',
  'extras:gallery:list',
  'extras:gallery:thumb',
  'extras:gallery:remove',
  'extras:downloadChatDoc',
  'extras:exportConversation',
  'extras:quickSubmit',
  'extras:quickHide',
  'extras:quickToggle',
  'extras:suspendShortcut',
  'extras:takePendingPrompt',
  'extras:import:pick',
  'extras:import:apply',
  'mcp:getConfig',
  'mcp:save',
  'mcp:remove',
  'mcp:setEnabled',
  'mcp:revealConfig',
  'mcp:catalog',
  'mcp:installCatalog'
] as const satisfies readonly IpcExtrasInvokeChannel[]

export const IPC_EXTRAS_EVENT_CHANNELS = [
  'extras:quick-prompt',
  'extras:new-conversation',
  'extras:open-settings',
  'extras:prefs-changed',
  'extras:quick-shown',
  'mcp:changed',
  'extras:chatDoc:event',
  'extras:voiceModelProgress'
] as const satisfies readonly IpcExtrasEventChannel[]

type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
const _inv: Missing<IpcExtrasInvokeChannel, (typeof IPC_EXTRAS_INVOKE_CHANNELS)[number]> extends never ? true : never = true
const _ev: Missing<IpcExtrasEventChannel, (typeof IPC_EXTRAS_EVENT_CHANNELS)[number]> extends never ? true : never = true
void _inv
void _ev

type Req<C extends IpcExtrasInvokeChannel> = IpcExtrasInvokeContract[C]['req']
type Res<C extends IpcExtrasInvokeChannel> = IpcExtrasInvokeContract[C]['res']
type Payload<C extends IpcExtrasEventChannel> = IpcExtrasEventContract[C]

/** API expuesta en `window.api.extras`. Todos los métodos lanzan `Error` si main falla. */
export interface ExtrasApi {
  invoke<C extends IpcExtrasInvokeChannel>(channel: C, ...args: Req<C> extends void ? [] : [req: Req<C>]): Promise<Res<C>>
  on<C extends IpcExtrasEventChannel>(
    channel: C,
    listener: Payload<C> extends void ? () => void : (payload: Payload<C>) => void
  ): () => void
  // Atajos de conveniencia
  openArtifact(payload: ArtifactPayload): Promise<void>
  downloadHtmlAsPdf(payload: ArtifactPayload): Promise<string | null>
  downloadSlidesAsPptx(payload: ArtifactPayload): Promise<string | null>
  presentSlides(payload: ArtifactPayload): Promise<void>
  transcribeAudio(samples: Float32Array): Promise<string>
  onQuickPrompt(listener: (event: QuickPromptEvent) => void): () => void
  onNewConversation(listener: () => void): () => void
  onOpenSettings(listener: () => void): () => void
}
