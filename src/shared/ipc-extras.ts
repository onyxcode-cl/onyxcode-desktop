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
  'extras:chatDoc:openExternal': { req: ChatDocExternalRequest; res: { ok: true; via: 'craft' | 'system' } | { ok: false } }
  /** `data` (Excel/PowerPoint) → archivo real, con diálogo nativo "Guardar como". `null` si cancela. */
  'extras:downloadChatDoc': { req: ChatDocDownloadRequest; res: string | null }
  /** Desde la ventana Quick Entry. */
  'extras:quickSubmit': { req: QuickPromptEvent; res: void }
  'extras:quickHide': { req: void; res: void }
  'extras:quickToggle': { req: void; res: void }
  /** Suspende el atajo global mientras se graba uno nuevo en Ajustes. */
  'extras:suspendShortcut': { req: { suspended: boolean }; res: void }
  /** La ventana principal lo llama al montar: prompt de Quick Entry que llegó mientras cargaba. */
  'extras:takePendingPrompt': { req: void; res: QuickPromptEvent | null }
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
  'extras:downloadChatDoc',
  'extras:quickSubmit',
  'extras:quickHide',
  'extras:quickToggle',
  'extras:suspendShortcut',
  'extras:takePendingPrompt',
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
