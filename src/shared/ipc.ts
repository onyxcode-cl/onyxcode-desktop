/**
 * Contrato IPC tipado entre main y renderer.
 *
 * - `IpcInvokeContract`: canales request/response (renderer → main, `ipcRenderer.invoke`).
 * - `IpcEventContract`: eventos push (main → renderer, `webContents.send`).
 *
 * Para agregar un canal: añadir la entrada aquí, registrarlo en `src/main/ipc/<modulo>.ts`
 * con `handle(...)` y usarlo en el renderer con `api.invoke('<canal>', req)`.
 */
import type { AccessLevel, ProjectProfileView, VaultSetView } from './project-profile'
import type { PasteResult, PasteScope } from './paste-files'
import type { OfficeExtractRequest, OfficeExtractResult } from './attach-office'
import type { PdfApplyRequest, PdfApplyResult, PdfExtractRequest, PdfExtractResult } from './translate-pdf'
import type {
  AppInfo,
  NotifyTarget,
  OpencodeConnection,
  OpencodeInfo,
  PickOpencodeBinResult,
  ServerStatus,
  Settings,
  UseBundledEngineResult
} from './types'
import type { OpencodeAction } from './opencode-links'
import type { UpdateState } from './update-check'
import type { InstallState } from './update-install'
import type { KeyTestResult } from './key-test'
import type { DiagLogs, DiagSource } from './diagnostics'
import type { AlwaysListResult, AlwaysRevokeResult } from './engine-always'
import type { EngineJobResumeResult, EngineJobsResult } from './engine-jobs'
import type { BudgetConfig, BudgetResult, GoalResult, GoalSetRequest, GoalSetResult, ReviewResult } from './engine-code-extras'
import type { ForeignAgentsResult, HelperDef, HelperReadResult, HelperSaveResult, HelpersListResult } from './helper-agents'

/** FORBIDDEN = emisor/ventana no autorizados; INVALID = payload rechazado por el esquema; BUSY = hay trabajo en curso. */
/** `PLATFORM_UNSUPPORTED`: función solo de macOS (Tareas, Control del PC, actualizador) en otra plataforma. */
export type IpcErrorCode = 'NOT_READY' | 'ERROR' | 'FORBIDDEN' | 'INVALID' | 'BUSY' | 'PLATFORM_UNSUPPORTED'

/** Respuesta sin código de error (canales `extras:`/`mcp:`/`browser:`). */
export type IpcPlainResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Todas las respuestas IPC vienen envueltas; nunca se lanza a través del puente. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; code: IpcErrorCode; error: string }

export interface IpcInvokeContract {
  // app
  'app:info': { req: void; res: AppInfo }
  'app:openExternal': { req: { url: string }; res: void }
  /** Nombre del equipo (`os.hostname()`) para el panel «Entorno». Solo la ventana principal; nunca el celular. */
  'app:hostName': { req: void; res: string }
  /** Reinicia Lazunox (la bienvenida lo ofrece cuando macOS solo aplica un permiso al abrir la app de nuevo). */
  'app:relaunch': { req: void; res: void }
  /**
   * Notificación nativa desde main (Code/Tareas: sesión terminó o pide algo). `target`, si viene,
   * es adónde llevar al usuario al hacer clic (evento `app:openTarget`).
   */
  'app:notify': { req: { title: string; body: string; target?: NotifyTarget }; res: void }
  /** Badge del Dock (`app.dock.setBadge`); `count === 0` lo limpia. */
  'app:setAttention': { req: { count: number }; res: void }

