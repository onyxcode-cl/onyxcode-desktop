/**
 * Orquestador del navegador integrado (Lote D, D1 paso 9): junta `surface.ts` (mecánica de la
 * pestaña), `cdp.ts`, `session.ts`, `store.ts`, `approvals.ts`, `downloads.ts`, `popout.ts` y
 * `dev-servers.ts`. Expone dos superficies:
 *
 * - `embeddedBrowser` (`EmbeddedBrowserApi`, B.5): lo usa el agente (D2, vía MCP).
 * - `browserService`: lo usa `browser-handlers.ts` (IPC del renderer, B.4).
 *
 * Política de atribución y aprobación por sitio (B.8): una navegación reactiva (clic, redirección)
 * en una pestaña con una concesión de agente activa cuenta como AGENTE salvo que haya habido
 * entrada humana real en la ventana `userActive` (`surface.isUserActive`); toda navegación que
 * nosotros mismos decidimos (barra de URL del usuario, o el agente tras aprobación) pasa por
 * `bypassOnce` para no volver a pedir aprobación sobre algo que ya se decidió.
 */
import { BrowserWindow, shell } from 'electron'
import type {
  BrowserApprovalRequest,
  BrowserCapture,
  BrowserDecision,
  BrowserOwner,
  BrowserProduct,
  BrowserRect,
  BrowserSitesState,
  BrowserTab,
  BrowserToChat,
  DevServerCandidate,
  PickedElement
} from '@shared/ipc-browser'
import type { BrowserEventChannel, BrowserEventContract } from '@shared/ipc-browser'
import type { OpencodeConnection } from '@shared/types'
import { loadManagedPolicy } from '../cowork/policy'
import { hostOf, siteOf } from '../browser/sites'
import { BrowserBusyError, type AgentActor, type AgentLease, type CdpSession, type EmbeddedBrowserApi } from './api'
import { cdpSessionFor } from './cdp'
import { findDevServers } from './dev-servers'
import { isLoopbackOrPrivateHost, sessionFor } from './session'
import { closePopout, ensurePopoutWindow, popoutWindow, showPopoutInactive } from './popout'
import { initApprovals, pendingFor, requestApproval, respondApproval } from './approvals'
import { initDownloads } from './downloads'
import * as store from './store'
import {
  allTabs,
  createTab,
  destroyTab,
  isUserActive,
  loadDirect,
  markAgentInputWindow,
  surfaceEvents,
  tabById,
  tabsForOwner,
  TabLimitError,
  type TabRuntime
} from './surface'

// ───────────────────────────── estado por owner ─────────────────────────────

interface OwnerRuntime {
  owner: BrowserOwner
  activeTabId: string | null
  agentTabId: string | null
  control: 'idle' | 'agent' | 'paused'
  agentSessionId: string | null
  agentLabel: string | null
  picking: boolean
  hostWindow: BrowserWindow | null
  attachedTo: BrowserWindow | null
  hostKind: 'panel' | 'popout' | 'none'
  rect: BrowserRect | null
  visible: boolean
  taskApprovedSites: Set<string>
  userVisitedHosts: Set<string>
  lastAgentActivityAt: number
}

const owners = new Map<string, OwnerRuntime>()

function ownerKeyOf(owner: BrowserOwner): string {
  return owner.kind === 'code' ? `code:${owner.directory}` : `cowork:${owner.folder}`
}

function ownerRuntime(owner: BrowserOwner): OwnerRuntime {
  const key = ownerKeyOf(owner)
  let rt = owners.get(key)
  if (!rt) {
    rt = {
      owner,
      activeTabId: null,
      agentTabId: null,
      control: 'idle',
      agentSessionId: null,
      agentLabel: null,
      picking: false,
      hostWindow: null,
      attachedTo: null,
      hostKind: 'none',
      rect: null,
      visible: false,
      taskApprovedSites: new Set(),
      userVisitedHosts: new Set(),
      lastAgentActivityAt: 0
    }
    owners.set(key, rt)
  }
  return rt
}

function agentEnabled(product: BrowserProduct): boolean {
  const policy = loadManagedPolicy()
  if (policy?.disableBrowser === true) return false
  return store.getPrefs().agentEnabled[product]
}

function disabledReasonFor(product: BrowserProduct): string | undefined {
  const policy = loadManagedPolicy()
  if (policy?.disableBrowser === true) return 'La organización desactivó el navegador integrado.'
  if (!store.getPrefs().agentEnabled[product]) return 'Activa "Permitir que el agente use el navegador" en Ajustes.'
  return undefined
}

