/**
 * Retiene lo que el usuario teclea en la terminal hasta que el shell esté listo (R3-A).
 *
 * Mientras el shell carga su `.zshrc` el terminal del sistema está en modo «cocinado» y hace eco de cada tecla:
 * lo tecleado se pintaba suelto antes del prompt («e%», «echo …») y se quedaba en la primera línea. Aquí se guarda
 * y se entrega de una vez cuando llega la primera salida del shell (+ una pausa corta) o, si el shell no imprime
 * nada, al cumplirse `maxWaitMs`. Después pasa directo.
 */
export interface InputGate {
  /** Entrega `data` ya (si el shell está listo) o la retiene. */
  push(data: string): void
  /** El shell produjo salida: se libera tras `settleMs`. */
  onOutput(): void
  /** Empieza a contar `maxWaitMs` (llamar al crear el pty). */
  start(): void
  dispose(): void
  readonly ready: boolean
}

export function createInputGate(
  write: (data: string) => void,
  {
    settleMs = 60,
    maxWaitMs = 3000,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  }: {
    settleMs?: number
    maxWaitMs?: number
    setTimer?: (fn: () => void, ms: number) => unknown
    clearTimer?: (h: never) => void
  } = {}
): InputGate {
  let ready = false
  let pending: string[] = []
  let settling = false
  const timers: unknown[] = []
  const release = (): void => {
    if (ready) return
    ready = true
    for (const t of timers.splice(0)) clearTimer(t as never)
    const data = pending.join('')
    pending = []
    if (data) write(data)
  }
  return {
    push(data) {
      if (ready) write(data)
      else pending.push(data)
    },
    onOutput() {
      if (ready || settling) return
      settling = true
      timers.push(setTimer(release, settleMs))
    },
    start() {
      timers.push(setTimer(release, maxWaitMs))
    },
    dispose() {
      ready = true
      pending = []
      for (const t of timers.splice(0)) clearTimer(t as never)
    },
    get ready() {
      return ready
    }
  }
}
