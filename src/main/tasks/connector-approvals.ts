/**
 * Aprobación en MAIN de las herramientas de los conectores de la persona marcados «preguntar cada herramienta», en Tareas aisladas.
 *
 * Antes, la única barrera era `<conector>_*: ask` en el motor, que vive en la jaula con los programas de la tarea: un programa que leyera
 * el token de la ruta del proxy MCP llamaba a cualquier herramienta con la identidad de la persona. Ahora el proxy (`mcp-proxy.ts`,
 * `toolCallGate`) retiene cada `tools/call` de esas rutas hasta que la persona decide aquí, y reenvía exactamente lo que vio.
 *
 * Igual que `equipo` (`host-exec/approvals.ts`): tarjeta propia de main con los argumentos completos; «No» por defecto; vence denegando;
 * una tarjeta a la vez por tarea y conector («ocupado»); 30 s sin tarjetas tras un «No» o sin respuesta; pausa de 10 min tras 3 «No»
 * seguidos; desde el celular solo se puede negar (o confirmar en el computador). Además, «Permitir en esta tarea» para ESA herramienta
 * exacta: memoria de main que se borra al cerrar la tarea (la puerta es de la ruta, que muere con el servidor). Nunca «siempre».
 * No importa `electron`: la tarjeta y el diálogo nativo los pone `ipc/tasks-connector-handlers.ts`.
 */
import { randomBytes } from 'node:crypto'
import type { ConnectorApprovalRequest, ConnectorDecision } from '@shared/ipc-tasks'
import { revealHiddenChars } from '../host-exec/policy'
import type { McpRouteSpec, ToolCallGate, ToolCallVerdict } from './mcp-proxy'

export const CONNECTOR_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000
export const CONNECTOR_COOLDOWN_MS = 30_000
export const CONNECTOR_NO_STREAK_FOR_PAUSE = 3
export const CONNECTOR_PAUSE_MS = 10 * 60 * 1000
/** Más que esto no se puede revisar en una tarjeta: se rechaza sin preguntar. */
export const CONNECTOR_MAX_ARGS_CHARS = 20_000

export type ConnectorOutcome = ConnectorDecision | 'no-answer'

export interface ConnectorApprovalsDeps {
  hasVisibleHost(): boolean
  broadcast(req: ConnectorApprovalRequest): void
  broadcastDone(id: string): void
  notify?(req: ConnectorApprovalRequest): void
  /** Diálogo nativo sin ventana visible. `open` = pidió abrir la app (no decide); `null` = cerrado sin elegir («No»). */
  fallback?(req: ConnectorApprovalRequest, signal: AbortSignal): Promise<ConnectorDecision | 'open' | null>
}

let deps: ConnectorApprovalsDeps | null = null
export function initConnectorApprovals(d: ConnectorApprovalsDeps | null): void {
  deps = d
}

interface Pending {
  req: ConnectorApprovalRequest
  resolve(o: ConnectorOutcome): void
  timer: ReturnType<typeof setTimeout>
  cleanup(): void
  closer: AbortController
}
const pending = new Map<string, Pending>()

function finish(id: string, outcome: ConnectorOutcome): void {
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
    /* nunca cambia la decisión */
  }
}

/** Pide la decisión a la persona. Sin inicializar, al vencer o al cortarse la petición: `no-answer`. */
export function requestConnectorApproval(
  input: Omit<ConnectorApprovalRequest, 'id' | 'createdAt' | 'expiresAt'>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ConnectorOutcome> {
  const d = deps
  if (!d || opts.signal?.aborted) return Promise.resolve('no-answer')
  const timeoutMs = opts.timeoutMs ?? CONNECTOR_APPROVAL_TIMEOUT_MS
  const createdAt = Date.now()
  const id = randomBytes(8).toString('hex')
  const req: ConnectorApprovalRequest = Object.freeze({ ...input, id, createdAt, expiresAt: createdAt + timeoutMs })
  return new Promise<ConnectorOutcome>((resolve) => {
    const onAbort = (): void => finish(id, 'no-answer')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => finish(id, 'no-answer'), timeoutMs)
    const closer = new AbortController()
    pending.set(id, { req, resolve, timer, closer, cleanup: () => opts.signal?.removeEventListener('abort', onAbort) })
    try {
      d.broadcast(req)
    } catch (err) {
      console.error('[conectores] no se pudo mostrar la tarjeta:', err instanceof Error ? err.message : 'error')
    }
    try {
      d.notify?.(req)
    } catch {
      /* opcional */
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
          if (decision !== 'open') finish(id, decision ?? 'deny')
        })
        .catch(() => finish(id, 'deny'))
    }
  })
}

