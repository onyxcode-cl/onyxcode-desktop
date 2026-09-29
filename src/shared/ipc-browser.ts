/**
 * Contrato IPC del navegador integrado (Lote D, B.4): familia propia como `ipc-extras`, con
 * canales `browser:*`. Se registra en `src/main/ipc/browser-handlers.ts` y se expone en el
 * preload como `window.api.browser` (`src/preload/browser-api.ts` / `browser-host.ts`).
 */
import type { BrowserSite } from './ipc-tasks'

export type BrowserProduct = 'code' | 'tasks'

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

export interface PickedElement {
  tag: string
  role?: string
  name?: string
  text?: string
  selector: string
  html: string
  rect: BrowserRect
  url: string
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
