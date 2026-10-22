/**
 * Vigilante del Modo código (`execute`) del motor 1.19.
 *
 * El motor no pone tope de tiempo, de llamadas internas ni de salida a un programa `execute` (prueba real: un `while(true)`
 * corrió 76 s al 100 % de un núcleo y 1500 llamadas MCP pasaron). Aquí `main` observa el flujo de eventos del motor
 * (`/global/event`, un flujo por motor, solo mientras Modo código esté encendido en algún modo) y, si una parte de la
 * herramienta `execute` sigue `running` pasados los topes, aborta SU sesión (`session.abort`, que corta el bucle al instante)
 * y avisa a la persona. Solo mira `execute`: ninguna otra herramienta se toca.
 *
 * Una vigilancia por motor (el sidecar principal y los servidores vivos de Overdrive), con reconexión y reintentos con espera
 * creciente. Cada ejecución en curso lleva un temporizador propio que se limpia al terminar la parte, al quedar ociosa la
 * sesión, al caer el motor o al apagar el vigilante.
 */
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import { buildWatchdogMark, type WatchdogMarkLimit } from '@shared/watchdog-mark'

/** Tope de tiempo de UNA ejecución de `execute` (ms). Un programa legítimo que encadena unas cuantas llamadas MCP tarda segundos. */
export const EXECUTE_MAX_MS = 60_000
/** Tope de llamadas internas (herramientas MCP) de UNA ejecución. El cuadro de pruebas con 1500 pasaba sin freno. */
export const EXECUTE_MAX_CALLS = 200
/** Tope de salida acumulada (bytes) de UNA ejecución: lo que devuelve el programa más lo de sus llamadas. */
export const EXECUTE_MAX_OUTPUT_BYTES = 256 * 1024
/** Cada cuánto se revisa qué motores hay vivos (ms). */
export const WATCHDOG_RESCAN_MS = 5_000

export const EXECUTE_TOOL = 'execute'

export type WatchdogLimit = 'time' | 'calls' | 'output'

export interface WatchdogEngine {
  /** Identidad estable del motor (por ejemplo `baseUrl`): si cambia, es otro proceso. */
  key: string
  baseUrl: string
  authorization: string
}

export interface WatchdogTrip {
  limit: WatchdogLimit
  sessionID: string
  engineKey: string
  elapsedMs: number
  calls: number
  outputBytes: number
}

/** Lo que se escribe en el mensaje abortado para que la conversación diga la causa real. */
export interface WatchdogMarkInput {
  sessionID: string
  messageID: string
  directory?: string
  limit: WatchdogMarkLimit
  value: number
  text: string
}

export interface GlobalEventLike {
  directory?: string
  payload?: { type?: string; properties?: Record<string, unknown> }
}

export interface ExecuteWatchdogDeps {
  /** Motores vivos ahora (vacío si ninguno). */
  engines: () => WatchdogEngine[]
  /** ¿Modo código encendido en algún modo? Si no, no se abre ningún flujo. */
  enabled: () => boolean
  /** Aviso a la persona y constancia en el diagnóstico. */
  onTrip: (trip: WatchdogTrip) => void
  /** Abre el flujo de eventos de un motor. Por defecto, el del SDK. */
  openStream?: (engine: WatchdogEngine, signal: AbortSignal) => Promise<AsyncIterable<unknown>>
  /** Aborta la sesión en el motor; `true` si el motor lo aceptó. Por defecto, el SDK. */
  abort?: (engine: WatchdogEngine, sessionID: string, directory?: string) => Promise<boolean>
  /** ¿La sesión sigue ocupada? Se consulta antes de abortar por tiempo (el fin pudo perderse con el flujo cortado). */
  isBusy?: (engine: WatchdogEngine, sessionID: string, directory?: string) => Promise<boolean>
  /** Texto (en el idioma de la app) de la parte sintética que explica el aborto; por defecto, uno en inglés. */
  describe?: (trip: WatchdogTrip) => string
  /** Escribe en el mensaje abortado la parte sintética con la marca. Por defecto, `part.update` del SDK. Su fallo no impide el aviso. */
  mark?: (engine: WatchdogEngine, input: WatchdogMarkInput) => Promise<void>
  maxMs?: number
  maxCalls?: number
  maxOutputBytes?: number
  rescanMs?: number
  /** Espera base de los reintentos del flujo (ms; crece al doble hasta 10 s). */
  backoffMs?: number
}

