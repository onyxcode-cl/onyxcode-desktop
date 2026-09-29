/**
 * Guardas y primitivas de entrada del agente (Lote D, B.6 puntos 4-6): resolver el punto de clic,
 * comprobar clickjacking, resaltar antes de pulsar, y rechazar campos/acciones sensibles.
 * Todo pasa por `ALLOWED_CDP` (D1, `api.ts`); nada aquí llama a un método fuera de esa lista.
 */
import type { CdpSession } from './api'
import { parseKeyCombo } from './keys'
import { sleep } from '../util/async'

export interface Point {
  x: number
  y: number
}

/** `DOM.scrollIntoViewIfNeeded` + `DOM.getContentQuads` → centro del primer cuadrilátero visible. */
export async function resolveClickPoint(cdp: CdpSession, backendNodeId: number): Promise<Point> {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
  const quads = await cdp.send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId })
  const quad = quads?.quads?.[0]
  if (!quad || quad.length < 8) {
    throw new Error('El elemento no es visible (sin geometría): puede estar oculto, con display:none o fuera de la página.')
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]]
  const ys = [quad[1], quad[3], quad[5], quad[7]]
  return { x: xs.reduce((a, b) => a + b, 0) / 4, y: ys.reduce((a, b) => a + b, 0) / 4 }
}

interface DescribedNode {
  backendNodeId?: number
  nodeName?: string
  attributes?: string[]
  children?: DescribedNode[]
  shadowRoots?: DescribedNode[]
  contentDocument?: DescribedNode
}

async function collectBackendIds(cdp: CdpSession, backendNodeId: number): Promise<Set<number>> {
  const ids = new Set<number>()
  const res = await cdp.send<{ node: DescribedNode }>('DOM.describeNode', { backendNodeId, depth: -1, pierce: false })
  const walk = (n: DescribedNode | undefined): void => {
    if (!n) return
    if (typeof n.backendNodeId === 'number') ids.add(n.backendNodeId)
    for (const c of n.children ?? []) walk(c)
    for (const c of n.shadowRoots ?? []) walk(c)
    if (n.contentDocument) walk(n.contentDocument)
  }
  walk(res?.node)
  return ids
}

/**
 * `DOM.getNodeForLocation`: el nodo bajo `point` debe ser `backendNodeId` o un descendiente suyo.
 * Si no, hay algo tapando el objetivo (protección contra clickjacking, B.6 punto 4).
 */
export async function assertNotObscured(cdp: CdpSession, backendNodeId: number, point: Point): Promise<void> {
  // `includeUserAgentShadowDOM:false`: si no, Chrome puede devolver un nodo interno del shadow DOM
  // nativo de un `<input>`/`<select>` (su "editing element") que `describeNode` no expone como
  // descendiente accesible del host, y el clic se rechaza por un falso positivo de clickjacking.
  const hit = await cdp.send<{ backendNodeId?: number }>('DOM.getNodeForLocation', {
    x: Math.round(point.x),
    y: Math.round(point.y),
    includeUserAgentShadowDOM: false
  })
  if (typeof hit?.backendNodeId !== 'number') {
    throw new Error('No se pudo comprobar qué elemento hay en ese punto: no se hace clic.')
  }
  if (hit.backendNodeId === backendNodeId) return
  const allowed = await collectBackendIds(cdp, backendNodeId)
  if (allowed.has(hit.backendNodeId)) return
  throw new Error('Otro elemento tapa el objetivo (protección contra clickjacking): no se hace clic.')
}

/** `Overlay.highlightNode` 400 ms antes de pulsar, para que el usuario vea qué se va a pulsar. */
async function highlightBriefly(cdp: CdpSession, backendNodeId: number): Promise<void> {
  await cdp.send('Overlay.enable').catch(() => undefined)
  await cdp
    .send('Overlay.highlightNode', {
      backendNodeId,
      highlightConfig: {
        contentColor: { r: 111, g: 168, b: 220, a: 0.35 },
        borderColor: { r: 53, g: 116, b: 240, a: 0.9 },
        showInfo: false
      }
    })
    .catch(() => undefined)
  await sleep(400)
  await cdp.send('Overlay.hideHighlight').catch(() => undefined)
}

/** Clic (o doble clic) con las guardas del punto 4 de B.6: scroll, geometría, clickjacking, resalte, eventos confiables. */
export async function performClick(cdp: CdpSession, backendNodeId: number, opts: { dblClick?: boolean } = {}): Promise<Point> {
  const point = await resolveClickPoint(cdp, backendNodeId)
  await assertNotObscured(cdp, backendNodeId, point)
  await highlightBriefly(cdp, backendNodeId)
  const counts = opts.dblClick ? [1, 2] : [1]
  for (const clickCount of counts) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount })
  }
  return point
}

