/**
 * Aprobación de la persona para la herramienta `equipo` (un comando FUERA del aislamiento), decidida en el PROCESO PRINCIPAL.
 *
 * Por qué aquí y no en el motor: el motor de una Tarea corre dentro de la jaula, igual que los programas de la tarea. Todo lo que vive
 * dentro (la tarjeta `ask` del motor, su API, el token de la ruta del proxy MCP) lo puede leer o responder un programa de la tarea. La
 * única aprobación que no se puede falsificar es la que pide y decide `main`.
 *
 * Mismo patrón que `embedded-browser/approvals.ts`, con estas diferencias a propósito:
 * - Cada petición es una tarjeta propia: NO hay deduplicación ni «permitir siempre» ni memoria. La decisión vale para ESA llamada (el
 *   comando exacto, la carpeta y las opciones que guarda `main` en la petición); lo que se ejecuta es lo que quedó guardado aquí.
 * - El tiempo límite y el corte de la petición MCP (señal `abort`) cuentan como «sin respuesta»: se deniega.
 * - Sin ventana visible: diálogo nativo de respaldo (lo aporta quien inicializa, para que este módulo no importe `electron` y lo pueda
 *   leer la política del celular).
 */
import { randomBytes } from 'node:crypto'
import type { HostExecApprovalRequest, HostExecDecision } from '@shared/ipc-tasks'

/** Tiempo máximo esperando a la persona. Pasado, se deniega solo. */
export const HOST_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export type HostDecision = HostExecDecision
/** `no-answer`: venció el tiempo, se cortó la petición o no hay quien pregunte. */
export type HostApprovalOutcome = 'allow' | 'deny' | 'no-answer'

/** Lo que ve la persona. `command` es el comando REAL, completo y sin tapar (lo que se tapa es el registro). */
export type HostApprovalRequest = HostExecApprovalRequest

export type HostApprovalInput = Omit<HostApprovalRequest, 'id' | 'createdAt' | 'expiresAt'>

export interface HostApprovalsDeps {
  /** ¿La ventana principal está visible (no minimizada ni oculta)? Sin ella, se usa el respaldo nativo. */
  hasVisibleHost(): boolean
  /** Difunde la tarjeta a las ventanas (y, filtrada, al celular). */
  broadcast(req: HostApprovalRequest): void
  /** La petición con ese id ya se resolvió: las tarjetas abiertas se cierran. */
  broadcastDone(id: string): void
  /** Aviso del sistema (no decide nada). */
  notify?(req: HostApprovalRequest): void
  /**
   * Diálogo nativo de respaldo. `null` = se cerró sin elegir (cuenta como «No»); `open` = la persona pidió abrir la app para verlo
   * (no decide: sigue pendiente en la tarjeta). `signal` se aborta cuando la petición se resuelve o vence: el diálogo debe cerrarse.
   */
  fallback?(req: HostApprovalRequest, signal: AbortSignal): Promise<HostDecision | 'open' | null>
}

let deps: HostApprovalsDeps | null = null

export function initHostApprovals(d: HostApprovalsDeps | null): void {
  deps = d
}

interface Pending {
  req: HostApprovalRequest
  resolve(outcome: HostApprovalOutcome): void
  timer: ReturnType<typeof setTimeout>
  cleanup(): void
  /** Cierra el diálogo nativo (si hay) al resolverse. */
  closer: AbortController
}

const pending = new Map<string, Pending>()

function finish(id: string, outcome: HostApprovalOutcome): void {
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  p.cleanup()
  p.closer.abort()
  pending.delete(id)
  p.resolve(outcome)
  try {
    deps?.broadcastDone(id)
  } catch {
    /* avisar a las ventanas nunca cambia la decisión */
  }
}

/**
 * Pide a la persona que apruebe UN comando. Se resuelve con su decisión, o `no-answer` si vence el tiempo o se corta la petición
 * (`signal`). Sin inicializar: `no-answer` (falla cerrado).
 */
export function requestHostApproval(
  input: HostApprovalInput,
  opts: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {}
): Promise<HostApprovalOutcome> {
  const d = deps
  if (!d) {
    console.error('[equipo] aprobaciones sin inicializar: se deniega por seguridad')
    return Promise.resolve('no-answer')
  }
  if (opts.signal?.aborted) return Promise.resolve('no-answer')
  const timeoutMs = opts.timeoutMs ?? HOST_APPROVAL_TIMEOUT_MS
  const createdAt = (opts.now ?? Date.now)()
  const id = randomBytes(8).toString('hex')
  const req: HostApprovalRequest = Object.freeze({ ...input, id, createdAt, expiresAt: createdAt + timeoutMs })
  return new Promise<HostApprovalOutcome>((resolve) => {
    const onAbort = (): void => finish(id, 'no-answer')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => finish(id, 'no-answer'), timeoutMs)
    const closer = new AbortController()
    pending.set(id, { req, resolve, timer, closer, cleanup: () => opts.signal?.removeEventListener('abort', onAbort) })
    try {
      d.broadcast(req)
    } catch (err) {
      console.error('[equipo] no se pudo mostrar la tarjeta:', err instanceof Error ? err.message : 'error')
    }
    try {
      d.notify?.(req)
    } catch {
      /* el aviso es opcional */
    }
    let visible = false
    try {
      visible = d.hasVisibleHost()
    } catch {
      visible = false
    }
    if (!visible && d.fallback) {
      void d
        .fallback(req, closer.signal)
        .then((decision) => {
          if (decision !== 'open') finish(id, decision === 'allow' ? 'allow' : 'deny')
        })
        .catch(() => finish(id, 'deny'))
    }
  })
}

/** Respuesta de la persona (tarjeta de la ventana o del celular). Una id desconocida o ya resuelta no hace nada. */
export function respondHostApproval(id: string, decision: HostDecision): boolean {
  if (!pending.has(id)) return false
  finish(id, decision === 'allow' ? 'allow' : 'deny')
  return true
}

/** Peticiones pendientes (para repintar las tarjetas al abrir la ventana). */
export function pendingHostApprovals(): HostApprovalRequest[] {
  return [...pending.values()].map((p) => p.req)
}

/** Líneas para la confirmación en el Mac de un «Permitir» que llega del celular: comando completo, motivo y carpeta. */
export function hostApprovalDetail(id: string): string[] | undefined {
  const p = pending.get(id)
  if (!p) return undefined
  return [p.req.command, p.req.reason, p.req.folder]
}

/** Cierra todo lo pendiente como «sin respuesta» (al salir de la app; también en pruebas). */
export function cancelAllHostApprovals(): void {
  for (const id of [...pending.keys()]) finish(id, 'no-answer')
}
