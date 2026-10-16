import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { errorMessage, requireCode } from '../client'
import { useCode } from '../store'
import { createInputGate, type InputGate } from './inputGate'
import { OutputCapture } from './outputCapture'
import type { OutputView, ShareStatus } from '@shared/terminal-capture'

/**
 * Registro de terminales de Code (F8-B32). El shell (pty) y su `Terminal` de xterm viven AQUÍ, fuera de React:
 * al cambiar de modo o abrir Ajustes la vista Code se desmonta, pero el pty sigue vivo con su scrollback y
 * `TerminalPanel` solo vuelve a enganchar el elemento DOM. Una terminal por proyecto (`directory`); se
 * descarta al cambiar/cerrar el proyecto (`disposeTerminalsExcept`), al reiniciarla o al salir.
 */

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function themeFromCss(): ITheme {
  return {
    background: cssVar('--bg-code', '#151412'),
    foreground: cssVar('--fg', '#ecebe6'),
    cursor: cssVar('--accent', '#2dd4bf'),
    cursorAccent: cssVar('--bg-code', '#151412'),
    selectionBackground: cssVar('--accent-soft', '#173a36')
  }
}

export interface TerminalSnapshot {
  error: string | null
  /** Código de salida del shell (null = sigue vivo). */
  exited: number | null
}

export class TerminalEntry {
  readonly term: Terminal
  readonly fit = new FitAddon()
  /** Contenedor propio de xterm: se mueve entre paneles sin recrear la terminal. */
  readonly el: HTMLDivElement
  ptyId: string | null = null
  private snapshot: TerminalSnapshot = { error: null, exited: null }
  private readonly listeners = new Set<() => void>()
  private opened = false
  private disposed = false
  /** Puerta de entrada al shell (existe cuando el pty ya se creó) y lo tecleado mientras tanto. */
  private gate: InputGate | null = null
  private readonly pending: string[] = []
  /** Captura de la última ejecución con ▶ (la salida que se comparte con la IA). */
  private capture: OutputCapture | null = null
  private readonly cleanups: Array<() => void> = []

  constructor(readonly directory: string) {
    this.el = document.createElement('div')
    this.el.style.height = '100%'
    this.term = new Terminal({
      fontFamily: cssVar('--font-code', cssVar('--font-mono', "ui-monospace, 'SF Mono', Menlo, monospace")),
      fontSize: 12,
      lineHeight: 1.5,
      cursorBlink: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      allowProposedApi: false,
      scrollback: 5000,
      theme: themeFromCss()
    })
    this.term.loadAddon(this.fit)
    const mo = new MutationObserver(() => {
      this.term.options.theme = themeFromCss()
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    this.cleanups.push(() => mo.disconnect())
    this.start()
  }

  getSnapshot = (): TerminalSnapshot => this.snapshot
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private set(patch: Partial<TerminalSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const l of [...this.listeners]) l()
  }

  /** Engancha la terminal a un contenedor visible (la primera vez la abre; después solo mueve el DOM). */
  attach(host: HTMLElement): void {
    if (this.disposed) return
    if (!this.opened) {
      host.appendChild(this.el)
      this.term.open(this.el)
      this.opened = true
    } else if (this.el.parentElement !== host) {
      host.appendChild(this.el)
    }
    this.refit()
  }

  refit(): void {
    if (this.disposed || !this.opened || !this.el.isConnected) return
    if (this.el.clientWidth === 0 || this.el.clientHeight === 0) return
    try {
      this.fit.fit()
    } catch {
      // contenedor sin tamaño aún
    }
  }

  private start(): void {
    let api: ReturnType<typeof requireCode>
    try {
      api = requireCode()
    } catch (err) {
      this.set({ error: errorMessage(err) })
      return
    }
    const early = new Map<string, string[]>()
    const earlyExit = new Map<string, number>()
    // R3-A: lo tecleado antes de que el shell dé su primer aviso se retiene (si no, el eco queda suelto antes del prompt).
    const offData = api.onPtyData((ev) => {
      if (this.ptyId === null) early.set(ev.id, [...(early.get(ev.id) ?? []), ev.data])
      else if (ev.id === this.ptyId) {
        this.term.write(ev.data)
        this.capture?.push(ev.data)
        this.gate?.onOutput()
      }
    })
    const offExit = api.onPtyExit((ev) => {
      if (this.ptyId === null) earlyExit.set(ev.id, ev.exitCode)
      else if (ev.id === this.ptyId) this.set({ exited: ev.exitCode })
    })
    const onInput = this.term.onData((data) => this.sendInput(data))
    const onResize = this.term.onResize(({ cols, rows }) => {
      if (this.ptyId) void api.pty.resize(this.ptyId, cols, rows).catch(() => undefined)
    })
    this.cleanups.push(
      offData,
      offExit,
      () => onInput.dispose(),
      () => this.gate?.dispose(),
      () => onResize.dispose()
    )

    api.pty
      .create({ cwd: this.directory, cols: this.term.cols, rows: this.term.rows })
      .then((info) => {
        if (this.disposed) {
          void api.pty.kill(info.id).catch(() => undefined)
          return
        }
        this.ptyId = info.id
        const id = info.id
        const gate = createInputGate((data) => void api.pty.write(id, data).catch(() => undefined))
        this.gate = gate
        gate.start()
        for (const data of this.pending.splice(0)) gate.push(data)
        const chunks = early.get(info.id) ?? []
        for (const chunk of chunks) {
          this.term.write(chunk)
          this.capture?.push(chunk)
        }
        if (chunks.length) gate.onOutput()
        early.clear()
        // El shell puede haber terminado antes de que `create` resolviera: muestra el banner de salida.
        const code = earlyExit.get(info.id)
        if (code !== undefined) this.set({ exited: code })
        else void api.pty.resize(info.id, this.term.cols, this.term.rows).catch(() => undefined)
      })
      .catch((err: unknown) => {
        if (!this.disposed) this.set({ error: errorMessage(err) })
      })
  }

  /** Escribe en el shell como si se tecleara (pasa por la misma puerta que el teclado; si el pty aún se crea, espera). */
  sendInput(data: string): void {
    if (this.disposed) return
    if (this.gate) this.gate.push(data)
    else this.pending.push(data)
  }

  /**
   * Empieza a capturar la salida de un comando que se va a escribir con ▶. `null` si una ejecución anterior sigue en curso o
   * esperando entrada (nunca se escribe encima de un proceso en marcha).
   */
  startCapture(command: string, onShare: (view: OutputView, status: ShareStatus) => void): OutputCapture | null {
    if (this.disposed) return null
    const prev = this.capture
    if (prev && prev.getSnapshot().status !== 'done') return null
    prev?.dispose()
    const promptLine = this.getTailText(1)
    this.capture = new OutputCapture({ promptLine, command, cols: () => this.term.cols, onShare })
    return this.capture
  }

  /** Texto seleccionado en la terminal, o '' si no hay selección. */
  getSelectionText(): string {
    return this.disposed ? '' : this.term.getSelection()
  }

  /** Últimas `maxLines` líneas del búfer (unidas las que el ancho partió), sin las vacías del final. */
  getTailText(maxLines: number): string {
    if (this.disposed) return ''
    const buf = this.term.buffer.active
    const joined: string[] = []
    for (let i = Math.max(0, buf.length - maxLines * 3); i < buf.length; i++) {
      const line = buf.getLine(i)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && joined.length) joined[joined.length - 1] += text
      else joined.push(text)
    }
    while (joined.length && joined[joined.length - 1].trim() === '') joined.pop()
    return joined.slice(-maxLines).join('\n')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.capture?.dispose()
    for (const c of this.cleanups) c()
    if (this.ptyId) {
      try {
        void requireCode()
          .pty.kill(this.ptyId)
          .catch(() => undefined)
      } catch {
        // sin puente
      }
    }
    this.listeners.clear()
    this.el.remove()
    this.term.dispose()
  }
}

