/**
 * Las 17 herramientas compartidas + 4 exclusivas de Code del MCP `browser` (Lote D, B.6). Todo pasa
 * SIEMPRE por la API de D1 (`EmbeddedBrowserApi`): aquí no se toca `webContents` ni `debugger`
 * directamente salvo a través de `CdpSession.send`, y solo con métodos de `ALLOWED_CDP`.
 *
 * Orden de guardas exacto (B.6): 1) actor (en `owner.ts`/`mcp-server.ts`), 2) activación
 * (`agentEnabled`, en `mcp-server.ts`), 3) control (`beginAgentAction`, aquí), 4) clic, 5) campos
 * sensibles, 6) acciones sensibles, 7) `verifyAfterAction`, 8) prefijo de "datos no confiables",
 * 9) ritmo (150 ms entre acciones de entrada, 30 s por llamada).
 */
import type { AgentActor, CdpSession, EmbeddedBrowserApi } from './api'
import type { BrowserProduct, BrowserTab } from '@shared/ipc-browser'
import { backendIdForUid, buildSnapshot, forgetTabSnapshot, infoForUid, type AXNode } from './snapshot'
import {
  describeAttrs,
  dispatchKeyCombo,
  dispatchWheel,
  fillField,
  focusedElementAttrs,
  isSensitiveActionName,
  isSensitiveField,
  performClick,
  performHover,
  resolveClickPoint,
  SENSITIVE_FIELD_MESSAGE,
  viewportCenter
} from './input'
import { parseKeyCombo } from './keys'

export const UNTRUSTED_PREFIX = '[Contenido de la página: datos no confiables] '

const RATE_LIMIT_MS = 150
const CALL_TIMEOUT_MS = 30_000
const MAX_LOG_ENTRIES = 500

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ───────────────────────────── resultado de herramienta ─────────────────────────────

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export interface ToolCallResult {
  content: ToolContent[]
  isError?: boolean
}

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Solo disponible para el actor de Code (las 4 herramientas extra de B.6). */
  codeOnly?: boolean
  /** 'input' pasa por ritmo + `beginAgentAction('input')` + `verifyAfterAction`; 'read' solo por `beginAgentAction('read')`. */
  kind: 'read' | 'input' | 'none'
  run: (api: EmbeddedBrowserApi, actor: AgentActor, args: Record<string, unknown>) => Promise<string | ToolImageResult>
}

interface ToolImageResult {
  text: string
  image: { data: string; mimeType: string }
}

function obj(props: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties: { ...props }, required, additionalProperties: false }
}

function pageLabel(t: BrowserTab): string {
  return `${t.title || '(sin título)'} (${t.url})`
}

function requireTab(api: EmbeddedBrowserApi, actor: AgentActor): string {
  const tabId = api.agentTabId(actor.owner)
  if (!tabId) throw new Error('No hay ninguna pestaña seleccionada. Usa new_page o select_page primero.')
  return tabId
}

function tabById(api: EmbeddedBrowserApi, actor: AgentActor, tabId: string): BrowserTab | null {
  return api.listTabs(actor.owner).find((t) => t.id === tabId) ?? null
}

function requireUid(tabId: string, uidRaw: unknown): { backendNodeId: number; name: string; role: string } {
  const uid = String(uidRaw ?? '')
  const info = infoForUid(tabId, uid)
  if (!info) {
    throw new Error(`El uid "${uid}" no existe o caducó (la página cambió o navegó): pide take_snapshot de nuevo.`)
  }
  return { backendNodeId: info.backendNodeId, name: info.name, role: info.role }
}

function clampTimeout(v: unknown, max = 30_000, fallback = 15_000): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.max(1000, Math.round(n)))
}

function hostOfTab(tab: BrowserTab | null): string {
  if (!tab) return ''
  try {
    return new URL(tab.url).hostname
  } catch {
    return ''
  }
}

// ───────────────────────────── ritmo (B.6 punto 9) ─────────────────────────────

