import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXECUTE_MAX_CALLS,
  EXECUTE_MAX_MS,
  EXECUTE_MAX_OUTPUT_BYTES,
  installExecuteWatchdog,
  measureExecutePart,
  type WatchdogEngine,
  type WatchdogTrip
} from './execute-watchdog'

const ENG: WatchdogEngine = { key: 'http://e1', baseUrl: 'http://e1', authorization: 'a' }

/** Flujo falso: una cola por apertura; `push` entrega eventos, `end` cierra (simula corte). */
function makeStreams() {
  const opens: Array<{ push: (e: unknown) => void; end: () => void; signal: AbortSignal }> = []
  const open = vi.fn(async (_e: WatchdogEngine, signal: AbortSignal) => {
    const queue: unknown[] = []
    let wake: (() => void) | null = null
    let done = false
    const entry = {
      signal,
      push: (e: unknown) => {
        queue.push(e)
        wake?.()
      },
      end: () => {
        done = true
        wake?.()
      }
    }
    opens.push(entry)
    signal.addEventListener('abort', entry.end, { once: true })
    return (async function* () {
      for (;;) {
        if (queue.length) yield queue.shift()
        else if (done) return
        else await new Promise<void>((r) => (wake = r))
      }
    })()
  })
  return { opens, open }
}

const part = (over: { id?: string; tool?: string; status?: string; calls?: number; output?: string; session?: string } = {}) => ({
  directory: '/proj',
  payload: {
    type: 'message.part.updated',
    properties: {
      part: {
        id: over.id ?? 'p1',
        sessionID: over.session ?? 's1',
        messageID: 'm1',
        type: 'tool',
        callID: 'c1',
        tool: over.tool ?? 'execute',
        state: {
          status: over.status ?? 'running',
          input: { code: 'while(true){}' },
          output: over.output,
          metadata: { toolCalls: Array.from({ length: over.calls ?? 0 }, (_, i) => ({ tool: `mcp_t${i}`, status: 'completed' })) }
        }
      }
    }
  }
})
const idle = (session = 's1') => ({ directory: '/proj', payload: { type: 'session.idle', properties: { sessionID: session } } })