export function respondConnectorApproval(id: string, decision: ConnectorDecision): boolean {
  if (!pending.has(id)) return false
  finish(id, decision === 'allow' || decision === 'task' ? decision : 'deny')
  return true
}

export function pendingConnectorApprovals(): ConnectorApprovalRequest[] {
  return [...pending.values()].map((p) => p.req)
}

/** Para la confirmación en el computador de un «Permitir» que llega del celular: conector y herramienta, argumentos y carpeta. */
export function connectorApprovalDetail(id: string): string[] | undefined {
  const p = pending.get(id)
  return p ? [`${p.req.server} · ${p.req.tool}`, p.req.args, p.req.folder] : undefined
}

export function cancelAllConnectorApprovals(): void {
  for (const id of [...pending.keys()]) finish(id, 'no-answer')
}

// ─────────────────────────────── puerta del proxy ───────────────────────────────

interface GateState {
  cooldownUntil: number
  noStreak: number
  pausedUntil: number
  busy: boolean
}
/** Por carpeta y conector, a nivel de módulo: reiniciar la tarea (rutas y tokens nuevos) no lo pone a cero. */
const gateStates = new Map<string, GateState>()
const stateOf = (key: string): GateState => {
  let s = gateStates.get(key)
  if (!s) gateStates.set(key, (s = { cooldownUntil: 0, noStreak: 0, pausedUntil: 0, busy: false }))
  return s
}

/** Solo pruebas. */
export function resetConnectorGatesForTests(): void {
  gateStates.clear()
}

export const CONNECTOR_TEXTS = {
  denied: 'La persona no aprobó esta llamada al conector. No la repitas igual: sigue sin ella o pregúntale en el chat qué prefiere.',
  noAnswer:
    'La persona no respondió a tiempo y la herramienta del conector no se usó. No la repitas en bucle: avísale en el chat de lo que necesitas.',
  busy: 'Ya hay otra llamada a este conector esperando la respuesta de la persona; espera a que responda.',
  cooldown: (s: number): string =>
    `La persona acaba de rechazar o no respondió una llamada a este conector. Espera ${s} s antes de pedir otra, y no repitas la misma.`,
  pauseHead: 'La persona rechazó varias llamadas seguidas a este conector.',
  paused: (min: number): string =>
    `La persona rechazó varias llamadas seguidas a este conector. Queda en pausa ${min} min para esta tarea. Deja de pedirlo: sigue sin él o pregúntale en el chat.`,
  tooLong: 'Los argumentos son demasiado largos para que la persona los revise: divide la llamada o usa menos datos.',
  failed: 'No se pudo pedir la aprobación de la persona; la herramienta no se usó.'
} as const

/**
 * Puerta para la ruta de UN conector de UNA tarea (se crea al arrancar su servidor y muere con él, con su memoria de «en esta tarea»).
 * `approve` se puede sustituir en pruebas.
 */