// ───────────────────────────── deps de main/index.ts ─────────────────────────────

let getMainWindowFn: (() => BrowserWindow | null) | null = null
let getMainConnectionFn: (() => Promise<OpencodeConnection>) | null = null

function windowsToNotify(): BrowserWindow[] {
  const out: BrowserWindow[] = []
  const mw = getMainWindowFn?.()
  if (mw && !mw.isDestroyed()) out.push(mw)
  const pw = popoutWindow()
  if (pw && pw !== mw) out.push(pw)
  return out
}

function sendEvent<C extends BrowserEventChannel>(channel: C, payload: BrowserEventContract[C]): void {
  for (const w of windowsToNotify()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

function broadcastState(owner: BrowserOwner): void {
  sendEvent('browser:state', stateFor(owner))
}

// ───────────────────────────── proyección a los tipos del IPC ─────────────────────────────

function toBrowserTab(tab: TabRuntime): BrowserTab {
  const destroyed = tab.wc.isDestroyed()
  const url = destroyed ? '' : tab.wc.getURL()
  const secure = /^https:\/\//i.test(url) ? true : /^http:\/\//i.test(url) ? false : null
  return {
    id: tab.id,
    url,
    title: tab.title || url,
    loading: !destroyed && tab.wc.isLoading(),
    canGoBack: !destroyed && tab.wc.navigationHistory.canGoBack(),
    canGoForward: !destroyed && tab.wc.navigationHistory.canGoForward(),
    secure,
    openedBy: tab.openedBy,
    agentSelected: tab.agentSelected,
    crashed: tab.crashed || undefined
  }
}

function stateFor(owner: BrowserOwner) {
  const rt = ownerRuntime(owner)
  const tabs = tabsForOwner(owner)
  const active = rt.activeTabId ? tabById(rt.activeTabId) : null
  return {
    owner,
    tabs: tabs.map(toBrowserTab),
    activeTabId: rt.activeTabId,
    control: rt.control,
    agentSessionId: rt.agentSessionId,
    agentLabel: rt.agentLabel,
    userActive: !!active && isUserActive(active),
    picking: rt.picking,
    hostedIn: rt.hostKind,
    disabledReason: agentEnabled(owner.kind) ? undefined : disabledReasonFor(owner.kind)
  }
}

// ───────────────────────────── navegación: aprobación y atribución (B.8) ─────────────────────────────

/** Navegaciones que NOSOTROS ya decidimos (usuario en la barra de URL, o agente ya aprobado). */
const bypassOnce = new Set<string>()

async function navigateBypassing(tab: TabRuntime, url: string): Promise<void> {
  bypassOnce.add(tab.id)
  try {
    await loadDirect(tab, url)
  } finally {
    bypassOnce.delete(tab.id)
  }
}

interface ParsedNav {
  host: string
  site: string
  origin: string
  isLocal: boolean
}

function parseNav(url: string): ParsedNav | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const host = u.hostname.toLowerCase()
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    const originHost = host === '::1' ? '[::1]' : host
    return { host, site: siteOf(host), origin: `${originHost}:${port}`, isLocal: isLoopbackOrPrivateHost(host) }
  } catch {
    return null
  }
}

async function siteApprovalGate(rt: OwnerRuntime, tab: TabRuntime, url: string, parsed: ParsedNav): Promise<boolean> {
  const product = tab.owner.kind
  if (parsed.isLocal) {
    if (store.isLocalOriginApproved(parsed.origin)) return true
    const decision = await requestApproval({
      owner: tab.owner,
      sessionId: rt.agentSessionId ?? '',
      kind: 'local-origin',
      url,
      host: parsed.origin,
      site: parsed.site
    })
    if (decision === 'always' || decision === 'task') {
      store.approveLocalOrigin(parsed.origin)
      return true
    }
    return false
  }
  if (store.isSiteAllowed(product, parsed.site)) return true
  if (store.isSiteDenied(product, parsed.site)) return false
  const taskKey = `${rt.agentSessionId ?? ''}:${parsed.site}`
  if (rt.taskApprovedSites.has(taskKey)) return true
  if (rt.userVisitedHosts.has(parsed.host)) return true
  const decision: BrowserDecision = await requestApproval({
    owner: tab.owner,
    sessionId: rt.agentSessionId ?? '',
    kind: 'site',
    url,
    host: parsed.host,
    site: parsed.site
  })
  if (decision === 'always') {
    store.addSite(product, parsed.site)
    return true
  }
  if (decision === 'task') {
    rt.taskApprovedSites.add(taskKey)
    return true
  }
  if (decision === 'deny') store.denySite(product, parsed.site)
  return false
}