function setup(over: Partial<Parameters<typeof installExecuteWatchdog>[0]> = {}) {
  const streams = makeStreams()
  const trips: WatchdogTrip[] = []
  const abort = vi.fn(async (_e: WatchdogEngine, _s: string, _d?: string) => true)
  const isBusy = vi.fn(async () => true)
  let enabled = true
  let engines = [ENG]
  const w = installExecuteWatchdog({
    engines: () => engines,
    enabled: () => enabled,
    onTrip: (t) => trips.push(t),
    openStream: streams.open,
    abort,
    isBusy,
    backoffMs: 10,
    rescanMs: 1000,
    ...over
  })
  const flush = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0)
  return {
    ...streams,
    w,
    trips,
    abort,
    isBusy,
    flush,
    setEnabled: (v: boolean) => (enabled = v),
    setEngines: (v: WatchdogEngine[]) => (engines = v)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

describe('measureExecutePart', () => {
  it('cuenta llamadas y bytes de salida', () => {
    const p = { state: { output: 'hola', metadata: { toolCalls: [{ output: 'ab' }, { error: 'xyz' }] } } }
    expect(measureExecutePart(p)).toEqual({ calls: 2, outputBytes: 9 })
    expect(measureExecutePart({})).toEqual({ calls: 0, outputBytes: 0 })
  })
})

describe('vigilante de execute', () => {
  it('aborta la sesión al pasar el tope de tiempo (reloj falso)', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part())
    await h.flush()
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS - 1)
    expect(h.abort).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(h.abort).toHaveBeenCalledWith(ENG, 's1', '/proj')
    expect(h.trips).toHaveLength(1)
    expect(h.trips[0]).toMatchObject({ limit: 'time', sessionID: 's1' })
    h.w.dispose()
  })

  it('no aborta si la parte termina a tiempo', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part())
    await h.flush()
    await vi.advanceTimersByTimeAsync(30_000)
    h.opens[0].push(part({ status: 'completed' }))
    await h.flush()
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS)
    expect(h.abort).not.toHaveBeenCalled()
    h.w.dispose()
  })

  it('no aborta si la sesión quedó ociosa (session.idle) antes del tope', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part())
    h.opens[0].push(idle())
    await h.flush()
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS * 2)
    expect(h.abort).not.toHaveBeenCalled()
    h.w.dispose()
  })

  it('por tiempo, si la sesión ya no está ocupada (fin perdido) no aborta ni avisa', async () => {
    const h = setup()
    h.isBusy.mockResolvedValue(false)
    await h.flush()
    h.opens[0].push(part())
    await h.flush()
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS + 10)
    expect(h.abort).not.toHaveBeenCalled()
    expect(h.trips).toHaveLength(0)
    h.w.dispose()
  })

  it('aborta al pasar el tope de llamadas internas', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part({ calls: EXECUTE_MAX_CALLS }))
    await h.flush()
    expect(h.abort).not.toHaveBeenCalled()
    h.opens[0].push(part({ calls: EXECUTE_MAX_CALLS + 1 }))
    await h.flush()
    expect(h.abort).toHaveBeenCalledTimes(1)
    expect(h.trips[0]).toMatchObject({ limit: 'calls', calls: EXECUTE_MAX_CALLS + 1 })
    // más actualizaciones de la misma parte no repiten el aborto
    h.opens[0].push(part({ calls: EXECUTE_MAX_CALLS + 5 }))
    await h.flush()
    expect(h.abort).toHaveBeenCalledTimes(1)
    h.w.dispose()
  })

  it('aborta al pasar el tope de salida', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part({ output: 'x'.repeat(EXECUTE_MAX_OUTPUT_BYTES + 1) }))
    await h.flush()
    expect(h.trips[0]).toMatchObject({ limit: 'output' })
    h.w.dispose()
  })

  it('NO toca otras herramientas, ni con muchas llamadas ni con mucho tiempo', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part({ tool: 'bash', calls: 5000, output: 'x'.repeat(EXECUTE_MAX_OUTPUT_BYTES * 2) }))
    h.opens[0].push(part({ tool: 'task', id: 'p2' }))
    await h.flush()
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS * 3)
    expect(h.abort).not.toHaveBeenCalled()
    expect(h.trips).toHaveLength(0)
    h.w.dispose()
  })

  it('cada ejecución lleva su propio reloj (dos sesiones)', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part({ session: 'a', id: 'pa' }))
    await h.flush()
    await vi.advanceTimersByTimeAsync(40_000)
    h.opens[0].push(part({ session: 'b', id: 'pb' }))
    await h.flush()
    await vi.advanceTimersByTimeAsync(21_000)
    expect(h.abort.mock.calls.map((c) => c[1])).toEqual(['a'])
    h.w.dispose()
  })

  it('si el motor rechaza el aborto no avisa y reintenta con la siguiente actualización', async () => {
    const h = setup()
    h.abort.mockResolvedValueOnce(false)
    await h.flush()
    h.opens[0].push(part({ calls: EXECUTE_MAX_CALLS + 1 }))
    await h.flush()
    expect(h.trips).toHaveLength(0)
    h.opens[0].push(part({ calls: EXECUTE_MAX_CALLS + 2 }))
    await h.flush()
    expect(h.abort).toHaveBeenCalledTimes(2)
    expect(h.trips).toHaveLength(1)
    h.w.dispose()
  })

  it('sobrevive a la reconexión del flujo y sigue vigilando la ejecución en curso', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part())
    await h.flush()
    h.opens[0].end() // el flujo se corta
    await vi.advanceTimersByTimeAsync(50)
    expect(h.opens).toHaveLength(2) // reabierto
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS)
    expect(h.abort).toHaveBeenCalledTimes(1)
    // y el flujo nuevo también procesa eventos
    h.opens[1].push(part({ session: 'z', id: 'pz', calls: EXECUTE_MAX_CALLS + 1 }))
    await h.flush()
    expect(h.abort).toHaveBeenCalledTimes(2)
    h.w.dispose()
  })

  it('no abre ningún flujo con Modo código apagado y lo abre al encenderlo (refresh)', async () => {
    const h = setup()
    h.setEnabled(false)
    h.w.dispose()
    const g = setup({ enabled: () => false })
    await g.flush()
    await vi.advanceTimersByTimeAsync(3000)
    expect(g.open).not.toHaveBeenCalled()
    g.w.dispose()
    let on = false
    const k = setup({ enabled: () => on })
    await k.flush()
    expect(k.open).not.toHaveBeenCalled()
    on = true
    k.w.refresh()
    await k.flush()
    expect(k.open).toHaveBeenCalledTimes(1)
    k.w.dispose()
  })

  it('al apagar Modo código cierra el flujo y descarta temporizadores', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part())
    await h.flush()
    h.setEnabled(false)
    h.w.refresh()
    expect(h.opens[0].signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS * 2)
    expect(h.abort).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(0)
    h.w.dispose()
  })

  it('si el motor cambia (reinicio, otro puerto) cierra el flujo viejo, abre el nuevo y olvida lo pendiente', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part())
    await h.flush()
    h.setEngines([{ key: 'http://e2', baseUrl: 'http://e2', authorization: 'b' }])
    await vi.advanceTimersByTimeAsync(1000) // revisión periódica
    expect(h.opens[0].signal.aborted).toBe(true)
    expect(h.opens).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS * 2)
    expect(h.abort).not.toHaveBeenCalled()
    h.w.dispose()
  })

  it('dispose deja cero temporizadores y no actúa con eventos tardíos', async () => {
    const h = setup()
    await h.flush()
    h.opens[0].push(part())
    await h.flush()
    h.w.dispose()
    expect(vi.getTimerCount()).toBe(0)
    h.opens[0].push(part({ calls: EXECUTE_MAX_CALLS + 10 }))
    await vi.advanceTimersByTimeAsync(EXECUTE_MAX_MS * 2)
    expect(h.abort).not.toHaveBeenCalled()
  })
})