export function createConnectorGate(opts: {
  folder: string
  server: string
  approve?: (input: Omit<ConnectorApprovalRequest, 'id' | 'createdAt' | 'expiresAt'>, signal: AbortSignal) => Promise<ConnectorOutcome>
  now?: () => number
  audit?: (e: { at: number; folder: string; server: string; tool: string; result: string }) => void
}): ToolCallGate {
  const now = opts.now ?? Date.now
  const approve = opts.approve ?? ((input, signal) => requestConnectorApproval(input, { signal }))
  const allowedInTask = new Set<string>()
  const key = `${opts.folder}\0${opts.server}`
  const audit = (tool: string, result: string): void => {
    try {
      ;(opts.audit ?? ((e) => console.log('[conectores]', JSON.stringify(e))))({
        at: now(),
        folder: opts.folder,
        server: opts.server,
        tool,
        result
      })
    } catch {
      /* nunca rompe */
    }
  }
  return async (call, signal): Promise<ToolCallVerdict> => {
    if (allowedInTask.has(call.tool)) {
      audit(call.tool, 'permitido-en-esta-tarea')
      return { ok: true }
    }
    const st = stateOf(key)
    const t0 = now()
    if (t0 < st.pausedUntil) {
      audit(call.tool, 'pausa')
      return { ok: false, message: CONNECTOR_TEXTS.paused(Math.ceil((st.pausedUntil - t0) / 60_000)) }
    }
    if (t0 < st.cooldownUntil) {
      audit(call.tool, 'enfriamiento')
      return { ok: false, message: CONNECTOR_TEXTS.cooldown(Math.ceil((st.cooldownUntil - t0) / 1000)) }
    }
    if (st.busy) {
      audit(call.tool, 'ocupado')
      return { ok: false, message: CONNECTOR_TEXTS.busy }
    }
    let args: string
    try {
      args = revealHiddenChars(JSON.stringify(call.args ?? {}, null, 2) ?? '{}')
    } catch {
      return { ok: false, message: CONNECTOR_TEXTS.failed }
    }
    if (args.length > CONNECTOR_MAX_ARGS_CHARS) {
      audit(call.tool, 'demasiado-largo')
      return { ok: false, message: CONNECTOR_TEXTS.tooLong }
    }
    st.busy = true
    let outcome: ConnectorOutcome = 'no-answer'
    try {
      outcome = await approve({ folder: opts.folder, server: opts.server, tool: revealHiddenChars(call.tool), args }, signal)
    } catch {
      outcome = 'no-answer'
    } finally {
      st.busy = false
    }
    if (outcome === 'allow' || outcome === 'task') {
      if (signal.aborted) {
        audit(call.tool, 'sin-respuesta')
        return { ok: false, message: CONNECTOR_TEXTS.noAnswer }
      }
      st.noStreak = 0
      if (outcome === 'task') allowedInTask.add(call.tool)
      audit(call.tool, outcome === 'task' ? 'aprobado-en-esta-tarea' : 'aprobado')
      return { ok: true }
    }
    const at = now()
    st.cooldownUntil = at + CONNECTOR_COOLDOWN_MS
    audit(call.tool, outcome === 'deny' ? 'rechazado' : 'sin-respuesta')
    if (outcome === 'deny' && ++st.noStreak >= CONNECTOR_NO_STREAK_FOR_PAUSE) {
      st.noStreak = 0
      st.pausedUntil = at + CONNECTOR_PAUSE_MS
      return { ok: false, message: `${CONNECTOR_TEXTS.denied}\n${CONNECTOR_TEXTS.paused(CONNECTOR_PAUSE_MS / 60_000)}` }
    }
    return { ok: false, message: outcome === 'deny' ? CONNECTOR_TEXTS.denied : CONNECTOR_TEXTS.noAnswer }
  }
}

/**
 * Ruta del proxy para un conector con «preguntar cada herramienta» (H2): SOLO su ruta exacta (ni la API REST del mismo servicio ni otras
 * rutas con las cabeceras de la persona) y la puerta de main.
 */
export function gatedConnectorRoute(spec: McpRouteSpec, folder: string): McpRouteSpec {
  return { ...spec, exactPath: true, toolCallGate: createConnectorGate({ folder, server: spec.name }) }
}