async function resolveNavigationApproval(tab: TabRuntime, url: string): Promise<void> {
  if (tab.destroyed) return
  const rt = ownerRuntime(tab.owner)
  const parsed = parseNav(url)
  if (!parsed) return // esquema ya filtrado por surface.ts (about:blank, etc.): nada que aprobar
  const attributedToUser = rt.control !== 'agent' || isUserActive(tab)
  if (attributedToUser) {
    rt.userVisitedHosts.add(parsed.host)
    await navigateBypassing(tab, url)
    return
  }
  const ok = await siteApprovalGate(rt, tab, url, parsed)
  if (ok) await navigateBypassing(tab, url)
  else console.warn(`[embedded-browser] navegación de agente denegada: ${parsed.site}`)
}

function installNavigationGate(tab: TabRuntime): void {
  const handle = (url: string, isMainFrame: boolean, prevent: () => void): void => {
    if (!isMainFrame) return
    if (bypassOnce.has(tab.id)) return // el listener de surface.ts ya validó el esquema; dejamos pasar
    prevent()
    void resolveNavigationApproval(tab, url)
  }
  tab.wc.on('will-frame-navigate', (d) => handle(d.url, d.isMainFrame, () => d.preventDefault()))
  tab.wc.on('will-redirect', (d) => handle(d.url, d.isMainFrame, () => d.preventDefault()))
}

function waitForLoad(tab: TabRuntime, timeoutMs: number): Promise<void> {
  if (tab.wc.isDestroyed() || !tab.wc.isLoading()) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      tab.wc.removeListener('did-finish-load', done)
      tab.wc.removeListener('did-fail-load', done)
      tab.wc.removeListener('did-stop-loading', done)
      resolve()
    }
    const timer = setTimeout(done, Math.max(1_000, timeoutMs))
    tab.wc.once('did-finish-load', done)
    tab.wc.once('did-fail-load', done)
    tab.wc.once('did-stop-loading', done)
  })
}

// ───────────────────────────── alojamiento (bounds × zoom, B.1/A.5) ─────────────────────────────

function ensureActiveTab(owner: BrowserOwner): TabRuntime | null {
  const rt = ownerRuntime(owner)
  if (rt.activeTabId) {
    const existing = tabById(rt.activeTabId)
    if (existing) return existing
  }
  const first = tabsForOwner(owner)[0]
  if (first) {
    rt.activeTabId = first.id
    return first
  }
  try {
    const tab = createTab(owner, { openedBy: 'user' })
    rt.activeTabId = tab.id
    return tab
  } catch (err) {
    console.error('[embedded-browser] no se pudo crear la pestaña inicial:', err)
    return null
  }
}

function layoutView(rt: OwnerRuntime): void {
  const tab = rt.activeTabId ? tabById(rt.activeTabId) : null
  if (!tab) return
  const win = rt.hostWindow
  const shouldShow = !!win && !win.isDestroyed() && rt.visible
  if (!shouldShow) {
    if (rt.attachedTo && !rt.attachedTo.isDestroyed()) {
      try {
        rt.attachedTo.contentView.removeChildView(tab.view)
      } catch (err) {
        console.error('[embedded-browser] removeChildView:', err)
      }
    }
    rt.attachedTo = null
    return
  }
  const hostWin = win as BrowserWindow
  if (rt.attachedTo !== hostWin) {
    if (rt.attachedTo && !rt.attachedTo.isDestroyed()) {
      try {
        rt.attachedTo.contentView.removeChildView(tab.view)
      } catch (err) {
        console.error('[embedded-browser] removeChildView (reubicación):', err)
      }
    }
    hostWin.contentView.addChildView(tab.view)
    rt.attachedTo = hostWin
  }
  const rect = rt.rect ?? { x: 0, y: 0, width: 0, height: 0 }
  const zoom = hostWin.webContents.getZoomFactor() || 1
  tab.view.setBounds({
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom)
  })
  tab.view.setVisible(true)
}

/**
 * Empuja el `owner` a la ventana «Navegador» aparte por `browser:state` (la página no lo recibe
 * por la URL: la ventana es única y se reutiliza para el owner que la pida cada vez). Si acaba de
 * crearse, espera a que termine de cargar; si ya existía, se manda de inmediato.
 */
function pushOwnerToPopout(win: BrowserWindow, owner: BrowserOwner): void {
  const push = (): void => {
    if (!win.isDestroyed()) win.webContents.send('browser:state', stateFor(owner))
  }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', push)
  else push()
}

