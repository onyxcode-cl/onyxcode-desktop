import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { errorMessage, requireCode } from '../client'
import { useCode } from '../store'
import { createInputGate, type InputGate } from './inputGate'

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
  private readonly cleanups: Array<() => void> = []

  constructor(readonly directory: string) {
    this.el = document.createElement('div')
    this.el.style.height = '100%'
    this.term = new Terminal({
      fontFamily: cssVar('--font-mono', "ui-monospace, 'SF Mono', Menlo, monospace"),
      fontSize: 12.5,
      cursorBlink: true,
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
    let gate: InputGate | null = null
    const offData = api.onPtyData((ev) => {
      if (this.ptyId === null) early.set(ev.id, [...(early.get(ev.id) ?? []), ev.data])
      else if (ev.id === this.ptyId) {
        this.term.write(ev.data)
        gate?.onOutput()
      }
    })
    const offExit = api.onPtyExit((ev) => {
      if (this.ptyId === null) earlyExit.set(ev.id, ev.exitCode)
      else if (ev.id === this.ptyId) this.set({ exited: ev.exitCode })
    })
    const pending: string[] = []
    const onInput = this.term.onData((data) => {
      if (gate) gate.push(data)
      else pending.push(data) // el pty aún se está creando
    })
    const onResize = this.term.onResize(({ cols, rows }) => {
      if (this.ptyId) void api.pty.resize(this.ptyId, cols, rows).catch(() => undefined)
    })
    this.cleanups.push(
      offData,
      offExit,
      () => onInput.dispose(),
      () => gate?.dispose(),
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
        gate = createInputGate((data) => void api.pty.write(id, data).catch(() => undefined))
        gate.start()
        for (const data of pending.splice(0)) gate.push(data)
        const chunks = early.get(info.id) ?? []
        for (const chunk of chunks) this.term.write(chunk)
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

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
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
  return getTerminal(directory)
}

// Al cambiar o cerrar el proyecto se descartan las terminales de los demás (como antes del registro).
useCode.subscribe((s, prev) => {
  if (s.directory !== prev.directory) disposeTerminalsExcept(s.directory)
})