const entries = new Map<string, TerminalEntry>()

/** La terminal del proyecto; se crea (y arranca su shell) la primera vez. */
export function getTerminal(directory: string): TerminalEntry {
  let e = entries.get(directory)
  if (!e) {
    e = new TerminalEntry(directory)
    entries.set(directory, e)
  }
  return e
}

/** Descarta (mata el shell) la terminal del proyecto. */
export function disposeTerminal(directory: string): void {
  entries.get(directory)?.dispose()
  entries.delete(directory)
}

/** Descarta todas las terminales salvo la del proyecto indicado (o todas con null). */
export function disposeTerminalsExcept(directory: string | null): void {
  for (const dir of [...entries.keys()]) if (dir !== directory) disposeTerminal(dir)
}

/** Reinicia la terminal del proyecto (shell nuevo, sin scrollback). */
export function restartTerminal(directory: string): TerminalEntry {
  disposeTerminal(directory)
  const entry = getTerminal(directory)
  replacedVersion += 1
  for (const l of [...replacedListeners]) l()
  return entry
}

// Aviso a los paneles abiertos de que la terminal de un proyecto fue reemplazada (para releer la entrada).
let replacedVersion = 0
const replacedListeners = new Set<() => void>()
export const subscribeTerminalReplaced = (cb: () => void): (() => void) => {
  replacedListeners.add(cb)
  return () => replacedListeners.delete(cb)
}
export const getTerminalReplacedVersion = (): number => replacedVersion

/**
 * Escribe `data` (comandos ya con su Enter) en la terminal del proyecto, capturando su salida. La crea si no existe y, si su shell
 * había terminado o no pudo abrirse, la reinicia antes. `null` (y no escribe nada) si una ejecución anterior sigue en curso.
 */
export function runInTerminal(
  directory: string,
  data: string,
  command: string,
  onShare: (view: OutputView, status: ShareStatus) => void
): OutputCapture | null {
  let entry = getTerminal(directory)
  const { exited, error } = entry.getSnapshot()
  if (exited !== null || error) entry = restartTerminal(directory)
  const capture = entry.startCapture(command, onShare)
  if (!capture) return null
  entry.sendInput(data)
  return capture
}

// Al cambiar o cerrar el proyecto se descartan las terminales de los demás (como antes del registro).
useCode.subscribe((s, prev) => {
  if (s.directory !== prev.directory) disposeTerminalsExcept(s.directory)
})
