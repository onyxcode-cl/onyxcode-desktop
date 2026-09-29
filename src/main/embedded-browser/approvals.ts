/**
 * Cola de aprobaciones por sitio del navegador integrado (Lote D, B.8 y D1 paso 7).
 *
 * - Una promesa por petición, resuelta por `browser:respond` (tarjeta del renderer, dentro de la
 *   ventana) o por el diálogo nativo de respaldo cuando no hay anfitrión visible (panel cerrado,
 *   ventana minimizada y sin ventana «Navegador» aparte). Gana la primera respuesta.
 * - Tope de 10 minutos: pasado ese tiempo, se deniega sola (rutinas desatendidas, riesgo E.12).
 * - `initApprovals` inyecta las dependencias de `service.ts` (visibilidad del anfitrión y el envío
 *   de los eventos `browser:approval`/`browser:approvalDone`), para que este módulo no importe
 *   `service.ts` (evita el ciclo).
 */
import { randomBytes } from 'node:crypto'
import { dialog, Notification } from 'electron'
import { APP_NAME } from '@shared/brand'
import type { BrowserApprovalRequest, BrowserDecision, BrowserOwner } from '@shared/ipc-browser'

const TIMEOUT_MS = 10 * 60 * 1000

export interface ApprovalsDeps {
  /** Panel visible en la ventana principal, o ventana «Navegador» aparte visible, para ese owner. */
  hasVisibleHost(owner: BrowserOwner): boolean
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
}

const pending = new Map<string, Pending>()

function finish(id: string, decision: BrowserDecision): void {
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(id)
  p.resolve(decision)
  deps?.broadcastApprovalDone(id)
}

/** Pide una aprobación; se resuelve con la decisión del usuario (tarjeta o diálogo nativo). */
export function requestApproval(input: Omit<BrowserApprovalRequest, 'id' | 'createdAt'>): Promise<BrowserDecision> {
  if (!deps) {
    console.error('[embedded-browser] approvals sin inicializar: se deniega por seguridad')
    return Promise.resolve('deny')
  }
  const id = randomBytes(8).toString('hex')
  const req: BrowserApprovalRequest = { ...input, id, createdAt: Date.now() }
  return new Promise<BrowserDecision>((resolve) => {
    const timer = setTimeout(() => finish(id, 'deny'), TIMEOUT_MS)
    pending.set(id, { req, resolve, timer })
    deps?.broadcastApproval(req)
    if (!deps?.hasVisibleHost(req.owner)) {
      void showNativeFallback(req).then((decision) => {
        if (pending.has(id)) finish(id, decision)
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
  return req.kind === 'local-origin' ? `tu servidor local ${req.host}` : req.site
}

async function showNativeFallback(req: BrowserApprovalRequest): Promise<BrowserDecision> {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: APP_NAME,
        body:
          req.kind === 'sensitive'
            ? (req.summary ?? `El agente quiere hacer algo en ${req.site}`)
            : req.kind === 'download'
              ? `El agente quiere descargar ${req.fileName ?? req.url}`
              : `El agente quiere abrir ${labelFor(req)}`
      }).show()
    }
  } catch (err) {
    console.error('[embedded-browser] notificación de aprobación:', err)
  }

  // El botón "seguro" (denegar) va SIEMPRE en el índice 0: verificado en vivo durante la revisión
  // de este lote que, en macOS, `dialog.showMessageBox` no ata la tecla Return al botón de
  // `defaultId` cuando no es 0 (Return activó el botón de índice 0 — "Permitir…" — pese a
  // `defaultId`/`cancelId` apuntar al índice del "No"/"Cancelar"). Con el botón de índice 0 sí
  // pensado como el seguro, una pulsación de Return sin leer (dialogo inesperado, foco robado)
  // deniega en vez de conceder. `cancelId` también se deja en 0 por si Esc tiene el mismo problema.
  if (req.kind === 'sensitive' || req.kind === 'download') {
    const res = await dialog.showMessageBox({
      type: 'warning',
      message: req.summary ?? `¿Permitir que el agente descargue "${req.fileName ?? req.url}"?`,
      detail: req.url,
      buttons: ['Cancelar', 'Permitir'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    return res.response === 1 ? 'allow' : 'deny'
  }

  const res = await dialog.showMessageBox({
    type: 'warning',
    message: `¿Dejar que el agente abra ${labelFor(req)}?`,
    detail: req.url,
    buttons: ['No', 'Permitir en esta tarea', 'Permitir siempre'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return res.response === 1 ? 'task' : res.response === 2 ? 'always' : 'deny'
}