  /** Binario de OpenCode detectado (ejecuta `--version` en main). */
  'app:opencodeInfo': { req: void; res: OpencodeInfo }
  /** Acciones fijas del asistente: copiar el comando de instalación o abrir una página de OpenCode (lista blanca). */
  'app:opencodeAction': { req: { action: OpencodeAction }; res: void }
  /** Diálogo «Elegir binario…»: valida el archivo y lo guarda en `settings.opencodeBin`. */
  'app:pickOpencodeBin': { req: void; res: PickOpencodeBinResult }
  /** «Usar el motor incluido»: olvida la ruta elegida en ajustes (el renderer reinicia el motor después). No descarga nada. */
  'app:useBundledEngine': { req: void; res: UseBundledEngineResult }
  /** Estado del aviso de versión nueva (la versión publicada se consulta como mucho una vez al día). */
  'app:updateState': { req: void; res: UpdateState }
  /** «Buscar ahora»: fuerza una comprobación (respeta la espera por límite de GitHub). */
  'app:checkUpdates': { req: void; res: UpdateState }
  /** «Más tarde»: no vuelve a avisar de esa versión (sí de una mayor). */
  'app:dismissUpdate': { req: { version: string }; res: UpdateState }
  /** «Actualizar»: descarga y verifica la versión que el aviso ya conoce (el renderer no aporta URLs ni rutas). */
  'app:updateDownload': { req: void; res: UpdateState }
  /** «Cancelar» (descarga en curso) o descartar una actualización lista / con error. */
  'app:updateCancel': { req: void; res: UpdateState }
  /** «Reiniciar ahora»: sustituye la app por la versión ya verificada y la reabre. */
  'app:updateInstall': { req: void; res: UpdateState }
  /**
   * «Probar clave»: main lee la clave ya guardada y hace un GET gratuito al proveedor. La clave no cruza el IPC ni
   * vuelve al renderer; solo se devuelve el estado. BUSY si hay otra prueba en curso o fue hace menos de 5 s.
   */
  'app:testProviderKey': { req: { providerID: string }; res: KeyTestResult }
  /** El renderer de la ventana principal ya pintó: con la carga de la ventana completa el marcador de arranque del actualizador. */
  'app:bootConfirm': { req: void; res: void }

  // opencode sidecar
  'opencode:connection': { req: void; res: OpencodeConnection }
  'opencode:status': { req: void; res: ServerStatus }
  'opencode:restart': { req: void; res: OpencodeConnection }