/** La ventana principal está minimizada/oculta: abre la ventana «Navegador» sin robar el foco (A.5). */
function ensureHostForAgent(owner: BrowserOwner): void {
  const mw = getMainWindowFn?.()
  const mainHidden = !mw || mw.isDestroyed() || mw.isMinimized() || !mw.isVisible()
  if (!mainHidden) return
  const rt = ownerRuntime(owner)
  if (rt.hostKind === 'popout' && rt.visible) return
  const win = showPopoutInactive()
  pushOwnerToPopout(win, owner)
  sendEvent('browser:reveal', { owner, tabId: rt.activeTabId ?? '', reason: 'agent' })
}

// ───────────────────────────── entrada humana / normalización de URL ─────────────────────────────

function normalizeInput(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(trimmed)) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

// ───────────────────────────── API del agente (`EmbeddedBrowserApi`, B.5) ─────────────────────────────

function requireOwnerMatch(actor: AgentActor, tabId: string): TabRuntime {
  const tab = tabById(tabId)
  if (!tab || tab.destroyed) throw new Error('La pestaña ya no existe')
  if (ownerKeyOf(tab.owner) !== ownerKeyOf(actor.owner)) throw new Error('La pestaña no pertenece a esta tarea')
  return tab
}

function assertAgentEnabled(product: BrowserProduct): void {
  if (!agentEnabled(product)) {
    throw new BrowserBusyError('disabled', 'El navegador del agente está desactivado. Actívalo en Ajustes → Navegador.')
  }
}

function beginAgentAction(actor: AgentActor, tabId: string, kind: 'read' | 'input'): AgentLease {
  assertAgentEnabled(actor.product)
  const rt = ownerRuntime(actor.owner)
  if (rt.control === 'paused') throw new BrowserBusyError('paused', 'El usuario pausó el navegador.')
  if (rt.agentSessionId && rt.agentSessionId !== actor.sessionId && Date.now() - rt.lastAgentActivityAt < 60_000) {
    throw new BrowserBusyError('otherTask', 'Otra tarea está usando el navegador ahora mismo; espera un momento.')
  }
  const tab = requireOwnerMatch(actor, tabId)
  if (kind === 'input' && isUserActive(tab)) {
    throw new BrowserBusyError('userActive', 'El usuario está usando el navegador; espera o pregúntale.')
  }
  ensureHostForAgent(actor.owner)
  rt.control = 'agent'
  rt.agentSessionId = actor.sessionId
  rt.agentLabel = actor.label ?? rt.agentLabel
  rt.agentTabId = tab.id
  tab.agentSelected = true
  rt.lastAgentActivityAt = Date.now()
  broadcastState(actor.owner)
  let released = false
  return {
    tabId: tab.id,
    release: () => {
      if (released) return
      released = true
      rt.lastAgentActivityAt = Date.now()
    }
  }
}

async function navigateAsAgent(actor: AgentActor, tabId: string, url: string, timeoutMs: number): Promise<{ url: string; title: string }> {
  assertAgentEnabled(actor.product)
  const tab = requireOwnerMatch(actor, tabId)
  const rt = ownerRuntime(actor.owner)
  if (rt.control === 'paused') throw new BrowserBusyError('paused', 'El usuario pausó el navegador.')
  ensureHostForAgent(actor.owner)
  rt.control = 'agent'
  rt.agentSessionId = actor.sessionId
  rt.lastAgentActivityAt = Date.now()
  const parsed = parseNav(url)
  if (!parsed) throw new Error(`URL inválida o esquema no permitido: ${url.slice(0, 200)}`)
  const allowed = await siteApprovalGate(rt, tab, url, parsed)
  if (!allowed) throw new Error(`El usuario no permitió abrir «${parsed.site}».`)
  await navigateBypassing(tab, url)
  await waitForLoad(tab, timeoutMs)
  return { url: tab.wc.isDestroyed() ? url : tab.wc.getURL(), title: tab.title }
}

