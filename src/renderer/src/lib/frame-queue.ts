/**
 * Cola de elementos que se vacía una vez por frame (F7-B43). Sirve para agrupar los `message.part.delta` del
 * stream: en vez de un `set` de Zustand (y un render) por delta, se encolan y se aplican en lote.
 *
 * El programador de frames es inyectable (`setFrameScheduler`). Por defecto: `requestAnimationFrame` con un
 * respaldo de `setTimeout` (una ventana oculta/minimizada no dispara rAF y el estado no debe quedarse atrás);
 * si no hay rAF (tests en node) el vaciado es SÍNCRONO, es decir, sin agrupar (comportamiento anterior).
 */
export type FrameScheduler = (run: () => void) => void

/** Espera máxima (ms) de un vaciado programado si el frame no llega (ventana oculta). */
export const FRAME_FALLBACK_MS = 100

let override: FrameScheduler | null = null

/** Sustituye el programador (tests). `null` restaura el de por defecto. */
export function setFrameScheduler(fn: FrameScheduler | null): void {
  override = fn
}

const defaultScheduler: FrameScheduler = (run) => {
  if (typeof requestAnimationFrame !== 'function') {
    run()
    return
  }
  let done = false
  const once = (): void => {
    if (done) return
    done = true
    clearTimeout(timer)
    run()
  }
  const timer = setTimeout(once, FRAME_FALLBACK_MS)
  requestAnimationFrame(once)
}

export interface FrameQueue<T> {
  /** Encola un elemento y programa el vaciado si no hay uno pendiente. */
  push: (item: T) => void
  /** Vacía ahora (idempotente; una cola vacía no llama a `drain`). */
  flush: () => void
  /** Descarta lo encolado que cumpla `pred` (todo si se omite). */
  discard: (pred?: (item: T) => boolean) => void
  readonly size: number
}

export function createFrameQueue<T>(drain: (items: T[]) => void): FrameQueue<T> {
  let items: T[] = []
  let scheduled = false
  const flush = (): void => {
    if (items.length === 0) return
    const batch = items
    items = []
    drain(batch)
  }
  return {
    push: (item) => {
      items.push(item)
      if (scheduled) return
      scheduled = true
      ;(override ?? defaultScheduler)(() => {
        scheduled = false
        flush()
      })
    },
    flush,
    discard: (pred) => {
      items = pred ? items.filter((i) => !pred(i)) : []
    },
    get size() {
      return items.length
    }
  }
}