  // diagnóstico: todo texto sale redactado desde main (claves, contraseña del motor, rutas del usuario)
  'diag:logs': { req: { source: DiagSource; maxLines?: number }; res: DiagLogs }
  /**
   * Trabajos en segundo plano del motor propio de una sesión (comandos y Code Mode). Main llama al sidecar; `available: false` si el
   * motor no tiene la ruta. `jobs:stop` termina uno (`ok: false` si ya no existe o terminó). Nunca rutas ni comandos del renderer.
   */
  'jobs:list': { req: { sessionID: string; directory?: string }; res: EngineJobsResult }
  'jobs:stop': { req: { sessionID: string; jobId: string; directory?: string }; res: { ok: boolean } }
  /** Reanuda un ayudante de fondo `perdido` (el motor se reinició). `motivo` si el motor no pudo: `no_existe`, `ya_en_curso` o `tope`. */
  'jobs:resume': { req: { sessionID: string; jobId: string; directory?: string }; res: EngineJobResumeResult }
  /**
   * Objetivo, Presupuesto y Revisar cambios de Code (experimentales, `engineExperiments.codeExtras`; ver `engine-code-extras.ts`). Main
   * llama al sidecar; `available: false` si el motor no tiene la ruta. Cada canal exige su bandera encendida (si no, `FORBIDDEN`).
   * El presupuesto lee la sesión y reenvía TODAS las claves de `metadata` (no se sabe si el motor reemplaza o fusiona).
   */
  'goal:get': { req: { sessionID: string; directory?: string }; res: GoalResult }
  'goal:set': { req: GoalSetRequest; res: GoalSetResult }
  'goal:clear': { req: { sessionID: string; directory?: string }; res: { available: boolean; ok: boolean } }
  'budget:get': { req: { sessionID: string; directory?: string }; res: BudgetResult }
  'budget:set': { req: { sessionID: string; directory?: string; config: BudgetConfig }; res: BudgetResult }
  /** Lanza `/review` en la sesión (agente de solo lectura) y devuelve los hallazgos YA validados; el texto del modelo no pasa tal cual. */
  'review:run': { req: { sessionID: string; directory?: string; model?: string }; res: ReviewResult }
  /**
   * Ajustes › Ayudantes: carpeta elegida con el diálogo del sistema (main la recuerda como permitida), lista de `GET /agent`, lectura y
   * escritura del `.md` de `.opencode/agents/` (solo dentro de esa carpeta) y aviso de `.claude/agents`. Ver `helper-agents.ts`.
   */
  'helpers:pickFolder': { req: void; res: string | null }
  'helpers:list': { req: { directory: string }; res: HelpersListResult }
  'helpers:read': { req: { directory: string; name: string }; res: HelperReadResult }
  'helpers:save': { req: { directory: string; def: HelperDef; mode: 'create' | 'edit' }; res: HelperSaveResult }
  'helpers:inspectForeign': { req: { directory: string }; res: ForeignAgentsResult }
  /** Copia al portapapeles (lo hace main) el texto redactado de la fuente. */
  'diag:copy': { req: { source: DiagSource }; res: { lines: number } }
  /**
   * Pegar archivos/imágenes cuando el evento `paste` no trajo ninguno (Finder/Explorador/capturas). Main lee el portapapeles
   * del sistema, valida (regulares, sin ejecutables, topes 10 / 25 MB / 50 MB) y devuelve los bytes en base64. Solo escritorio.
   */
  'clipboard:readFilesForPaste': { req: { scope: PasteScope }; res: PasteResult }
  /** Ficha del proyecto: nivel de acceso de la IA y Bóveda de variables, por carpeta. La pantalla solo recibe nombres, nunca valores. */
  'project:profile': { req: { folder: string }; res: ProjectProfileView }
  'project:setAccess': { req: { folder: string; access: AccessLevel }; res: ProjectProfileView }
  'project:setName': { req: { folder: string; name: string }; res: ProjectProfileView }
  'project:vaultSet': { req: { folder: string; text: string }; res: VaultSetView }
  'project:vaultDelete': { req: { folder: string; name: string }; res: ProjectProfileView }
  /**
   * Adjuntar un documento de oficina al Chat: main lo convierte a texto Markdown (solo lectura, sin macros ni vínculos, con topes
   * y avisos de recorte) y lo devuelve ya enmarcado como datos. El renderer manda los bytes que ya leyó; nunca una ruta.
   */
  'attach:extractOffice': { req: OfficeExtractRequest; res: OfficeExtractResult }
  /**
   * Traducir un PDF sin cambiar su diseño (F8-B200). `pdfExtract`: main guarda los bytes en una carpeta propia del trabajo y lista
   * los textos con PyMuPDF; `pdfApply`: escribe las traducciones (que el renderer pidió al modelo) sobre el mismo PDF;
   * `pdfOpen`/`pdfSave`: lo abre con el visor del sistema o diálogo «Guardar como…»; `pdfDiscard`: borra el trabajo. Nunca rutas.
   */
  'translate:pdfExtract': { req: PdfExtractRequest; res: PdfExtractResult }
  'translate:pdfApply': { req: PdfApplyRequest; res: PdfApplyResult }
  'translate:pdfOpen': { req: { jobId: string }; res: { opened: boolean } }
  'translate:pdfSave': { req: { jobId: string }; res: { saved: boolean } }
  'translate:pdfDiscard': { req: { jobId: string }; res: void }
  /** «Exportar…»: diálogo de guardado y archivo `Lazunox-diagnostico-AAAAMMDD-HHmm.txt` (0600) con el informe redactado. */
  'diag:export': { req: void; res: { saved: boolean } }
  /** La ventana avisa de un error suyo (error no capturado, fallo de render) para dejarlo en el registro de problemas. */
  'diag:problem': { req: { message: string; stack?: string; origin?: 'chat-doc' }; res: void }

  // settings
  'settings:get': { req: void; res: Settings }
  'settings:set': { req: Partial<Settings>; res: Settings }
  'settings:addRecentFolder': { req: { path: string }; res: Settings }
  /** «Olvidar los permisos guardados»: borra lo que el motor recordó con «Permitir siempre». Devuelve cuántos elementos quitó. */
  'settings:forgetAlways': { req: void; res: { removed: number } }
  /** Lista los «siempre» que el motor guardó para una carpeta (Ola 7, 7.22). `available: false` = el motor no tiene la ruta. */
  'settings:alwaysList': { req: { directory: string }; res: AlwaysListResult }
  /** Quita UN «siempre» guardado (por el id estable del motor). `ok: false` = ya no existía. */
  'settings:alwaysRevoke': { req: { directory: string; id: string }; res: AlwaysRevokeResult }
  /** Lee el archivo de ganchos de usuario (`''` si aún no existe). El contenido nunca va a logs ni a telemetría. */
  'settings:hooksRead': { req: void; res: { text: string; exists: boolean } }
  /** Valida y guarda el archivo de ganchos (escritura atómica). Si no pasa la validación, devuelve los problemas (códigos, no el texto). */
  'settings:hooksWrite': {
    req: { text: string }
    res: { ok: true } | { ok: false; issues: Array<{ code: string; params?: Record<string, string | number> }> }
  }
}