async function openTabAsAgent(actor: AgentActor, url: string, timeoutMs: number): Promise<string> {
  assertAgentEnabled(actor.product)
  const rt = ownerRuntime(actor.owner)
  if (rt.control === 'paused') throw new BrowserBusyError('paused', 'El usuario pausó el navegador.')
  let tab: TabRuntime
  try {
    tab = createTab(actor.owner, { openedBy: 'agent' })
  } catch (err) {
    if (err instanceof TabLimitError) throw err
    throw err
  }
  rt.activeTabId = tab.id
  // La pestaña recién abierta queda seleccionada para el agente (B.5/B.6: `new_page` "la selecciona"),
  // igual que hace `beginAgentAction`/`selectAgentTab`. Sin esto, `requireTab()` (tools.ts) no
  // encuentra ninguna pestaña "seleccionada" tras `new_page` y cualquier herramienta posterior
  // (take_snapshot, click, fill…) falla con «No hay ninguna pestaña seleccionada» (bug encontrado
  // en D5 al probar contra la EmbeddedBrowserApi real en vez de la de prueba de D2).
  rt.agentTabId = tab.id
  tab.agentSelected = true
  layoutView(rt)
  try {
    await navigateAsAgent(actor, tab.id, url, timeoutMs)
  } catch (err) {
    destroyTab(tab)
    throw err
  }
  return tab.id
}

async function historyAsAgent(
  actor: AgentActor,
  tabId: string,
  a: 'back' | 'forward' | 'reload',
  timeoutMs: number
): Promise<{ url: string; title: string }> {
  assertAgentEnabled(actor.product)
  const tab = requireOwnerMatch(actor, tabId)
  const rt = ownerRuntime(actor.owner)
  if (rt.control === 'paused') throw new BrowserBusyError('paused', 'El usuario pausó el navegador.')
  ensureHostForAgent(actor.owner)
  rt.control = 'agent'
  rt.agentSessionId = actor.sessionId
  rt.lastAgentActivityAt = Date.now()
  const nav = tab.wc.navigationHistory
  bypassOnce.add(tab.id) // ya visitado antes (aprobado); no se vuelve a preguntar
  try {
    if (a === 'back' && nav.canGoBack()) nav.goBack()
    else if (a === 'forward' && nav.canGoForward()) nav.goForward()
    else if (a === 'reload') tab.wc.reload()
  } finally {
    setTimeout(() => bypassOnce.delete(tab.id), 2_000)
  }
  await waitForLoad(tab, timeoutMs)
  return { url: tab.wc.isDestroyed() ? '' : tab.wc.getURL(), title: tab.title }
}

function closeTabAsAgent(actor: AgentActor, tabId: string): void {
  const tab = requireOwnerMatch(actor, tabId)
  if (tab.openedBy !== 'agent') throw new Error('Solo se pueden cerrar pestañas que abrió el agente.')
  const rt = ownerRuntime(actor.owner)
  destroyTab(tab)
  if (rt.activeTabId === tabId) rt.activeTabId = tabsForOwner(actor.owner)[0]?.id ?? null
  if (rt.agentTabId === tabId) rt.agentTabId = null
  layoutView(rt)
  broadcastState(actor.owner)
}

function selectAgentTab(actor: AgentActor, tabId: string): void {
  requireOwnerMatch(actor, tabId)
  const rt = ownerRuntime(actor.owner)
  for (const t of tabsForOwner(actor.owner)) t.agentSelected = t.id === tabId
  rt.agentTabId = tabId
  rt.activeTabId = tabId
  layoutView(rt)
  broadcastState(actor.owner)
}

