/**
 * Debounce puro con espera final (`wait`) y espera máxima (`maxWait`): agrupa una ráfaga de llamadas en
 * una sola ejecución, pero garantiza que una ráfaga continua se ejecute al menos cada `maxWait` ms.
 * Los timers son inyectables (por defecto `setTimeout`/`clearTimeout`, compatibles con `vi.useFakeTimers()`).
 */
export interface Debounced {
  (): void
  /** Descarta la ejecución pendiente (sin ejecutarla). */
  cancel: () => void
  /** Hay una ejecución pendiente. */
  pending: () => boolean
}

export interface DebounceOptions {
  wait: number
  maxWait?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

export function debounce(fn: () => void, opts: DebounceOptions): Debounced {
  const { wait, maxWait } = opts
  const now = opts.now ?? (() => Date.now())
  const setTimer = opts.setTimer ?? ((f, ms) => setTimeout(f, ms))
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))
  let timer: unknown = null
  let firstCall = 0

  const fire = (): void => {
    timer = null
    fn()
  }

  const debounced = ((): void => {
    const t = now()
    if (timer === null) firstCall = t
    else clearTimer(timer)
    const untilMax = maxWait === undefined ? wait : Math.max(0, firstCall + maxWait - t)
    timer = setTimer(fire, Math.min(wait, untilMax))
  }) as Debounced

  debounced.cancel = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }
  debounced.pending = () => timer !== null
  return debounced
}
