import {
  outputView,
  viewFromEmulated,
  SETTLE_MS,
  STABLE_DONE_MS,
  STABLE_RUNNING_MS,
  type OutputView,
  type ShareStatus,
  type WaitKind
} from '@shared/terminal-capture'

/**
 * Captura la salida de UN comando ejecutado con ▶ (lo que el shell imprime tras escribirlo; nunca las teclas). Decide cuándo
 * «terminó» y avisa UNA sola vez (`onShare`) con el estado: `done` (el shell volvió al prompt, o hubo ~3 s de calma sin poder
 * reconocer el prompt), `waiting` (pide contraseña o s/n: solo va lo previo) o `running` (sigue tras ~5 s de salida estable: servidor).
 * Después de compartir sigue actualizando la tarjeta pero nunca vuelve a avisar.
 */
export interface CaptureSnapshot {
  view: OutputView
  status: 'running' | 'done' | 'waiting'
  waitKind: WaitKind | null
}

interface Opts {
  /** Última línea del búfer ANTES de escribir el comando (el prompt del shell), para reconocer su regreso. */
  promptLine: string
  /** Comando tal como se tecleó y ancho del terminal: para quitar el eco y emular el redibujado. */
  command: string
  /**
   * Texto que muestra el terminal desde la fila del prompt (búfer de xterm). Si se da, manda sobre el flujo crudo: es lo que ve la
   * persona, sin depender del ancho ni de los redibujados del shell.
   */
  readText?: () => string
  /** Ancho real del terminal en este momento (se lee en cada paso: el panel puede ajustarse al abrirse). */
  cols: () => number
  onShare: (view: OutputView, status: ShareStatus) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: never) => void
}

const MAX_RAW = 200_000

export class OutputCapture {
  private raw = ''
  private snap: CaptureSnapshot
  private readonly listeners = new Set<() => void>()
  private timer: unknown = null
  private shared = false
  private disposed = false
  /** El comando terminó (el shell volvió al prompt): lo que se teclee después ya no es de este comando. */
  private finished = false
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: never) => void
  private promptKnown: boolean

  constructor(private readonly opts: Opts) {
    this.promptKnown = opts.promptLine.trim().length >= 2
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.snap = { view: this.view(), status: 'running', waitKind: null }
    this.schedule(this.promptKnown ? STABLE_RUNNING_MS : STABLE_DONE_MS, this.promptKnown ? 'running' : 'done')
  }

  getSnapshot = (): CaptureSnapshot => this.snap
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  push(data: string): void {
    if (this.disposed || this.finished || data === '') return
    this.raw += data
    if (this.raw.length > MAX_RAW) this.raw = this.raw.slice(this.raw.length - MAX_RAW)
    const view = this.view()
    this.promptKnown = view.promptKnown
    let status: CaptureSnapshot['status'] = 'running'
    if (view.waitKind) status = 'waiting'
    else if (this.promptKnown && view.promptReturned) status = 'done'
    this.snap = { view, status, waitKind: view.waitKind }
    if (status === 'done') this.finished = true
    for (const l of [...this.listeners]) l()
    if (status === 'waiting') this.schedule(SETTLE_MS, 'waiting')
    else if (status === 'done') this.schedule(SETTLE_MS, 'done')
    else this.schedule(this.promptKnown ? STABLE_RUNNING_MS : STABLE_DONE_MS, this.promptKnown ? 'running' : 'done')
  }

  private view(): OutputView {
    if (this.opts.readText) return viewFromEmulated(this.opts.readText(), this.opts.promptLine, this.opts.command)
    return outputView(this.raw, this.opts.promptLine, { command: this.opts.command, cols: this.opts.cols() })
  }

  private schedule(ms: number, share: ShareStatus): void {
    if (this.timer !== null) this.clearTimer(this.timer as never)
    this.timer = this.setTimer(() => {
      this.timer = null
      if (this.disposed) return
      if (share === 'done' && this.snap.status === 'running') {
        this.snap = { ...this.snap, status: 'done' }
        for (const l of [...this.listeners]) l()
      }
      if (this.shared) return
      this.shared = true
      this.opts.onShare(this.snap.view, share)
    }, ms)
  }

  /** ¿Ya se avisó (para no repetir)? */
  get wasShared(): boolean {
    return this.shared
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) this.clearTimer(this.timer as never)
    this.timer = null
    this.listeners.clear()
  }
}