async function verifyAfterAction(actor: AgentActor, tabId: string): Promise<string | null> {
  const tab = tabById(tabId)
  if (!tab || tab.destroyed) return 'La pestaña ya no existe.'
  const parsed = parseNav(tab.wc.getURL())
  if (!parsed) return null
  const rt = ownerRuntime(actor.owner)
  if (parsed.isLocal) {
    if (store.isLocalOriginApproved(parsed.origin)) return null
    await navigateBypassing(tab, 'about:blank')
    return `Se bloqueó ${parsed.origin}: no es un origen local aprobado.`
  }
  const taskKey = `${rt.agentSessionId ?? ''}:${parsed.site}`
  const ok = store.isSiteAllowed(actor.product, parsed.site) || rt.taskApprovedSites.has(taskKey) || rt.userVisitedHosts.has(parsed.host)
  if (ok) return null
  if (tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack()
  else await navigateBypassing(tab, 'about:blank')
  return `Se bloqueó ${parsed.site}: el usuario no lo ha permitido.`
}

async function confirmSensitive(actor: AgentActor, tabId: string, summary: string): Promise<boolean> {
  const tab = requireOwnerMatch(actor, tabId)
  const url = tab.wc.isDestroyed() ? '' : tab.wc.getURL()
  const host = hostOf(url) ?? ''
  const decision = await requestApproval({
    owner: actor.owner,
    sessionId: actor.sessionId,
    kind: 'sensitive',
    url,
    host,
    site: host ? siteOf(host) : '',
    summary
  })
  return decision === 'allow'
}

async function cdp(tabId: string): Promise<CdpSession> {
  const tab = tabById(tabId)
  if (!tab || tab.destroyed) throw new Error('La pestaña ya no existe')
  return cdpSessionFor(tab.wc, { onInputSent: () => markAgentInputWindow(tab.id) })
}

function webContentsOf(tabId: string) {
  return tabById(tabId)?.wc ?? null
}

async function capture(tabId: string, maxLongSide: number): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const tab = tabById(tabId)
  if (!tab || tab.destroyed) throw new Error('La pestaña ya no existe')
  // D0 corrección 1: NUNCA `webContents.capturePage` (cuelga si la vista no está visible). Siempre CDP.
  const session = await cdp(tabId)
  const metrics = await session.send<{ contentSize: { width: number; height: number } }>('Page.getLayoutMetrics')
  const cw = Math.max(1, Math.round(metrics.contentSize.width))
  const ch = Math.max(1, Math.round(metrics.contentSize.height))
  const scale = Math.min(1, maxLongSide / Math.max(cw, ch))
  const res = await session.send<{ data: string }>('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 80,
    clip: { x: 0, y: 0, width: cw, height: ch, scale }
  })
  return { jpeg: Buffer.from(res.data, 'base64'), width: Math.round(cw * scale), height: Math.round(ch * scale) }
}

function init(deps: { getMainWindow(): BrowserWindow | null; getMainConnection(): Promise<OpencodeConnection> }): void {
  getMainWindowFn = deps.getMainWindow
  getMainConnectionFn = deps.getMainConnection

  initApprovals({
    hasVisibleHost: (owner) => {
      const rt = ownerRuntime(owner)
      return rt.visible && rt.hostKind !== 'none'
    },
    broadcastApproval: (req) => sendEvent('browser:approval', req),
    broadcastApprovalDone: (id) => sendEvent('browser:approvalDone', { id })
  })

  initDownloads({
    attributionFor: (owner) => {
      const rt = ownerRuntime(owner)
      const active = rt.activeTabId ? tabById(rt.activeTabId) : null
      const agent = rt.control === 'agent' && !(active && isUserActive(active))
      return { agent, sessionId: rt.agentSessionId }
    }
  })

  surfaceEvents.on('created', (tab: TabRuntime) => installNavigationGate(tab))
  surfaceEvents.on('updated', (tab: TabRuntime) => broadcastState(tab.owner))
  surfaceEvents.on('crashed', (tab: TabRuntime) => broadcastState(tab.owner))
  surfaceEvents.on('destroyed', (tab: TabRuntime) => broadcastState(tab.owner))
  surfaceEvents.on('shortcut', (tab: TabRuntime, key: string) =>
    sendEvent('browser:shortcut', { owner: tab.owner, key: key as never })
  )
}

async function mainConnection(): Promise<OpencodeConnection> {
  if (!getMainConnectionFn) throw new Error('embeddedBrowser no está inicializado')
  return getMainConnectionFn()
}

export const embeddedBrowser: EmbeddedBrowserApi = {
  init,
  mainConnection,
  listTabs: (owner) => tabsForOwner(owner).map(toBrowserTab),
  agentTabId: (owner) => ownerRuntime(owner).agentTabId,
  selectAgentTab,
  closeTabAsAgent,
  openTabAsAgent,
  navigateAsAgent,
  historyAsAgent,
  beginAgentAction,
  verifyAfterAction,
  confirmSensitive,
  cdp,
  webContentsOf,
  capture,
  agentEnabled
}

// ───────────────────────────── API de la UI (`browser-handlers.ts`, B.4) ─────────────────────────────

export function getOwnerState(owner: BrowserOwner) {
  return stateFor(owner)
}

export function attachView(owner: BrowserOwner, hostWindow: BrowserWindow, rect: BrowserRect, visible: boolean): void {
  const rt = ownerRuntime(owner)
  rt.hostWindow = hostWindow
  rt.hostKind = hostWindow === popoutWindow() ? 'popout' : 'panel'
  rt.rect = rect
  rt.visible = visible
  ensureActiveTab(owner)
  layoutView(rt)
}

export function detachView(owner: BrowserOwner): void {
  const rt = ownerRuntime(owner)
  rt.visible = false
  layoutView(rt)
}

