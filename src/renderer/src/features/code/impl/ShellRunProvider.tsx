import { useMemo } from 'react'
import { t } from '@shared/i18n'
import { terminalInputFor } from '@shared/terminal-command'
import { buildShareMessage, outputView, type OutputView, type ShareStatus } from '@shared/terminal-capture'
import { ShellRunContext, type ShareState, type ShellRunHandle, type ShellRunner, type ShellRunSnapshot } from '../../../lib/shellRun'
import { useCode } from './store'
import { getTerminal, runInTerminal } from './panels/terminalRegistry'
import type { OutputCapture } from './panels/outputCapture'
import { usePendingTerminalOutput, useShareCommandOutput } from './terminal-output'

const shareTexts = (): Parameters<typeof buildShareMessage>[2] => ({
  intro: t('code.run.shareIntro'),
  clippedNote: t('code.run.shareClipped'),
  runningNote: t('code.run.shareRunning'),
  waitingNote: t('code.run.shareWaiting')
})

/**
 * Entrega la salida de UNA ejecución con ▶ (una sola vez): a la MISMA sesión de Code si el interruptor está encendido (en cola si la
 * sesión está ocupada con un turno), o como pastilla adjunta si está apagado o la persona cambió de sesión. Nunca se comparte si casi
 * toda la salida era un secreto. No toca el estado de la sesión: solo usa `send`/`enqueue` del almacén, como el compositor.
 */
export function deliverCommandOutput(opts: {
  directory: string
  sessionID: string | null
  view: OutputView
  status: ShareStatus
  shareOn: boolean
  /** Fuerza el envío directo (botón «Enviar a la IA ahora»). */
  force?: boolean
}): ShareState {
  const { directory, sessionID, view, status, shareOn, force } = opts
  if (view.mostlySecret) return 'blocked-secret'
  const msg = buildShareMessage(view, status, shareTexts())
  if (msg === null) return 'empty'
  const st = useCode.getState()
  const attach = (): ShareState => {
    usePendingTerminalOutput.getState().setPending(directory, { text: msg, lineCount: view.lineCount, source: 'command' })
    return 'attached'
  }
  if (!(shareOn || force) || !sessionID || st.activeSessionID !== sessionID) return attach()
  const busy = st.runState[sessionID] === 'busy' || st.runState[sessionID] === 'retry'
  if (busy) return st.enqueue(sessionID, msg) ? 'queued' : attach()
  void st.send(msg)
  return 'sent'
}

/** Ejecuciones por proyecto y comando: sobreviven a que el mensaje se vuelva a pintar. */
const runs = new Map<string, ShellRunHandle>()
const runKey = (directory: string, lines: string[]): string => `${directory}\n${lines.join('\n')}`

class RunHandle implements ShellRunHandle {
  private listeners = new Set<() => void>()
  private snap: ShellRunSnapshot
  private share: ShareState = 'pending'
  private shareOn: boolean
  private capture: OutputCapture | null = null
  private off: (() => void) | null = null

  constructor(
    private readonly directory: string,
    private readonly sessionID: string | null
  ) {
    this.shareOn = useShareCommandOutput.getState().on
    this.snap = this.compute()
  }

  /** Se llama una vez creada la captura (el aviso de «terminó» puede llegar después). */
  bind(capture: OutputCapture): void {
    this.capture = capture
    this.off = capture.subscribe(() => this.refresh())
    this.refresh()
  }

  onShare = (view: OutputView, status: ShareStatus): void => {
    this.share = deliverCommandOutput({ directory: this.directory, sessionID: this.sessionID, view, status, shareOn: this.shareOn })
    this.refresh()
  }

  private compute(): ShellRunSnapshot {
    const c = this.capture?.getSnapshot()
    return {
      lines: c?.view.lines ?? [],
      lineCount: c?.view.lineCount ?? 0,
      status: c?.status ?? 'running',
      waitKind: c?.waitKind ?? null,
      share: this.share,
      shareOn: this.shareOn
    }
  }
  private refresh(): void {
    this.snap = this.compute()
    for (const l of [...this.listeners]) l()
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  getSnapshot = (): ShellRunSnapshot => this.snap
  setShareOn = (on: boolean): void => {
    this.shareOn = on
    this.refresh()
  }
  sendNow = (): void => {
    const c = this.capture?.getSnapshot()
    if (!c) return
    const view = outputView(c.view.text)
    this.share = deliverCommandOutput({
      directory: this.directory,
      sessionID: this.sessionID,
      view,
      status: c.status === 'waiting' ? 'waiting' : c.status === 'done' ? 'done' : 'running',
      shareOn: true,
      force: true
    })
    this.refresh()
  }
  dispose(): void {
    this.off?.()
    this.listeners.clear()
  }
}

/**
 * Da a las respuestas de Code de escritorio el botón «Ejecutar en la terminal»: abre el panel de terminal (si estaba cerrado) y
 * escribe en la terminal del proyecto, capturando la salida de ESE comando. No se monta en el celular ni en Chat/Tareas: sin
 * proveedor, el botón no existe.
 */
export function ShellRunProvider({ directory, children }: { directory: string; children: React.ReactNode }): React.JSX.Element {
  const runner = useMemo<ShellRunner>(() => {
    const showTerminal = (): void => {
      const st = useCode.getState()
      if (st.panel !== 'terminal') st.togglePanel('terminal')
      // El panel puede estar recién montado: el foco va en el siguiente cuadro.
      requestAnimationFrame(() => getTerminal(directory).term.focus())
    }
    return {
      run(lines) {
        const handle = new RunHandle(directory, useCode.getState().activeSessionID)
        const capture = runInTerminal(directory, terminalInputFor(lines), lines.join('\n'), handle.onShare)
        if (!capture) {
          handle.dispose()
          return null
        }
        handle.bind(capture)
        runs.set(runKey(directory, lines), handle)
        showTerminal()
        return handle
      },
      find: (lines) => runs.get(runKey(directory, lines)) ?? null,
      showTerminal
    }
  }, [directory])
  return <ShellRunContext.Provider value={runner}>{children}</ShellRunContext.Provider>
}
