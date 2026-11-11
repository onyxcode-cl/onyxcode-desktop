/**
 * Cola de aprobaciones por sitio del navegador integrado (Lote D, B.8 y D1 paso 7).
 *
 * - Una promesa por petición, resuelta por `browser:respond` (tarjeta del renderer, dentro de la
 *   ventana) o se deniega desde el aviso nativo cuando no hay anfitrión visible (panel cerrado,
 *   ventana minimizada y sin ventana «Navegador» aparte). Gana la primera respuesta.
 * - Tope de 10 minutos: pasado ese tiempo, se deniega sola (rutinas desatendidas, riesgo E.12).
 * - `initApprovals` inyecta las dependencias de `service.ts` (visibilidad del anfitrión y el envío
 *   de los eventos `browser:approval`/`browser:approvalDone`), para que este módulo no importe
 *   `service.ts` (evita el ciclo).
 */
import { t } from '@shared/i18n'
import { randomBytes } from 'node:crypto'
import { Notification } from 'electron'
import { askButtons } from '../util/native-dialog'
import { DISPLAY_NAME } from '@shared/brand'
import type { BrowserApprovalRequest, BrowserDecision, BrowserOwner } from '@shared/ipc-browser'

const TIMEOUT_MS = 10 * 60 * 1000

export interface ApprovalsDeps {
  /** Panel visible en la ventana principal, o ventana «Navegador» aparte visible, para ese owner. */
  hasVisibleHost(owner: BrowserOwner): boolean
  showHost(owner: BrowserOwner): void
  broadcastApproval(req: BrowserApprovalRequest): void
  broadcastApprovalDone(id: string): void
}

let deps: ApprovalsDeps | null = null

export function initApprovals(d: ApprovalsDeps): void {
  deps = d
}

interface Pending {
  req: BrowserApprovalRequest
  resolve(decision: BrowserDecision): void
  timer: ReturnType<typeof setTimeout>
  controller: AbortController
}

const pending = new Map<string, Pending>()

function finish(id: string, decision: BrowserDecision): void {
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  p.controller.abort()
  pending.delete(id)
  p.resolve(decision)
  deps?.broadcastApprovalDone(id)
}

/** Peticiones de sitio YA pendientes, por clave: si el agente repite la acción mientras el usuario aún no responde, comparte la tarjeta. */
const inflight = new Map<string, Promise<BrowserDecision>>()

/** Solo los permisos de sitio/origen local son idempotentes; «sensible» y «descarga» son acciones distintas cada vez. */
function inflightKey(input: Omit<BrowserApprovalRequest, 'id' | 'createdAt'>): string | null {
  if (input.kind === 'site') return `${ownerKey(input.owner)}|${input.sessionId}|site|${input.site}`
  if (input.kind === 'local-origin') return `${ownerKey(input.owner)}|${input.sessionId}|local|${input.host}`
  return null
}

/** Etiquetas de lo que está esperando respuesta del usuario ahora mismo (para avisar al agente en vez de un «timeout» genérico). */
export function pendingLabels(): string[] {
  return [...new Set([...pending.values()].map((p) => labelFor(p.req)))]
}

/** Pide una aprobación; se resuelve con la decisión del usuario (tarjeta o diálogo nativo). */
export function requestApproval(input: Omit<BrowserApprovalRequest, 'id' | 'createdAt'>): Promise<BrowserDecision> {
  if (!deps) {
    console.error('[embedded-browser] approvals sin inicializar: se deniega por seguridad')
    return Promise.resolve('deny')
  }
  const key = inflightKey(input)
  const existing = key ? inflight.get(key) : undefined
  if (existing) return existing
  const promise = createApproval(input)
  if (key) {
    inflight.set(key, promise)
    void promise.finally(() => inflight.delete(key))
  }
  return promise
}

function createApproval(input: Omit<BrowserApprovalRequest, 'id' | 'createdAt'>): Promise<BrowserDecision> {
  const id = randomBytes(8).toString('hex')
  const req: BrowserApprovalRequest = { ...input, id, createdAt: Date.now() }
  return new Promise<BrowserDecision>((resolve) => {
    const timer = setTimeout(() => finish(id, 'deny'), TIMEOUT_MS)
    const controller = new AbortController()
    pending.set(id, { req, resolve, timer, controller })
    deps?.broadcastApproval(req)
    if (!deps?.hasVisibleHost(req.owner)) {
      void showNativeFallback(req, controller.signal).then((decision) => {
        if (decision !== null && pending.has(id)) finish(id, decision)
      })
    }
  })
}

/** Llamado desde `browser:respond` (IPC): resuelve la petición si sigue pendiente. */
export function respondApproval(id: string, decision: BrowserDecision): void {
  finish(id, decision)
}

/** Todas las peticiones pendientes de un owner (para repintar la tarjeta al reabrir el panel). */
export function pendingFor(owner: BrowserOwner): BrowserApprovalRequest[] {
  const key = ownerKey(owner)
  return [...pending.values()].filter((p) => ownerKey(p.req.owner) === key).map((p) => p.req)
}

function ownerKey(owner: BrowserOwner): string {
  return owner.kind === 'code' ? `code:${owner.directory}` : `tasks:${owner.folder}`
}

function labelFor(req: BrowserApprovalRequest): string {
  return req.kind === 'local-origin' ? t('merr.notif.localServer', { host: req.host }) : req.site
}

function revealPending(req: BrowserApprovalRequest): void {
  if (!pending.has(req.id)) return
  try {
    deps?.showHost(req.owner)
    deps?.broadcastApproval(req)
  } catch (err) {
    console.error('[embedded-browser] abrir la tarjeta de aprobación:', err)
  }
}

async function showNativeFallback(req: BrowserApprovalRequest, signal: AbortSignal): Promise<BrowserDecision | null> {
  const message =
    req.kind === 'sensitive'
      ? (req.summary ?? t('merr.notif.agentSensitive', { site: req.site }))
      : req.kind === 'download'
        ? t('merr.notif.agentDownload', { file: req.fileName ?? req.url })
        : t('merr.notif.agentOpen', { target: labelFor(req) })
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: DISPLAY_NAME,
        body: message
      })
      notification.on('click', () => revealPending(req))
      notification.show()
    }
  } catch (err) {
    console.error('[embedded-browser] notificación de aprobación:', err)
  }

  // El aviso solo puede negar o abrir la tarjeta. Nunca concede permisos.
  try {
    const i = await askButtons({
      message,
      detail: req.summary ? `${req.summary}\n\n${req.url}` : req.url,
      buttons: [t('merr.dialog.no'), t('merr.hostExec.openApp')],
      defaultIndex: 0,
      cancelIndex: 0,
      signal
    })
    if (signal.aborted) return null
    if (i !== 1) return 'deny'
    revealPending(req)
    return null
  } catch (err) {
    console.error('[embedded-browser] aviso de aprobación:', err)
    return 'deny'
  }
}