export function newTab(owner: BrowserOwner, input?: string) {
  const rt = ownerRuntime(owner)
  try {
    const tab = createTab(owner, { openedBy: 'user' })
    rt.activeTabId = tab.id
    if (input) {
      const url = normalizeInput(input)
      const host = hostOf(url)
      if (host) rt.userVisitedHosts.add(host)
      void navigateBypassing(tab, url).catch((err) => console.error('[embedded-browser] newTab:', err))
    }
    layoutView(rt)
  } catch (err) {
    console.error('[embedded-browser] newTab:', err)
  }
  return stateFor(owner)
}

export function closeTab(owner: BrowserOwner, tabId: string) {
  const tab = tabById(tabId)
  const rt = ownerRuntime(owner)
  if (tab && ownerKeyOf(tab.owner) === ownerKeyOf(owner)) {
    destroyTab(tab)
    if (rt.activeTabId === tabId) rt.activeTabId = tabsForOwner(owner)[0]?.id ?? null
    if (rt.agentTabId === tabId) rt.agentTabId = null
    layoutView(rt)
  }
  return stateFor(owner)
}

export function selectTab(owner: BrowserOwner, tabId: string) {
  const rt = ownerRuntime(owner)
  if (tabById(tabId)) rt.activeTabId = tabId
  layoutView(rt)
  return stateFor(owner)
}

export async function navigate(owner: BrowserOwner, tabId: string, input: string) {
  const tab = tabById(tabId)
  if (tab) {
    const url = normalizeInput(input)
    const rt = ownerRuntime(owner)
    const host = hostOf(url)
    if (host) rt.userVisitedHosts.add(host)
    await navigateBypassing(tab, url).catch((err) => console.error('[embedded-browser] navigate:', err))
  }
  return stateFor(owner)
}

export function history(owner: BrowserOwner, tabId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void {
  const tab = tabById(tabId)
  if (!tab) return
  const nav = tab.wc.navigationHistory
  if (action === 'stop') {
    tab.wc.stop()
    return
  }
  bypassOnce.add(tab.id)
  if (action === 'back' && nav.canGoBack()) nav.goBack()
  else if (action === 'forward' && nav.canGoForward()) nav.goForward()
  else if (action === 'reload') tab.wc.reload()
  setTimeout(() => bypassOnce.delete(tab.id), 2_000)
  const host = hostOf(tab.wc.getURL())
  if (host) ownerRuntime(owner).userVisitedHosts.add(host)
}

export function agentControl(owner: BrowserOwner, action: 'pause' | 'resume' | 'stop') {
  const rt = ownerRuntime(owner)
  if (action === 'pause' || action === 'stop') rt.control = 'paused'
  else rt.control = rt.agentSessionId ? 'agent' : 'idle'
  if (action === 'stop') rt.agentSessionId = null
  broadcastState(owner)
  return stateFor(owner)
}

interface PickedElementRaw {
  tag: string
  role?: string
  name?: string
  text?: string
  html: string
  rect: { x: number; y: number; width: number; height: number }
}

export async function setPicking(owner: BrowserOwner, tabId: string, on: boolean): Promise<void> {
  const tab = tabById(tabId)
  if (!tab) return
  const rt = ownerRuntime(owner)
  rt.picking = on
  try {
    const session = await cdp(tabId)
    if (!on) {
      await session.send('Overlay.setInspectMode', { mode: 'none' }).catch(() => undefined)
      broadcastState(owner)
      return
    }
    await session.send('DOM.enable')
    await session.send('Overlay.enable')
    let off: (() => void) | null = null
    off = session.on('Overlay.inspectNodeRequested', (params) => {
      void handleInspectNodeRequested(owner, tab, session, params)
        .catch((err) => console.error('[embedded-browser] elemento elegido:', err))
        .finally(() => {
          off?.()
          rt.picking = false
          void session.send('Overlay.setInspectMode', { mode: 'none' }).catch(() => undefined)
          broadcastState(owner)
        })
    })
    await session.send('Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: { contentColor: { r: 76, g: 128, b: 230, a: 0.25 }, showInfo: true }
    })
  } catch (err) {
    console.error('[embedded-browser] Seleccionar elemento:', err)
    rt.picking = false
  }
  broadcastState(owner)
}

