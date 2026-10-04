/**
 * Contrato IPC del navegador integrado (Lote D, B.4): familia propia como `ipc-extras`, con
 * canales `browser:*`. Se registra en `src/main/ipc/browser-handlers.ts` y se expone en el
 * preload como `window.api.browser` (`src/preload/browser-api.ts` / `browser-host.ts`).
 */
import type { BrowserSite } from './ipc-tasks'

export type BrowserProduct = 'code' | 'tasks'

/** Vista de las páginas: `desktop` (por defecto, viewport de escritorio emulado) o `mobile` (solo si el usuario la pide). */
export type BrowserViewMode = 'desktop' | 'mobile'

/** Dueño de una superficie de navegador: una tarea de Code (carpeta) o de Tareas (carpeta). */
export type BrowserOwner = { kind: 'code'; directory: string } | { kind: 'tasks'; folder: string }

export interface BrowserRect {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserTab {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** `true` = candado, `false` = "No es seguro", `null` = no aplica (about:blank…). */
  secure: boolean | null
  openedBy: 'user' | 'agent'
  agentSelected: boolean
  crashed?: boolean
}

export interface BrowserOwnerState {
  owner: BrowserOwner
  tabs: BrowserTab[]
  activeTabId: string | null
  control: 'idle' | 'agent' | 'paused'
  agentSessionId: string | null
  agentLabel: string | null
  userActive: boolean
  picking: boolean
  hostedIn: 'panel' | 'popout' | 'none'
  disabledReason?: string
  /** Aviso efímero para el usuario (p.ej. enlace `mailto:` bloqueado); el `id` cambia con cada aviso nuevo. */
  notice?: { id: number; text: string }
  /** Vista elegida (global, persistida). */
  viewMode: BrowserViewMode
}

export interface BrowserApprovalRequest {
  id: string
  owner: BrowserOwner
  sessionId: string
  kind: 'site' | 'local-origin' | 'sensitive' | 'download'
  url: string
  host: string
  site: string
  summary?: string
  fileName?: string
  savePath?: string
  createdAt: number
}

export type BrowserDecision = 'task' | 'always' | 'deny' | 'allow'

/**
 * Topes del elemento elegido (v2). Los comparten la página (mundo aislado, `pick-script.ts`), main (`pick.ts`) y el
 * esquema de `schemas.ts`: un solo sitio para cambiarlos.
 */
export const PICK_LIMITS = {
  html: 4096,
  text: 300,
  name: 80,
  selector: 300,
  path: 300,
  title: 200,
  url: 2048,
  /** Propiedades de `styles` como máximo y largo de cada valor. */
  styleCount: 40,
  styleValue: 200,
  /** Consola y red: entradas por lista, largo de cada texto y tamaño total (JSON) de `diagnostics`. */
  diagEntries: 10,
  diagText: 300,
  diagBytes: 3072,
  /** Captura recortada: lado largo en píxeles de la imagen y peso máximo del JPEG decodificado. */
  imageLongSide: 800,
  imageBytes: 300 * 1024,
  /** Nodos de texto, profundidad y número de hijos del HTML (los aplica la página; main los repite sobre la cadena). */
  textNode: 200,
  depth: 4,
  children: 20
} as const

/** Lista cerrada de estilos calculados que se recogen (el orden es el de salida). */
export const PICK_STYLE_PROPS = [
  'display',
  'position',
  'box-sizing',
  'width',
  'height',
  'margin',
  'padding',
  'gap',
  'flex-direction',
  'justify-content',
  'align-items',
  'grid-template-columns',
  'color',
  'background-color',
  'background-image',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'border',
  'border-radius',
  'box-shadow',
  'opacity',
  'visibility',
  'overflow',
  'z-index',
  'cursor',
  'transform'
] as const

export interface PickedConsoleEntry {
  level: 'error' | 'warning'
  text: string
}

export interface PickedNetworkEntry {
  method: string
  /** Sin query ni fragmento. */
  url: string
  /** Código HTTP (>= 400); ausente si la petición falló sin respuesta. */
  status?: number
  /** `net::ERR_…` cuando no hubo respuesta. */
  error?: string
}

export interface PickedImage {
  mime: 'image/jpeg'
  /** `data:image/jpeg;base64,…`, de como máximo `PICK_LIMITS.imageBytes` decodificados. */
  dataUrl: string
  /** Píxeles de la imagen (lado largo ≤ `PICK_LIMITS.imageLongSide`). */
  width: number
  height: number
}

/**
 * Elemento que el usuario eligió en el navegador integrado (evento `browser:picked`, v2). Todo está saneado en la página
 * y otra vez en main (`embedded-browser/pick.ts`): nunca lleva valores de formularios, campos sensibles, `value=`, tokens
 * ni URLs con query. Solo lo dispara el usuario.
 */
export interface PickedElement {
  v: 2
  tag: string
  role?: string
  name?: string
  /** Texto visible, ≤ `PICK_LIMITS.text`. */
  text?: string
  /** Selector CSS el más corto que la página resuelve a un único nodo. */
  selector: string
  /** Migas de pan legibles: `main > section.hero > div.cta > a`. */
  path: string
  /** HTML saneado (≤ `PICK_LIMITS.html` bytes). */
  html: string
  /** Subconjunto de `PICK_STYLE_PROPS` (≤ `PICK_LIMITS.styleCount`); se omiten los valores por defecto. */
  styles: Record<string, string>
  /** Píxeles CSS, relativos al viewport. */
  rect: BrowserRect
  viewport: { width: number; height: number; dpr: number }
  /** Página de la pestaña, sin query ni fragmento. */
  url: string
  title: string
  /** Ausente si el elemento es o contiene campos sensibles, si no se pudo capturar o si no cabe en el tope. */
  image?: PickedImage
  /** Errores de consola y de red desde que se activó la selección (`sinceMs`: ms transcurridos hasta la elección). */
  diagnostics?: { console: PickedConsoleEntry[]; network: PickedNetworkEntry[]; sinceMs: number }
  flags: {
    /** El elemento es/contiene un campo sensible o un campo con valor escrito: no hay captura. */
    sensitive: boolean
    /** El HTML, el texto o los estilos se recortaron por los topes. */
    truncated: boolean
  }
  /** Número de valores quitados u ocultados (value, secretos, campos ocultos, claves en texto). */
  redactions: number
}

export interface DevServerCandidate {
  url: string
  label: string
  source: 'port' | 'script'
  running: boolean
  script?: string
}

export interface BrowserPrefs {
  agentEnabled: { code: boolean; tasks: boolean }
  viewMode: BrowserViewMode
}

export interface BrowserSitesState {
  prefs: BrowserPrefs
  sites: Record<BrowserProduct, BrowserSite[]>
  denied: Record<BrowserProduct, string[]>
  localOrigins: string[]
  policyDisabled: boolean
}

export interface BrowserCapture {
  url: string
  title: string
  /** `image/jpeg`. */
  dataUrl: string
  width: number
  height: number
}

export interface BrowserToChat {
  owner: BrowserOwner
  text: string
  image?: { name: string; mime: 'image/jpeg'; dataUrl: string }
}

export interface BrowserInvokeContract {
  'browser:state': { req: { owner: BrowserOwner }; res: BrowserOwnerState }
  'browser:attach': { req: { owner: BrowserOwner; rect: BrowserRect; visible: boolean }; res: void }
  'browser:detach': { req: { owner: BrowserOwner }; res: void }
  'browser:newTab': { req: { owner: BrowserOwner; input?: string }; res: BrowserOwnerState }
  'browser:closeTab': { req: { owner: BrowserOwner; tabId: string }; res: BrowserOwnerState }
  'browser:selectTab': { req: { owner: BrowserOwner; tabId: string }; res: BrowserOwnerState }
  'browser:navigate': { req: { owner: BrowserOwner; tabId: string; input: string }; res: BrowserOwnerState }
  'browser:history': { req: { owner: BrowserOwner; tabId: string; action: 'back' | 'forward' | 'reload' | 'stop' }; res: void }
  'browser:agent': { req: { owner: BrowserOwner; action: 'pause' | 'resume' | 'stop' }; res: BrowserOwnerState }
  'browser:pick': { req: { owner: BrowserOwner; tabId: string; on: boolean }; res: void }
  'browser:capture': { req: { owner: BrowserOwner; tabId: string }; res: BrowserCapture }
  'browser:toChat': { req: BrowserToChat; res: void }
  'browser:respond': { req: { id: string; decision: BrowserDecision }; res: void }
  'browser:setViewMode': { req: { mode: BrowserViewMode }; res: void }
  'browser:popOut': { req: { owner: BrowserOwner; on: boolean }; res: BrowserOwnerState }
  'browser:openExternal': { req: { owner: BrowserOwner; tabId: string }; res: void }
  'browser:devServers': { req: { directory: string }; res: DevServerCandidate[] }
  'browser:sites:get': { req: void; res: BrowserSitesState }
  'browser:sites:setPrefs': { req: { agentEnabled?: { code?: boolean; tasks?: boolean } }; res: BrowserSitesState }
  'browser:sites:remove': { req: { product: BrowserProduct; site: string }; res: BrowserSitesState }
  'browser:sites:undeny': { req: { product: BrowserProduct; site: string }; res: BrowserSitesState }
  'browser:sites:removeLocal': { req: { origin: string }; res: BrowserSitesState }
  'browser:clearData': { req: { product: BrowserProduct }; res: BrowserSitesState }
}

export interface BrowserEventContract {
  'browser:state': BrowserOwnerState
  'browser:approval': BrowserApprovalRequest
  'browser:approvalDone': { id: string }
  'browser:picked': { owner: BrowserOwner; tabId: string; element: PickedElement }
  'browser:reveal': { owner: BrowserOwner; tabId: string; reason: 'agent' | 'approval' }
  'browser:shortcut': {
    owner: BrowserOwner
    key: 'focusUrl' | 'newTab' | 'closeTab' | 'reload' | 'back' | 'forward' | 'panel1' | 'panel2' | 'panel3' | 'panel4'
  }
  'browser:toChat': BrowserToChat
  'browser:sites': BrowserSitesState
}

export type BrowserInvokeChannel = keyof BrowserInvokeContract
export type BrowserEventChannel = keyof BrowserEventContract
export type BrowserRequest<C extends BrowserInvokeChannel> = BrowserInvokeContract[C]['req']
export type BrowserResponse<C extends BrowserInvokeChannel> = BrowserInvokeContract[C]['res']

export const BROWSER_INVOKE_CHANNELS = [
  'browser:state',
  'browser:attach',
  'browser:detach',
  'browser:newTab',
  'browser:closeTab',
  'browser:selectTab',
  'browser:navigate',
  'browser:history',
  'browser:agent',
  'browser:pick',
  'browser:capture',
  'browser:toChat',
  'browser:respond',
  'browser:popOut',
  'browser:setViewMode',
  'browser:openExternal',
  'browser:devServers',
  'browser:sites:get',
  'browser:sites:setPrefs',
  'browser:sites:remove',
  'browser:sites:undeny',
  'browser:sites:removeLocal',
  'browser:clearData'
] as const satisfies readonly BrowserInvokeChannel[]

export const BROWSER_EVENT_CHANNELS = [
  'browser:state',
  'browser:approval',
  'browser:approvalDone',
  'browser:picked',
  'browser:reveal',
  'browser:shortcut',
  'browser:toChat',
  'browser:sites'
] as const satisfies readonly BrowserEventChannel[]

type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
const _browserInvokeCoverage: Missing<BrowserInvokeChannel, (typeof BROWSER_INVOKE_CHANNELS)[number]> extends never ? true : never = true
const _browserEventCoverage: Missing<BrowserEventChannel, (typeof BROWSER_EVENT_CHANNELS)[number]> extends never ? true : never = true
void _browserInvokeCoverage
void _browserEventCoverage

/** Canales que puede invocar la ventana «Navegador» aparte (rol `browserHost`): ver B.4. */
export const BROWSER_HOST_EXCLUDED_CHANNELS = new Set<BrowserInvokeChannel>([
  'browser:sites:get',
  'browser:sites:setPrefs',
  'browser:sites:remove',
  'browser:sites:undeny',
  'browser:sites:removeLocal',
  'browser:clearData',
  'browser:devServers'
])

/** API expuesta en `window.api.browser`. Todos los métodos lanzan `Error` si main falla. */
export interface BrowserApi {
  invoke<C extends BrowserInvokeChannel>(
    channel: C,
    ...args: BrowserRequest<C> extends void ? [] : [req: BrowserRequest<C>]
  ): Promise<BrowserResponse<C>>
  on<C extends BrowserEventChannel>(channel: C, listener: (payload: BrowserEventContract[C]) => void): () => void
}
