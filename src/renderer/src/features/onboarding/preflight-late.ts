/**
 * Carrera entre el informe de la revisión de arranque y su plazo (función pura, sin React).
 * Si el informe llega a tiempo, se devuelve tal cual. Si vence el plazo, se devuelve `timedOut` (la app entra igual) y `late` sigue esperando
 * el mismo pedido: cuando llega tarde, quien llama solo arranca la instalación automática en segundo plano, sin abrir la pantalla tarde
 * (decisión: no interrumpir a quien ya está usando la app; lo esencial que falte se vuelve a revisar en el próximo arranque).
 */
export interface Timers {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

export interface ReportRace<T> {
  /** Informe llegado a tiempo; `null` si venció el plazo o la revisión falló. */
  report: T | null
  timedOut: boolean
  /** El informe que llega después del plazo (o `null` si falla). Nunca rechaza. Con informe a tiempo resuelve igual que `report`. */
  late: Promise<T | null>
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
}

export async function raceReport<T>(request: Promise<T | null>, ms: number, timers: Timers = realTimers): Promise<ReportRace<T>> {
  const safe = request.catch(() => null)
  let handle: unknown
  const deadline = new Promise<'timeout'>((res) => {
    handle = timers.set(() => res('timeout'), ms)
  })
  const first = await Promise.race([safe, deadline])
  if (first === 'timeout') return { report: null, timedOut: true, late: safe }
  timers.clear(handle)
  return { report: first, timedOut: false, late: safe }
}
