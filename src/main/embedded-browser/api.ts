/**
 * API interna de main del navegador integrado (Lote D, B.5). Es el CONTRATO que D2 (herramientas
 * del agente / MCP) usa para actuar sobre las pestañas; la implementación real vive en
 * `service.ts` (variable `embeddedBrowser`, importada allí — este archivo no la implementa).
 *
 * Lista blanca de CDP (B.6): `cdp.ts` nunca envía un método fuera de `ALLOWED_CDP`. A propósito
 * NO incluye `Network.getCookies`/`getAllCookies`/`setCookie`, `Storage.*`, `Target.*`,
 * `Browser.*`, `Fetch.*`, `DOM.setFileInputFiles`, `Page.addScriptToEvaluateOnNewDocument`,
 * `Emulation.*`, `Security.*` ni `Page.setDownloadBehavior`.
 */
import type { BrowserWindow, WebContents } from 'electron'
import type { BrowserOwner, BrowserProduct, BrowserTab } from '@shared/ipc-browser'
import type { OpencodeConnection } from '@shared/types'

/** Identidad del agente que actúa, derivada de `onyxcode_session` en el MCP (ver B.6/B.7). */
export interface AgentActor {
  sessionId: string
  product: BrowserProduct
  owner: BrowserOwner
  sandboxed: boolean
  label?: string
}

/** Concesión de una acción del agente sobre una pestaña. Liberar siempre en un `finally`. */
export interface AgentLease {
  tabId: string
  release(): void
}

/** Por qué el agente no puede actuar ahora mismo (B.6, guarda 3). */
export class BrowserBusyError extends Error {
  readonly reason: 'paused' | 'userActive' | 'otherTask' | 'disabled' | 'stopped'
  constructor(reason: BrowserBusyError['reason'], message: string) {
    super(message)
    this.reason = reason
    this.name = 'BrowserBusyError'
  }
}

/** Lista blanca de métodos CDP (page-level) que `cdp.ts` puede enviar. Ver B.6. */
export const ALLOWED_CDP = [
  'Page.enable',
  'Page.captureScreenshot',
  'Page.getLayoutMetrics',
  'Page.handleJavaScriptDialog',
  'Page.createIsolatedWorld',
  'Page.getFrameTree',
  'DOM.enable',
  'DOM.getDocument',
  'DOM.describeNode',
  'DOM.resolveNode',
  'DOM.getContentQuads',
  'DOM.getBoxModel',
  'DOM.scrollIntoViewIfNeeded',
  'DOM.getNodeForLocation',
  'DOM.focus',
  'Accessibility.enable',
  'Accessibility.getFullAXTree',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Runtime.enable',
  'Runtime.callFunctionOn',
  'Runtime.evaluate',
  'Runtime.releaseObject',
  'Overlay.enable',
  'Overlay.setInspectMode',
  'Overlay.highlightNode',
  'Overlay.hideHighlight',
  'Log.enable',
  'Network.enable',
  'Network.getResponseBody'
] as const satisfies readonly string[]

export type AllowedCdpMethod = (typeof ALLOWED_CDP)[number]

/** Sesión CDP de una pestaña (`webContents.debugger`). Ver `cdp.ts`. */
export interface CdpSession {
  send<T = unknown>(method: AllowedCdpMethod, params?: object, timeoutMs?: number): Promise<T>
  on(event: string, fn: (params: any) => void): () => void
  /** Mundo aislado del frame principal (crea uno si no existe todavía, vía `Page.createIsolatedWorld`). */
  isolatedContext(): Promise<number>
}

export interface EmbeddedBrowserApi {
  init(deps: { getMainWindow(): BrowserWindow | null; getMainConnection(): Promise<OpencodeConnection> }): void
  mainConnection(): Promise<OpencodeConnection>
  listTabs(owner: BrowserOwner): BrowserTab[]
  agentTabId(owner: BrowserOwner): string | null
  selectAgentTab(actor: AgentActor, tabId: string): void
  /** Solo pestañas con `openedBy: 'agent'`. */
  closeTabAsAgent(actor: AgentActor, tabId: string): void
  openTabAsAgent(actor: AgentActor, url: string, timeoutMs: number): Promise<string /* tabId */>
  navigateAsAgent(actor: AgentActor, tabId: string, url: string, timeoutMs: number): Promise<{ url: string; title: string }>
  historyAsAgent(
    actor: AgentActor,
    tabId: string,
    a: 'back' | 'forward' | 'reload',
    timeoutMs: number
  ): Promise<{ url: string; title: string }>
  /** Lanza `BrowserBusyError` si el owner está pausado, ocupado por otra tarea o el usuario está activo. */
  beginAgentAction(actor: AgentActor, tabId: string, kind: 'read' | 'input'): AgentLease
  /** Respaldo tras cada acción: host no permitido → about:blank/atrás + texto de error. */
  verifyAfterAction(actor: AgentActor, tabId: string): Promise<string | null>
  confirmSensitive(actor: AgentActor, tabId: string, summary: string): Promise<boolean>
  cdp(tabId: string): Promise<CdpSession>
  webContentsOf(tabId: string): WebContents | null
  capture(tabId: string, maxLongSide: number): Promise<{ jpeg: Buffer; width: number; height: number }>
  /** `prefs.agentEnabled[product] && !policy.disableBrowser`. */
  agentEnabled(product: BrowserProduct): boolean
}

/**
 * Contrato ambiental: la implementación real es `service.ts` (`export const embeddedBrowser`).
 * Nadie importa el VALOR desde este archivo — solo el tipo `EmbeddedBrowserApi`, `ALLOWED_CDP` y
 * `AllowedCdpMethod` — para poder tipar contra la API antes de que `service.ts` exista.
 */
export declare const embeddedBrowser: EmbeddedBrowserApi