async function handleInspectNodeRequested(owner: BrowserOwner, tab: TabRuntime, session: CdpSession, params: unknown): Promise<void> {
  const backendNodeId = (params as { backendNodeId?: number }).backendNodeId
  if (typeof backendNodeId !== 'number') return
  const worldId = await session.isolatedContext()
  const resolved = await session.send<{ object: { objectId: string } }>('DOM.resolveNode', {
    backendNodeId,
    executionContextId: worldId
  })
  const fn = `function() {
    var r = this.getBoundingClientRect();
    return {
      tag: this.tagName.toLowerCase(),
      role: this.getAttribute('role') || undefined,
      name: this.getAttribute('aria-label') || this.title || undefined,
      text: (this.innerText || '').slice(0, 500),
      html: this.outerHTML ? this.outerHTML.slice(0, 2000) : '',
      rect: { x: r.x, y: r.y, width: r.width, height: r.height }
    };
  }`
  const result = await session.send<{ result: { value: PickedElementRaw } }>('Runtime.callFunctionOn', {
    objectId: resolved.object.objectId,
    functionDeclaration: fn,
    returnByValue: true
  })
  await session.send('Runtime.releaseObject', { objectId: resolved.object.objectId }).catch(() => undefined)
  const raw = result.result.value
  const element: PickedElement = {
    tag: raw.tag,
    role: raw.role,
    name: raw.name,
    text: raw.text,
    selector: raw.tag,
    html: raw.html,
    rect: raw.rect,
    url: tab.wc.isDestroyed() ? '' : tab.wc.getURL()
  }
  sendEvent('browser:picked', { owner, tabId: tab.id, element })
}

export async function captureForUi(_owner: BrowserOwner, tabId: string): Promise<BrowserCapture> {
  const tab = tabById(tabId)
  if (!tab) throw new Error('La pestaña ya no existe')
  const { jpeg, width, height } = await capture(tabId, 1600)
  return {
    url: tab.wc.isDestroyed() ? '' : tab.wc.getURL(),
    title: tab.title,
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width,
    height
  }
}

export function toChat(payload: BrowserToChat): void {
  const mw = getMainWindowFn?.()
  if (mw && !mw.isDestroyed()) mw.webContents.send('browser:toChat', payload)
}

export function respond(id: string, decision: BrowserDecision): void {
  respondApproval(id, decision)
}

export function pendingApprovalsFor(owner: BrowserOwner): BrowserApprovalRequest[] {
  return pendingFor(owner)
}

export async function popOut(owner: BrowserOwner, on: boolean) {
  const rt = ownerRuntime(owner)
  if (on) {
    const win = ensurePopoutWindow()
    pushOwnerToPopout(win, owner)
    win.show()
  } else {
    closePopout()
    if (rt.hostKind === 'popout') rt.hostKind = 'none'
  }
  return stateFor(owner)
}

export function openExternalTab(_owner: BrowserOwner, tabId: string): void {
  const tab = tabById(tabId)
  if (!tab) return
  const url = tab.wc.isDestroyed() ? '' : tab.wc.getURL()
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

export async function devServersFor(directory: string): Promise<DevServerCandidate[]> {
  return findDevServers(directory)
}

// ───────────────────────────── Ajustes → Navegador (B.10) ─────────────────────────────

export function sitesState(): BrowserSitesState {
  const policy = loadManagedPolicy()
  return {
    prefs: store.getPrefs(),
    sites: { code: store.sitesFor('code'), cowork: store.sitesFor('cowork') },
    denied: { code: store.deniedFor('code'), cowork: store.deniedFor('cowork') },
    localOrigins: store.localOrigins(),
    policyDisabled: policy?.disableBrowser === true
  }
}

function broadcastSites(): BrowserSitesState {
  const s = sitesState()
  sendEvent('browser:sites', s)
  return s
}

export function setSitesPrefs(patch: { agentEnabled?: { code?: boolean; cowork?: boolean } }): BrowserSitesState {
  store.setPrefs(patch)
  return broadcastSites()
}

export function removeSiteFor(product: BrowserProduct, site: string): BrowserSitesState {
  store.removeSite(product, site)
  return broadcastSites()
}

export function undenySiteFor(product: BrowserProduct, site: string): BrowserSitesState {
  store.undenySite(product, site)
  return broadcastSites()
}

export function removeLocalOriginFor(origin: string): BrowserSitesState {
  store.removeLocalOrigin(origin)
  return broadcastSites()
}

/** `before-quit` (D0 corrección 5): cierra la ventana aparte y limpia vista+debugger de cada pestaña. */
export function shutdown(): void {
  for (const tab of allTabs()) destroyTab(tab)
  closePopout()
}

export function clearProductData(product: BrowserProduct): BrowserSitesState {
  store.clearProductData(product)
  const ses = sessionFor(product)
  void ses.clearStorageData().catch((err) => console.error('[embedded-browser] clearStorageData:', err))
  return broadcastSites()
}