function ownerKey(actor: AgentActor): string {
  return actor.owner.kind === 'code' ? `code:${actor.owner.directory}` : `cowork:${actor.owner.folder}`
}

const lastInputAt = new Map<string, number>()

async function throttleInput(actor: AgentActor): Promise<void> {
  const key = ownerKey(actor)
  const last = lastInputAt.get(key) ?? 0
  const wait = RATE_LIMIT_MS - (Date.now() - last)
  if (wait > 0) await sleep(wait)
  lastInputAt.set(key, Date.now())
}

function withCallTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`La herramienta tardó demasiado (más de ${CALL_TIMEOUT_MS / 1000} s).`)), CALL_TIMEOUT_MS)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/** Guarda 3 (control) + 7 (verificación) + 9 (ritmo) alrededor de una acción sobre una pestaña. */
async function runOnTab<T>(
  api: EmbeddedBrowserApi,
  actor: AgentActor,
  tabId: string,
  kind: 'read' | 'input',
  fn: (cdp: CdpSession) => Promise<T>
): Promise<{ result: T; verifyMsg: string | null }> {
  if (kind === 'input') await throttleInput(actor)
  const lease = api.beginAgentAction(actor, tabId, kind)
  try {
    const cdp = await api.cdp(tabId)
    const result = await fn(cdp)
    const verifyMsg = kind === 'input' ? await api.verifyAfterAction(actor, tabId) : null
    return { result, verifyMsg }
  } finally {
    lease.release()
  }
}

function withVerify(base: string, verifyMsg: string | null): string {
  return verifyMsg ? `${base}\n${verifyMsg}` : base
}

// ───────────────────────────── texto de página (aislado) ─────────────────────────────

