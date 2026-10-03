/**
 * Envoltorio de `webContents.debugger` (CDP a nivel de página, Lote D, D1 paso 4).
 *
 * - Adjunta perezosamente (solo cuando se pide el primer comando) y se reconecta sola tras un
 *   `detach` (p.ej. si algo cerró la sesión CDP): el siguiente `send`/`on` vuelve a adjuntar.
 * - Lista blanca estricta: cualquier método fuera de `ALLOWED_CDP` (api.ts) lanza antes de tocar
 *   Electron.
 * - Cada comando tiene un timeout (10 s por defecto, B.6 "Transporte"/D1 paso 4).
 * - `isolatedContext()` crea (una vez por navegación) un mundo aislado del frame principal con
 *   `Page.createIsolatedWorld`, para `Runtime.evaluate`/`callFunctionOn` sin tocar el `window` de
 *   la página (excepto `evaluate_script`, que D2 decide dirigir al mundo principal solo en loopback).
 * - `onInputSent`: cdp.ts avisa a `surface.ts` justo antes de enviar `Input.*`, para que la
 *   ventana `userActive` (D0 corrección 3) no confunda la propia entrada del agente con la del
 *   usuario real (el evento `input-event` de Electron no distingue una de otra).
 */
import type { WebContents } from 'electron'
import { ALLOWED_CDP, type AllowedCdpMethod, type CdpSession } from './api'
import { scaleInputParams } from './viewport'

const PROTOCOL_VERSION = '1.3'
const DEFAULT_TIMEOUT_MS = 10_000
const ALLOWED = new Set<string>(ALLOWED_CDP)

interface Managed {
  attached: boolean
  isolatedWorldId: number | null
  listeners: Map<string, Set<(params: unknown) => void>>
  messageHandler: (event: Electron.Event, method: string, params: unknown) => void
  detachHandler: (event: Electron.Event, reason: string) => void
}

const sessions = new WeakMap<WebContents, Managed>()

function dispatchTo(m: Managed, method: string, params: unknown): void {
  const set = m.listeners.get(method)
  if (!set) return
  for (const fn of set) {
    try {
      fn(params)
    } catch (err) {
      console.error(`[embedded-browser] listener CDP (${method}):`, err)
    }
  }
}

function ensureAttached(wc: WebContents): Managed {
  let m = sessions.get(wc)
  if (!m) {
    m = {
      attached: false,
      isolatedWorldId: null,
      listeners: new Map(),
      messageHandler: () => undefined,
      detachHandler: () => undefined
    }
    const managed = m
    managed.messageHandler = (_event, method, params) => dispatchTo(managed, method, params)
    managed.detachHandler = (_event, reason) => {
      console.warn(`[embedded-browser] CDP desconectado (${reason}); se readjunta al siguiente comando`)
      managed.attached = false
      managed.isolatedWorldId = null
    }
    sessions.set(wc, m)
    wc.once('destroyed', () => detachCdp(wc))
  }
  if (!m.attached) {
    if (!wc.debugger.isAttached()) wc.debugger.attach(PROTOCOL_VERSION)
    wc.debugger.on('message', m.messageHandler)
    wc.debugger.on('detach', m.detachHandler)
    m.attached = true
  }
  return m
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP: tiempo agotado (${label})`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export interface CdpSessionOptions {
  /** Se llama justo antes de enviar cualquier `Input.*` (marca la ventana `userActive`, ver surface.ts). */
  onInputSent?: () => void
  /** Factor CSS → vista de la emulación de viewport (F8-B46): `Input.*` espera píxeles de vista, el resto de CDP píxeles CSS. */
  inputScale?: () => number
}

export function cdpSessionFor(wc: WebContents, opts: CdpSessionOptions = {}): CdpSession {
  const send = async <T = unknown>(method: AllowedCdpMethod, params: object = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> => {
    if (!ALLOWED.has(method)) throw new Error(`Método CDP no permitido: ${method}`)
    if (wc.isDestroyed()) throw new Error('La pestaña ya no existe')
    ensureAttached(wc)
    if (method.startsWith('Input.')) opts.onInputSent?.()
    const sent = method.startsWith('Input.') && opts.inputScale ? scaleInputParams(method, params, opts.inputScale()) : params
    const raw = wc.debugger.sendCommand(method, sent) as Promise<T>
    return withTimeout(raw, timeoutMs, method)
  }
  const on = (event: string, fn: (params: unknown) => void): (() => void) => {
    const m = ensureAttached(wc)
    let set = m.listeners.get(event)
    if (!set) {
      set = new Set()
      m.listeners.set(event, set)
    }
    set.add(fn)
    return () => set?.delete(fn)
  }
  const isolatedContext = async (): Promise<number> => {
    const m = ensureAttached(wc)
    if (m.isolatedWorldId !== null) return m.isolatedWorldId
    await send('Page.enable')
    const tree = await send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree')
    const res = await send<{ executionContextId: number }>('Page.createIsolatedWorld', {
      frameId: tree.frameTree.frame.id,
      worldName: 'onyxcode-embedded-browser',
      grantUniveralAccess: false
    })
    m.isolatedWorldId = res.executionContextId
    return res.executionContextId
  }
  return { send, on, isolatedContext } as CdpSession
}

/** Limpieza en cualquier ruta de error o al cerrar la pestaña (D0 corrección 5: siempre vista+debugger). */
export function detachCdp(wc: WebContents): void {
  const m = sessions.get(wc)
  if (m) {
    try {
      wc.debugger.removeListener('message', m.messageHandler)
      wc.debugger.removeListener('detach', m.detachHandler)
    } catch {
      // wc ya destruido: nada que limpiar.
    }
  }
  try {
    if (!wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach()
  } catch {
    // idem.
  }
  sessions.delete(wc)
}