export interface ExecuteWatchdog {
  /** Revisa ya qué motores hay y si el vigilante debe estar activo (tras cambiar Ajustes o reiniciar un motor). */
  refresh(): void
  dispose(): void
}

interface Running {
  engine: WatchdogEngine
  sessionID: string
  directory?: string
  messageID?: string
  startedAt: number
  timer: NodeJS.Timeout
  calls: number
  outputBytes: number
  tripped: boolean
}

interface Stream {
  engine: WatchdogEngine
  ctl: AbortController
}

const clientFor = (e: WatchdogEngine): ReturnType<typeof createOpencodeClient> =>
  createOpencodeClient({ baseUrl: e.baseUrl, headers: { Authorization: e.authorization } })

const defaultOpen = async (e: WatchdogEngine, signal: AbortSignal): Promise<AsyncIterable<unknown>> =>
  (await clientFor(e).global.event({ signal, sseMaxRetryAttempts: 0 })).stream as AsyncIterable<unknown>

const defaultAbort = async (e: WatchdogEngine, sessionID: string, directory?: string): Promise<boolean> => {
  const res = await clientFor(e).session.abort({ sessionID, directory })
  return !res.error
}

const defaultIsBusy = async (e: WatchdogEngine, sessionID: string, directory?: string): Promise<boolean> => {
  const res = await clientFor(e).session.status({ directory })
  const type = (res.data as Record<string, { type?: string }> | undefined)?.[sessionID]?.type
  return type === 'busy' || type === 'retry'
}

const defaultMark = async (e: WatchdogEngine, m: WatchdogMarkInput): Promise<void> => {
  // Los ids de parte del motor ordenan por texto: la `z` inicial la deja detrás de las que él crea (hexadecimales).
  const partID = `prt_zwatchdog${Date.now().toString(36)}`
  const res = await clientFor(e).part.update({
    sessionID: m.sessionID,
    messageID: m.messageID,
    partID,
    directory: m.directory,
    part: {
      id: partID,
      sessionID: m.sessionID,
      messageID: m.messageID,
      type: 'text',
      text: m.text,
      synthetic: true,
      metadata: buildWatchdogMark({ limit: m.limit, value: m.value })
    }
  } as never)
  if (res.error) throw new Error('part.update rechazado')
}

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const strLen = (v: unknown): number => (typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : 0)

/** Llamadas internas y bytes de salida de una parte `execute` (`state.metadata.toolCalls`, o `metadata.toolCalls` de la parte). */
export function measureExecutePart(part: Record<string, unknown>): { calls: number; outputBytes: number } {
  const state = rec(part.state)
  const meta = rec(state?.metadata) ?? rec(part.metadata)
  const list = Array.isArray(meta?.toolCalls) ? (meta?.toolCalls as unknown[]) : []
  let bytes = strLen(state?.output) + strLen(meta?.output)
  for (const c of list) {
    const call = rec(c)
    if (!call) continue
    bytes += strLen(call.output) + strLen(call.error) + strLen(rec(call.state)?.output)
  }
  return { calls: list.length, outputBytes: bytes }
}