async function pageInnerText(cdp: CdpSession, maxChars: number): Promise<string> {
  const contextId = await cdp.isolatedContext()
  const res = await cdp.send<{ result?: { value?: string } }>('Runtime.evaluate', {
    contextId,
    expression: '(document.body ? document.body.innerText : document.documentElement.innerText) || ""',
    returnByValue: true
  })
  const text = res?.result?.value ?? ''
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (recortado)` : text
}

// ───────────────────────────── consola / red (solo Code) ─────────────────────────────

interface ConsoleEntry {
  type: string
  text: string
  at: number
}
interface NetworkEntry {
  reqid: number
  requestId: string
  url: string
  method: string
  resourceType: string
  status?: number
  mimeType?: string
  at: number
}

const consoleBuffers = new Map<string, ConsoleEntry[]>()
const networkBuffers = new Map<string, NetworkEntry[]>()
const networkCounters = new Map<string, number>()
const listening = new Set<string>()

/** Se olvida el estado de consola/red de una pestaña (al cerrarla o navegar a otro sitio). */
export function forgetTabDiagnostics(tabId: string): void {
  consoleBuffers.delete(tabId)
  networkBuffers.delete(tabId)
  networkCounters.delete(tabId)
  listening.delete(tabId)
}

async function ensureDiagnosticListeners(api: EmbeddedBrowserApi, tabId: string): Promise<CdpSession> {
  const cdp = await api.cdp(tabId)
  if (listening.has(tabId)) return cdp
  listening.add(tabId)
  await cdp.send('Log.enable').catch(() => undefined)
  await cdp.send('Network.enable').catch(() => undefined)
  cdp.on('Log.entryAdded', (p: { entry?: { level?: string; text?: string } }) => {
    const list = consoleBuffers.get(tabId) ?? []
    list.push({ type: String(p?.entry?.level ?? 'log'), text: String(p?.entry?.text ?? ''), at: Date.now() })
    if (list.length > MAX_LOG_ENTRIES) list.splice(0, list.length - MAX_LOG_ENTRIES)
    consoleBuffers.set(tabId, list)
  })
  cdp.on('Network.requestWillBeSent', (p: { requestId?: string; request?: { url?: string; method?: string }; type?: string }) => {
    const n = (networkCounters.get(tabId) ?? 0) + 1
    networkCounters.set(tabId, n)
    const list = networkBuffers.get(tabId) ?? []
    list.push({
      reqid: n,
      requestId: String(p?.requestId ?? ''),
      url: String(p?.request?.url ?? ''),
      method: String(p?.request?.method ?? ''),
      resourceType: String(p?.type ?? ''),
      at: Date.now()
    })
    if (list.length > MAX_LOG_ENTRIES) list.splice(0, list.length - MAX_LOG_ENTRIES)
    networkBuffers.set(tabId, list)
  })
  cdp.on('Network.responseReceived', (p: { requestId?: string; response?: { status?: number; mimeType?: string } }) => {
    const list = networkBuffers.get(tabId)
    const entry = list?.find((e) => e.requestId === String(p?.requestId))
    if (entry) {
      entry.status = p?.response?.status
      entry.mimeType = p?.response?.mimeType
    }
  })
  return cdp
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

// ───────────────────────────── definición de herramientas ─────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: 'list_pages',
    description: 'Lista las pestañas abiertas del navegador integrado: "índice: título (url)", marcando cuál está seleccionada.',
    inputSchema: obj({}),
    kind: 'none',
    run: async (api, actor) => {
      const tabs = api.listTabs(actor.owner)
      const selected = api.agentTabId(actor.owner)
      if (!tabs.length) return 'No hay ninguna pestaña abierta. Usa new_page para abrir una.'
      return tabs.map((t, i) => `${i}: ${pageLabel(t)}${t.id === selected ? '  ← seleccionada' : ''}`).join('\n')
    }
  },
  {
    name: 'select_page',
    description: 'Selecciona la pestaña activa para las demás herramientas, por el índice que muestra list_pages.',
    inputSchema: obj({ pageId: { type: 'integer', description: 'Índice de list_pages' } }, ['pageId']),
    kind: 'none',
    run: async (api, actor, args) => {
      const tabs = api.listTabs(actor.owner)
      const idx = Number(args.pageId)
      const tab = tabs[idx]
      if (!tab) throw new Error(`No existe la pestaña ${idx}. Usa list_pages para ver los índices actuales.`)
      api.selectAgentTab(actor, tab.id)
      return `Pestaña seleccionada: ${pageLabel(tab)}`
    }
  },
  {
    name: 'new_page',
    description: 'Abre una pestaña nueva en la URL indicada (pasa por el permiso del sitio) y la selecciona.',
    inputSchema: obj({ url: { type: 'string', maxLength: 2048 } }, ['url']),
    kind: 'none',
    run: async (api, actor, args) => {
      const url = String(args.url ?? '').slice(0, 2048)
      if (!url) throw new Error('url vacío')
      const tabId = await api.openTabAsAgent(actor, url, 20_000)
      const verifyMsg = await api.verifyAfterAction(actor, tabId)
      const tab = tabById(api, actor, tabId)
      return withVerify(`Pestaña nueva abierta: ${tab ? pageLabel(tab) : url}`, verifyMsg)
    }
  },
  {
    name: 'close_page',
    description: 'Cierra una pestaña que abrió el agente (por el índice de list_pages).',
    inputSchema: obj({ pageId: { type: 'integer' } }, ['pageId']),
    kind: 'none',
    run: async (api, actor, args) => {
      const tabs = api.listTabs(actor.owner)
      const idx = Number(args.pageId)
      const tab = tabs[idx]
      if (!tab) throw new Error(`No existe la pestaña ${idx}.`)
      api.closeTabAsAgent(actor, tab.id)
      forgetTabSnapshot(tab.id)
      forgetTabDiagnostics(tab.id)
      return `Pestaña cerrada: ${pageLabel(tab)}`
    }
  },
  {
    name: 'navigate_page',
    description: 'Navega la pestaña seleccionada: por URL (type="url", por defecto), o atrás/adelante/recargar.',
    inputSchema: obj(
      {
        type: { type: 'string', enum: ['url', 'back', 'forward', 'reload'] },
        url: { type: 'string', maxLength: 2048 },
        timeout: { type: 'integer', maximum: 30_000 }
      },
      []
    ),
    kind: 'none',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      await throttleInput(actor)
      const timeout = clampTimeout(args.timeout, 30_000)
      const type = String(args.type ?? 'url')
      const lease = api.beginAgentAction(actor, tabId, 'input')
      let out: { url: string; title: string }
      try {
        if (type === 'back' || type === 'forward' || type === 'reload') {
          out = await api.historyAsAgent(actor, tabId, type, timeout)
        } else {
          const url = String(args.url ?? '').slice(0, 2048)
          if (!url) throw new Error('navigate_page necesita "url" cuando type es "url" (o se omite).')
          out = await api.navigateAsAgent(actor, tabId, url, timeout)
        }
      } finally {
        lease.release()
      }
      // Solo se olvida si la navegación SUCEDIÓ de verdad (si el sitio se denegó, `navigateAsAgent`
      // lanza antes de llegar aquí y los uid/diagnósticos de la página actual siguen valiendo).
      forgetTabSnapshot(tabId)
      forgetTabDiagnostics(tabId)
      const verifyMsg = await api.verifyAfterAction(actor, tabId)
      return withVerify(`Navegado a ${out.url} — ${out.title}`, verifyMsg)
    }
  },
  {
    name: 'take_snapshot',
    description:
      'Árbol de accesibilidad de la página en texto, con un "uid" por elemento interactivo (para click/hover/fill/…). Los uid caducan al navegar.',
    inputSchema: obj({ verbose: { type: 'boolean' } }),
    kind: 'read',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const { result } = await runOnTab(api, actor, tabId, 'read', async (cdp) => {
        await cdp.send('Accessibility.enable')
        return cdp.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree')
      })
      const tab = tabById(api, actor, tabId)
      const snap = buildSnapshot(tabId, tab?.url ?? '', result.nodes ?? [], { verbose: args.verbose === true })
      return `${UNTRUSTED_PREFIX}${snap.text || '(página vacía o sin elementos accesibles)'}`
    }
  },
  {
    name: 'take_screenshot',
    description: 'Captura JPEG de la pestaña seleccionada, o solo del elemento de "uid" si se da (fullPage se ignora: siempre es el viewport).',
    inputSchema: obj({ fullPage: { type: 'boolean' }, uid: { type: 'string' } }),
    kind: 'read',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const uid = typeof args.uid === 'string' ? args.uid : undefined
      if (uid) {
        const target = requireUid(tabId, uid)
        const { result } = await runOnTab(api, actor, tabId, 'read', async (cdp) => {
          const box = await cdp.send<{ model?: { content: number[] } }>('DOM.getBoxModel', { backendNodeId: target.backendNodeId })
          const quad = box?.model?.content
          if (!quad || quad.length < 8) throw new Error('El elemento no es visible (sin geometría).')
          const xs = [quad[0], quad[2], quad[4], quad[6]]
          const ys = [quad[1], quad[3], quad[5], quad[7]]
          const x = Math.min(...xs)
          const y = Math.min(...ys)
          const width = Math.max(...xs) - x
          const height = Math.max(...ys) - y
          return cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 70, clip: { x, y, width, height, scale: 1 } })
        })
        return { text: `Captura JPEG del elemento (uid=${uid}).`, image: { data: result.data, mimeType: 'image/jpeg' } }
      }
      await runOnTab(api, actor, tabId, 'read', async () => undefined)
      const shot = await api.capture(tabId, 1366)
      return { text: `Captura JPEG (${shot.width}x${shot.height} px).`, image: { data: shot.jpeg.toString('base64'), mimeType: 'image/jpeg' } }
    }
  },
  {
    name: 'click',
    description: 'Hace clic (o doble clic) en el elemento de ese uid. Comprueba que nada lo tape y lo resalta antes de pulsar.',
    inputSchema: obj({ uid: { type: 'string' }, dblClick: { type: 'boolean' } }, ['uid']),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const target = requireUid(tabId, args.uid)
      if (isSensitiveActionName(target.name)) {
        const tab = tabById(api, actor, tabId)
        const ok = await api.confirmSensitive(actor, tabId, `pulsar "${target.name}" en ${hostOfTab(tab) || tab?.url || 'esta página'}`)
        if (!ok) throw new Error('El usuario no confirmó esta acción sensible: no se hace clic.')
      }
      const { verifyMsg } = await runOnTab(api, actor, tabId, 'input', (cdp) => performClick(cdp, target.backendNodeId, { dblClick: args.dblClick === true }))
      return withVerify(`Clic en "${target.name || target.role}" (uid=${args.uid}).`, verifyMsg)
    }
  },
  {
    name: 'hover',
    description: 'Mueve el puntero sobre el elemento de ese uid, sin hacer clic.',
    inputSchema: obj({ uid: { type: 'string' } }, ['uid']),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const target = requireUid(tabId, args.uid)
      const { verifyMsg } = await runOnTab(api, actor, tabId, 'input', (cdp) => performHover(cdp, target.backendNodeId))
      return withVerify(`Puntero sobre "${target.name || target.role}" (uid=${args.uid}).`, verifyMsg)
    }
  },
  {
    name: 'fill',
    description: 'Reemplaza el contenido del campo de ese uid por "value". Rechaza contraseñas y campos de pago/OTP.',
    inputSchema: obj({ uid: { type: 'string' }, value: { type: 'string', maxLength: 5000 } }, ['uid', 'value']),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const target = requireUid(tabId, args.uid)
      const value = String(args.value ?? '').slice(0, 5000)
      const { verifyMsg } = await runOnTab(api, actor, tabId, 'input', async (cdp) => {
        const attrs = await describeAttrs(cdp, target.backendNodeId)
        if (isSensitiveField(attrs)) throw new Error(SENSITIVE_FIELD_MESSAGE)
        await fillField(cdp, target.backendNodeId, value)
      })
      return withVerify(`Campo "${target.name || target.role}" (uid=${args.uid}) rellenado (${value.length} caracteres).`, verifyMsg)
    }
  },
  {
    name: 'fill_form',
    description: 'Rellena varios campos a la vez: [{uid, value}], hasta 20. Rechaza cualquiera que sea sensible.',
    inputSchema: obj(
      {
        elements: {
          type: 'array',
          maxItems: 20,
          items: obj({ uid: { type: 'string' }, value: { type: 'string', maxLength: 5000 } }, ['uid', 'value'])
        }
      },
      ['elements']
    ),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const elements = Array.isArray(args.elements) ? args.elements.slice(0, 20) : []
      if (!elements.length) throw new Error('elements vacío')
      const targets = elements.map((e: { uid?: unknown; value?: unknown }) => ({
        target: requireUid(tabId, e.uid),
        value: String(e.value ?? '').slice(0, 5000),
        uid: String(e.uid ?? '')
      }))
      const { verifyMsg } = await runOnTab(api, actor, tabId, 'input', async (cdp) => {
        for (const t of targets) {
          const attrs = await describeAttrs(cdp, t.target.backendNodeId)
          if (isSensitiveField(attrs)) throw new Error(`Campo "${t.target.name || t.uid}": ${SENSITIVE_FIELD_MESSAGE}`)
        }
        for (const t of targets) await fillField(cdp, t.target.backendNodeId, t.value)
      })
      return withVerify(`${targets.length} campo(s) rellenado(s).`, verifyMsg)
    }
  },
  {
    name: 'type_text',
    description: 'Escribe texto en el elemento con foco (usa fill/click antes si hace falta). submitKey opcional (p.ej. "Enter") al terminar.',
    inputSchema: obj({ text: { type: 'string', maxLength: 5000 }, submitKey: { type: 'string', maxLength: 60 } }, ['text']),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const text = String(args.text ?? '').slice(0, 5000)
      if (!text) throw new Error('text vacío')
      const submitKey = typeof args.submitKey === 'string' ? args.submitKey : undefined
      const { verifyMsg } = await runOnTab(api, actor, tabId, 'input', async (cdp) => {
        const focused = await focusedElementAttrs(cdp).catch(() => null)
        if (focused && isSensitiveField(focused)) throw new Error(SENSITIVE_FIELD_MESSAGE)
        await cdp.send('Input.insertText', { text })
        if (submitKey) await dispatchKeyCombo(cdp, submitKey)
      })
      return withVerify(`Escrito: ${text.length} caracteres${submitKey ? ` + ${submitKey}` : ''}.`, verifyMsg)
    }
  },
  {
    name: 'press_key',
    description: 'Pulsa una tecla o combinación en el elemento con foco (p.ej. "Enter", "Escape", "Control+A"). Bloquea Meta+Q/Meta+W.',
    inputSchema: obj({ key: { type: 'string', maxLength: 60 } }, ['key']),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const key = String(args.key ?? '').trim()
      if (!key) throw new Error('key vacío')
      parseKeyCombo(key) // valida (y bloquea combinaciones prohibidas) antes de tocar el control
      const { verifyMsg } = await runOnTab(api, actor, tabId, 'input', (cdp) => dispatchKeyCombo(cdp, key))
      return withVerify(`Tecla pulsada: ${key}.`, verifyMsg)
    }
  },
  {
    name: 'scroll',
    description: 'Desplaza la página (o el elemento de "uid" si se da). direction: up|down|left|right; amount en px (por defecto 400).',
    inputSchema: obj(
      { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number', maximum: 5000 }, uid: { type: 'string' } },
      ['direction']
    ),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const dir = String(args.direction ?? '')
      const amount = Math.max(1, Math.min(5000, Number(args.amount) || 400))
      const dx = dir === 'right' ? amount : dir === 'left' ? -amount : 0
      const dy = dir === 'down' ? amount : dir === 'up' ? -amount : 0
      if (!dx && !dy) throw new Error('direction debe ser up, down, left o right')
      const uid = typeof args.uid === 'string' ? args.uid : undefined
      const { verifyMsg } = await runOnTab(api, actor, tabId, 'input', async (cdp) => {
        const point = uid ? await resolveClickPoint(cdp, requireUid(tabId, uid).backendNodeId) : await viewportCenter(cdp)
        await dispatchWheel(cdp, point, dx, dy)
      })
      return withVerify(`Scroll ${dir} ${amount}px.`, verifyMsg)
    }
  },
  {
    name: 'wait_for',
    description: 'Espera hasta que aparezca alguno de los textos dados en la página (innerText), o hasta el timeout (por defecto 10 s).',
    inputSchema: obj({ text: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } }, timeout: { type: 'integer', maximum: 30_000 } }, [
      'text'
    ]),
    kind: 'read',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const texts = Array.isArray(args.text) ? args.text.map(String).filter(Boolean) : []
      if (!texts.length) throw new Error('text vacío')
      const timeout = clampTimeout(args.timeout, 30_000, 10_000)
      const deadline = Date.now() + timeout
      let last = ''
      while (Date.now() < deadline) {
        const { result } = await runOnTab(api, actor, tabId, 'read', (cdp) => pageInnerText(cdp, 50_000))
        last = result
        const hit = texts.find((t) => last.includes(t))
        if (hit) return `${UNTRUSTED_PREFIX}Apareció "${hit}".`
        await sleep(300)
      }
      throw new Error(`Ninguno de los textos esperados apareció en ${Math.round(timeout / 1000)} s.`)
    }
  },
  {
    name: 'handle_dialog',
    description: 'Acepta o descarta un diálogo JavaScript (alert/confirm/prompt) pendiente en la pestaña.',
    inputSchema: obj({ action: { type: 'string', enum: ['accept', 'dismiss'] }, promptText: { type: 'string', maxLength: 2000 } }, ['action']),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const accept = String(args.action) === 'accept'
      const promptText = typeof args.promptText === 'string' ? args.promptText : undefined
      const { verifyMsg } = await runOnTab(api, actor, tabId, 'input', (cdp) => cdp.send('Page.handleJavaScriptDialog', { accept, promptText }))
      return withVerify(`Diálogo ${accept ? 'aceptado' : 'descartado'}.`, verifyMsg)
    }
  },
  {
    name: 'get_page_text',
    description: 'Texto visible de la página (innerText) en un mundo aislado, hasta maxChars (por defecto 20000).',
    inputSchema: obj({ maxChars: { type: 'integer', maximum: 50_000 } }),
    kind: 'read',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const maxChars = Math.max(1, Math.min(50_000, Number(args.maxChars) || 20_000))
      const { result } = await runOnTab(api, actor, tabId, 'read', (cdp) => pageInnerText(cdp, maxChars))
      return `${UNTRUSTED_PREFIX}${result}`
    }
  },
  // ───────────────────────────── solo Code ─────────────────────────────
  {
    name: 'list_console_messages',
    description: '(Solo Code) Mensajes de consola de la pestaña seleccionada, más recientes primero. Filtra por types y pagina.',
    codeOnly: true,
    inputSchema: obj({
      types: { type: 'array', items: { type: 'string' } },
      pageSize: { type: 'integer', maximum: 200 },
      pageIdx: { type: 'integer' }
    }),
    kind: 'read',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      await ensureDiagnosticListeners(api, tabId)
      const types = Array.isArray(args.types) ? new Set(args.types.map(String)) : null
      const all = (consoleBuffers.get(tabId) ?? []).filter((e) => !types || types.has(e.type)).slice().reverse()
      const pageSize = Math.max(1, Math.min(200, Number(args.pageSize) || 50))
      const pageIdx = Math.max(0, Number(args.pageIdx) || 0)
      const page = all.slice(pageIdx * pageSize, pageIdx * pageSize + pageSize)
      if (!page.length) return 'Sin mensajes de consola (todavía).'
      return page.map((e) => `[${e.type}] ${e.text}`).join('\n')
    }
  },
  {
    name: 'list_network_requests',
    description: '(Solo Code) Peticiones de red de la pestaña seleccionada, más recientes primero. Filtra por resourceTypes y pagina.',
    codeOnly: true,
    inputSchema: obj({
      resourceTypes: { type: 'array', items: { type: 'string' } },
      pageSize: { type: 'integer', maximum: 200 },
      pageIdx: { type: 'integer' }
    }),
    kind: 'read',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      await ensureDiagnosticListeners(api, tabId)
      const types = Array.isArray(args.resourceTypes) ? new Set(args.resourceTypes.map(String)) : null
      const all = (networkBuffers.get(tabId) ?? []).filter((e) => !types || types.has(e.resourceType)).slice().reverse()
      const pageSize = Math.max(1, Math.min(200, Number(args.pageSize) || 50))
      const pageIdx = Math.max(0, Number(args.pageIdx) || 0)
      const page = all.slice(pageIdx * pageSize, pageIdx * pageSize + pageSize)
      if (!page.length) return 'Sin peticiones de red (todavía).'
      return page.map((e) => `#${e.reqid} ${e.method} ${e.status ?? '…'} ${e.resourceType} ${e.url}`).join('\n')
    }
  },
  {
    name: 'get_network_request',
    description: '(Solo Code) Cabeceras y cuerpo (texto, hasta 100 KB) de una petición por su "reqid" de list_network_requests.',
    codeOnly: true,
    inputSchema: obj({ reqid: { type: 'integer' } }, ['reqid']),
    kind: 'read',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const cdp = await ensureDiagnosticListeners(api, tabId)
      const reqid = Number(args.reqid)
      const entry = (networkBuffers.get(tabId) ?? []).find((e) => e.reqid === reqid)
      if (!entry) throw new Error(`No existe la petición #${reqid}. Usa list_network_requests primero.`)
      let body = ''
      try {
        const res = await cdp.send<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', { requestId: entry.requestId })
        body = res.base64Encoded ? '(cuerpo binario, no se muestra)' : res.body
      } catch (err) {
        body = `(sin cuerpo disponible: ${err instanceof Error ? err.message : err})`
      }
      if (body.length > 100_000) body = `${body.slice(0, 100_000)}\n… (recortado a 100 KB)`
      return (
        `${entry.method} ${entry.url}\nEstado: ${entry.status ?? '?'} · Tipo: ${entry.mimeType ?? entry.resourceType}\n\n` + `${UNTRUSTED_PREFIX}${body}`
      )
    }
  },
  {
    name: 'evaluate_script',
    description:
      '(Solo Code) Ejecuta una función JavaScript en la página, SOLO si la pestaña está en un origen loopback (127.0.0.1/localhost). ' +
      'args: elementos por uid, pasados como argumentos.',
    codeOnly: true,
    inputSchema: obj(
      { function: { type: 'string', maxLength: 10_000 }, args: { type: 'array', items: obj({ uid: { type: 'string' } }, ['uid']) } },
      ['function']
    ),
    kind: 'input',
    run: async (api, actor, args) => {
      const tabId = requireTab(api, actor)
      const tab = tabById(api, actor, tabId)
      const host = hostOfTab(tab)
      if (!isLoopbackHost(host)) {
        throw new Error('evaluate_script solo funciona en un origen local (127.0.0.1/localhost): esta pestaña no lo es.')
      }
      const fnSrc = String(args.function ?? '').slice(0, 10_000)
      if (!fnSrc) throw new Error('function vacío')
      const argUids = Array.isArray(args.args) ? args.args.map((a: { uid?: unknown }) => String(a?.uid ?? '')) : []
      const { result, verifyMsg } = await runOnTab(api, actor, tabId, 'input', async (cdp) => {
        const objectIds: string[] = []
        for (const uid of argUids) {
          const backendNodeId = backendIdForUid(tabId, uid)
          if (backendNodeId == null) throw new Error(`uid desconocido o caducado: ${uid}`)
          const resolved = await cdp.send<{ object?: { objectId?: string } }>('DOM.resolveNode', { backendNodeId })
          const objectId = resolved?.object?.objectId
          if (!objectId) throw new Error(`No se pudo resolver el elemento ${uid}`)
          objectIds.push(objectId)
        }
        const windowRef = await cdp.send<{ result?: { objectId?: string } }>('Runtime.evaluate', { expression: 'window' })
        const objectId = windowRef?.result?.objectId
        if (!objectId) throw new Error('No se pudo preparar la ejecución.')
        const res = await cdp.send<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function(...args){ return (${fnSrc}).apply(this, args) }`,
          arguments: objectIds.map((id) => ({ objectId: id })),
          returnByValue: true,
          awaitPromise: true
        })
        if (res?.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Error al ejecutar el script.')
        return res?.result?.value
      })
      const text = typeof result === 'string' ? result : JSON.stringify(result ?? null)
      return withVerify(`${UNTRUSTED_PREFIX}${text.slice(0, 20_000)}`, verifyMsg)
    }
  }
]

export const SHARED_TOOL_COUNT = TOOLS.filter((t) => !t.codeOnly).length
export const CODE_TOOL_COUNT = TOOLS.length

/** Lista de herramientas para `tools/list`, filtradas por producto (17 en Cowork, 21 en Code). */
export function toolsForProduct(product: BrowserProduct): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return TOOLS.filter((t) => product === 'code' || !t.codeOnly).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}

/**
 * Ejecuta una herramienta por nombre con las guardas 2 (activación, comprobada por el llamador),
 * y devuelve el resultado en forma de contenido MCP. Nunca lanza: los errores se devuelven como
 * `isError: true` (igual que `computer/mcp-server.ts`).
 */
export async function callBrowserTool(api: EmbeddedBrowserApi, actor: AgentActor, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }], isError: true }
  if (tool.codeOnly && actor.product !== 'code') {
    return { content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }], isError: true }
  }
  try {
    const result = await withCallTimeout(tool.run(api, actor, args))
    if (typeof result === 'string') return { content: [{ type: 'text', text: result }] }
    return {
      content: [
        { type: 'image', data: result.image.data, mimeType: result.image.mimeType },
        { type: 'text', text: result.text }
      ]
    }
  } catch (err) {
    return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true }
  }
}