/** `hover`: mismo cálculo de punto, sin clic ni resalte (menos invasivo). */
export async function performHover(cdp: CdpSession, backendNodeId: number): Promise<Point> {
  const point = await resolveClickPoint(cdp, backendNodeId)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  return point
}

async function selectAllInField(cdp: CdpSession): Promise<void> {
  const combo = parseKeyCombo('Meta+A')
  await cdp.send('Input.dispatchKeyEvent', combo.down)
  await cdp.send('Input.dispatchKeyEvent', combo.up)
}

/** `fill`: clic para enfocar (con las mismas guardas), seleccionar todo y remplazar con `Input.insertText`. */
export async function fillField(cdp: CdpSession, backendNodeId: number, value: string): Promise<void> {
  await performClick(cdp, backendNodeId)
  await cdp.send('DOM.focus', { backendNodeId }).catch(() => undefined)
  await selectAllInField(cdp)
  await cdp.send('Input.insertText', { text: value })
}

/** Atributos relevantes de un nodo (para las guardas de campos sensibles). */
export interface ElementAttrs {
  tag: string
  type?: string
  autocomplete?: string
}

export async function describeAttrs(cdp: CdpSession, backendNodeId: number): Promise<ElementAttrs> {
  const res = await cdp.send<{ node: DescribedNode }>('DOM.describeNode', { backendNodeId })
  const node = res?.node
  const flat = node?.attributes ?? []
  const attrs: Record<string, string> = {}
  for (let i = 0; i < flat.length; i += 2) {
    const k = flat[i]?.toLowerCase()
    if (k) attrs[k] = flat[i + 1] ?? ''
  }
  return {
    tag: String(node?.nodeName ?? '').toLowerCase(),
    type: attrs.type?.toLowerCase(),
    autocomplete: attrs.autocomplete?.toLowerCase()
  }
}

/** `type=password` o `autocomplete` de tarjeta/OTP/contraseña (B.6 punto 5). */
export function isSensitiveField(attrs: ElementAttrs): boolean {
  if (attrs.type === 'password') return true
  const tokens = (attrs.autocomplete ?? '').split(/\s+/).filter(Boolean)
  return tokens.some((t) => t.startsWith('cc-') || t === 'one-time-code' || t === 'current-password' || t === 'new-password')
}

export const SENSITIVE_FIELD_MESSAGE =
  'Ese campo es sensible (contraseña, tarjeta o código de un solo uso). El agente nunca lo rellena: pide al usuario que lo escriba él mismo.'

/** Acciones sensibles (pagos, compras, borrado de cuentas…) que exigen confirmación explícita (B.6 punto 6). */
export const SENSITIVE_ACTION_RE =
  /(pagar|comprar|confirmar (compra|pedido|pago)|finalizar compra|place order|buy now|pay|checkout|transferir|eliminar (cuenta|repositorio)|delete (account|repository)|enviar pago)/i

export function isSensitiveActionName(name: string): boolean {
  return !!name && SENSITIVE_ACTION_RE.test(name)
}

/** Centro del viewport actual (para `scroll` sin `uid`). */
export async function viewportCenter(cdp: CdpSession): Promise<Point> {
  const metrics = await cdp.send<{ visualViewport?: { clientWidth?: number; clientHeight?: number } }>('Page.getLayoutMetrics')
  const w = metrics?.visualViewport?.clientWidth ?? 800
  const h = metrics?.visualViewport?.clientHeight ?? 600
  return { x: w / 2, y: h / 2 }
}

export async function dispatchWheel(cdp: CdpSession, point: Point, deltaX: number, deltaY: number): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX, deltaY })
}

/** Lee `document.activeElement` en el mundo aislado (solo introspección: tag/type/autocomplete). */
export async function focusedElementAttrs(cdp: CdpSession): Promise<ElementAttrs | null> {
  const contextId = await cdp.isolatedContext()
  const res = await cdp.send<{ result?: { value?: ElementAttrs | null } }>('Runtime.evaluate', {
    contextId,
    expression:
      '(() => { const e = document.activeElement; if (!e || e === document.body) return null; ' +
      'return { tag: e.tagName.toLowerCase(), type: (e.getAttribute("type")||"").toLowerCase(), ' +
      'autocomplete: (e.getAttribute("autocomplete")||"").toLowerCase() } })()',
    returnByValue: true
  })
  return res?.result?.value ?? null
}

export async function dispatchKeyCombo(cdp: CdpSession, combo: string): Promise<void> {
  const parsed = parseKeyCombo(combo)
  await cdp.send('Input.dispatchKeyEvent', parsed.down)
  await cdp.send('Input.dispatchKeyEvent', parsed.up)
}