/** Clave de mensaje (`merr.engine.execute.*`) y parámetros para avisar de un aborto. */
export function tripMessage(
  trip: WatchdogTrip,
  limits: { maxMs?: number; maxCalls?: number; maxOutputBytes?: number } = {}
): {
  key: 'merr.engine.execute.time' | 'merr.engine.execute.calls' | 'merr.engine.execute.output'
  params: Record<string, string | number>
} {
  if (trip.limit === 'calls') return { key: 'merr.engine.execute.calls', params: { count: limits.maxCalls ?? EXECUTE_MAX_CALLS } }
  if (trip.limit === 'output')
    return { key: 'merr.engine.execute.output', params: { kb: Math.round((limits.maxOutputBytes ?? EXECUTE_MAX_OUTPUT_BYTES) / 1024) } }
  return { key: 'merr.engine.execute.time', params: { seconds: Math.round((limits.maxMs ?? EXECUTE_MAX_MS) / 1000) } }
}

export function installExecuteWatchdog(deps: ExecuteWatchdogDeps): ExecuteWatchdog {
  const maxMs = deps.maxMs ?? EXECUTE_MAX_MS
  const maxCalls = deps.maxCalls ?? EXECUTE_MAX_CALLS
  const maxOutput = deps.maxOutputBytes ?? EXECUTE_MAX_OUTPUT_BYTES
  const openStream = deps.openStream ?? defaultOpen
  const abortSession = deps.abort ?? defaultAbort
  const isBusy = deps.isBusy ?? defaultIsBusy
  const markAborted = deps.mark ?? defaultMark
  const backoffBase = deps.backoffMs ?? 500
  const streams = new Map<string, Stream>()
  const running = new Map<string, Running>()
  let rescan: NodeJS.Timeout | null = null
  let disposed = false

  const runKey = (e: WatchdogEngine, sessionID: string, partID: string): string => `${e.key}\u0000${sessionID}\u0000${partID}`

  const drop = (key: string): void => {
    const r = running.get(key)
    if (!r) return
    clearTimeout(r.timer)
    running.delete(key)
  }
  const dropWhere = (pred: (r: Running) => boolean): void => {
    for (const [k, r] of [...running]) if (pred(r)) drop(k)
  }

  async function trip(key: string, limit: WatchdogLimit): Promise<void> {
    const r = running.get(key)
    if (!r || r.tripped || disposed) return
    r.tripped = true
    const info: WatchdogTrip = {
      limit,
      sessionID: r.sessionID,
      engineKey: r.engine.key,
      elapsedMs: Date.now() - r.startedAt,
      calls: r.calls,
      outputBytes: r.outputBytes
    }
    try {
      // Por tiempo: si el flujo estuvo cortado puede haberse perdido el fin; no se aborta una sesión que ya terminó.
      if (limit === 'time' && !(await isBusy(r.engine, r.sessionID, r.directory))) {
        drop(key)
        return
      }
      const ok = await abortSession(r.engine, r.sessionID, r.directory)
      if (disposed) return
      if (ok && r.messageID) {
        // Deja la causa real en la conversación (si no, diría «Detenido por el usuario»). Un fallo no impide el aviso.
        try {
          const msg = tripMessage(info, { maxMs, maxCalls, maxOutputBytes: maxOutput })
          const value = Number(Object.values(msg.params)[0])
          const text = deps.describe?.(info) ?? `Code mode program stopped by the safety limit (${info.limit}).`
          await markAborted(r.engine, { sessionID: r.sessionID, messageID: r.messageID, directory: r.directory, limit, value, text })
        } catch (err) {
          console.error('[execute-watchdog] no se pudo dejar la causa en la conversación:', err)
        }
        if (disposed) return
      }
      if (!ok) {
        // El motor no lo aceptó: se permite reintentar con la próxima actualización de la parte.
        r.tripped = false
        return
      }
      deps.onTrip(info)
    } catch (err) {
      console.error('[execute-watchdog] no se pudo abortar la sesión:', err)
      r.tripped = false
    }
  }

  function onPart(engine: WatchdogEngine, directory: string | undefined, part: Record<string, unknown>): void {
    if (part.type !== 'tool' || part.tool !== EXECUTE_TOOL) return
    const sessionID = part.sessionID
    const partID = part.id
    if (typeof sessionID !== 'string' || typeof partID !== 'string') return
    const key = runKey(engine, sessionID, partID)
    const status = rec(part.state)?.status
    if (status !== 'running') {
      if (status === 'completed' || status === 'error') drop(key)
      return
    }
    let r = running.get(key)
    if (!r) {
      const timer = setTimeout(() => void trip(key, 'time'), maxMs)
      timer.unref?.()
      r = {
        engine,
        sessionID,
        directory,
        messageID: typeof part.messageID === 'string' ? part.messageID : undefined,
        startedAt: Date.now(),
        timer,
        calls: 0,
        outputBytes: 0,
        tripped: false
      }
      running.set(key, r)
    }
    const m = measureExecutePart(part)
    r.calls = m.calls
    r.outputBytes = m.outputBytes
    if (r.calls > maxCalls) void trip(key, 'calls')
    else if (r.outputBytes > maxOutput) void trip(key, 'output')
  }

  function onEvent(engine: WatchdogEngine, raw: unknown): void {
    if (disposed) return
    const ev = rec(raw) as GlobalEventLike | null
    const type = ev?.payload?.type
    const p = ev?.payload?.properties
    if (typeof type !== 'string' || !p) return
    const directory = typeof ev?.directory === 'string' ? ev.directory : undefined
    switch (type) {
      case 'message.part.updated': {
        const part = rec(p.part)
        if (part) onPart(engine, directory, part)
        return
      }
      case 'session.idle':
      case 'session.error':
        if (typeof p.sessionID === 'string') dropWhere((r) => r.engine.key === engine.key && r.sessionID === p.sessionID)
        return
      case 'session.status': {
        const t = rec(p.status)?.type
        if (t === 'idle' && typeof p.sessionID === 'string') dropWhere((r) => r.engine.key === engine.key && r.sessionID === p.sessionID)
        return
      }
      case 'session.deleted': {
        const id = rec(p.info)?.id
        if (typeof id === 'string') dropWhere((r) => r.engine.key === engine.key && r.sessionID === id)
        return
      }
    }
  }

  async function streamLoop(s: Stream): Promise<void> {
    let attempt = 0
    while (!s.ctl.signal.aborted && !disposed) {
      try {
        const stream = await openStream(s.engine, s.ctl.signal)
        for await (const raw of stream) {
          if (s.ctl.signal.aborted || disposed) return
          attempt = 0
          onEvent(s.engine, raw)
        }
      } catch {
        // se reintenta
      }
      if (s.ctl.signal.aborted || disposed) return
      attempt++
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, Math.min(backoffBase * 2 ** attempt, 10_000))
        t.unref?.()
        s.ctl.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            resolve()
          },
          { once: true }
        )
      })
    }
  }

  function stopStream(key: string): void {
    const s = streams.get(key)
    if (!s) return
    s.ctl.abort()
    streams.delete(key)
    dropWhere((r) => r.engine.key === key)
  }

  function reconcile(): void {
    if (disposed) return
    const wanted = deps.enabled() ? deps.engines() : []
    const keys = new Set(wanted.map((e) => e.key))
    for (const key of [...streams.keys()]) if (!keys.has(key)) stopStream(key)
    for (const engine of wanted) {
      if (streams.has(engine.key)) continue
      const s: Stream = { engine, ctl: new AbortController() }
      streams.set(engine.key, s)
      void streamLoop(s)
    }
  }

  function schedule(): void {
    if (disposed) return
    rescan = setTimeout(() => {
      rescan = null
      try {
        reconcile()
      } catch (err) {
        console.error('[execute-watchdog] revisión:', err)
      }
      schedule()
    }, deps.rescanMs ?? WATCHDOG_RESCAN_MS)
    rescan.unref?.()
  }

  reconcile()
  schedule()

  return {
    refresh: reconcile,
    dispose() {
      if (disposed) return
      disposed = true
      if (rescan) clearTimeout(rescan)
      rescan = null
      for (const key of [...streams.keys()]) stopStream(key)
      for (const key of [...running.keys()]) drop(key)
    }
  }
}