export interface IpcEventContract {
  'opencode:status': ServerStatus
  'opencode:connection': OpencodeConnection
  'settings:changed': Settings
  /** Clic en una notificación (o "abrir" desde el Dock): el renderer cambia de modo y selecciona. */
  'app:openTarget': NotifyTarget
  /** Cambio en el estado del aviso de versión nueva (mismo nombre que el invoke, como `opencode:status`). */
  'app:updateState': UpdateState
  /** Progreso y fase de la descarga/instalación de una actualización. */
  'app:updateProgress': InstallState
}

export type IpcInvokeChannel = keyof IpcInvokeContract
export type IpcEventChannel = keyof IpcEventContract
export type IpcRequest<C extends IpcInvokeChannel> = IpcInvokeContract[C]['req']
export type IpcResponse<C extends IpcInvokeChannel> = IpcInvokeContract[C]['res']

/** Lista en runtime de canales permitidos (el preload valida contra esto). */
export const IPC_INVOKE_CHANNELS = [
  'app:info',
  'app:openExternal',
  'app:hostName',
  'app:relaunch',
  'app:notify',
  'app:setAttention',
  'app:opencodeInfo',
  'app:opencodeAction',
  'app:pickOpencodeBin',
  'app:useBundledEngine',
  'app:updateState',
  'app:checkUpdates',
  'app:dismissUpdate',
  'app:updateDownload',
  'app:updateCancel',
  'app:updateInstall',
  'app:bootConfirm',
  'app:testProviderKey',
  'opencode:connection',
  'opencode:status',
  'opencode:restart',
  'diag:logs',
  'diag:copy',
  'jobs:list',
  'jobs:stop',
  'jobs:resume',
  'goal:get',
  'goal:set',
  'goal:clear',
  'budget:get',
  'budget:set',
  'review:run',
  'helpers:pickFolder',
  'helpers:list',
  'helpers:read',
  'helpers:save',
  'helpers:inspectForeign',
  'clipboard:readFilesForPaste',
  'project:profile',
  'project:setAccess',
  'project:setName',
  'project:vaultSet',
  'project:vaultDelete',
  'attach:extractOffice',
  'translate:pdfExtract',
  'translate:pdfApply',
  'translate:pdfOpen',
  'translate:pdfSave',
  'translate:pdfDiscard',
  'diag:export',
  'diag:problem',
  'settings:get',
  'settings:set',
  'settings:addRecentFolder',
  'settings:forgetAlways',
  'settings:alwaysList',
  'settings:alwaysRevoke',
  'settings:hooksRead',
  'settings:hooksWrite'
] as const satisfies readonly IpcInvokeChannel[]

export const IPC_EVENT_CHANNELS = [
  'opencode:status',
  'opencode:connection',
  'settings:changed',
  'app:openTarget',
  'app:updateState',
  'app:updateProgress'
] as const satisfies readonly IpcEventChannel[]

// Garantiza en compilación que las listas cubren todo el contrato.
type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
const _invokeCoverage: Missing<IpcInvokeChannel, (typeof IPC_INVOKE_CHANNELS)[number]> extends never ? true : never = true
const _eventCoverage: Missing<IpcEventChannel, (typeof IPC_EVENT_CHANNELS)[number]> extends never ? true : never = true
void _invokeCoverage
void _eventCoverage

/** API expuesta por el preload en `window.api`. */
export interface WindowApi {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    ...args: IpcRequest<C> extends void ? [] : [req: IpcRequest<C>]
  ): Promise<IpcResult<IpcResponse<C>>>
  /** Suscribe a un evento main → renderer. Devuelve función para desuscribir. */
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventContract[C]) => void): () => void
  platform: string
  /** Banderas de producto que modulan `capsFor` (solo ayudan a la interfaz; `main` es quien decide). Ausente = todo apagado. */
  capsFlags?: import('./platform-caps').CapsFlags
  code: import('./ipc-code').CodeApi
  tasks: import('./ipc-tasks').TasksApi
  extras: import('./ipc-extras').ExtrasApi
  browser: import('./ipc-browser').BrowserApi
  remote: import('./ipc-remote').RemoteApi
}
