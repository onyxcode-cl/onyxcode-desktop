import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import '@xterm/xterm/css/xterm.css'
import { MessageSquareText, RotateCcw } from 'lucide-react'
import { buildTerminalAsk, TERMINAL_TAIL_LINES } from '@shared/terminal-context'
import { useT } from '../../../../lib/i18n'
import { IconButton } from '../../../../components/IconButton'
import { usePendingTerminalOutput } from '../terminal-output'
import { getTerminal, getTerminalReplacedVersion, restartTerminal, subscribeTerminalReplaced } from './terminalRegistry'

/**
 * Vista de la terminal integrada. El pty y el xterm los guarda `terminalRegistry` (uno por proyecto), así que
 * este componente puede desmontarse (cambiar de modo, abrir Ajustes) sin matar el shell: al volver solo
 * reengancha el DOM. Se descarta al cambiar de proyecto o con «Reiniciar».
 */
export function TerminalPanel({ directory, visible }: { directory: string; visible: boolean }): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const [emptyNote, setEmptyNote] = useState(false)
  // La versión cambia cuando la terminal se reinicia (aquí o al ejecutar un comando con el shell terminado): fuerza a releer la entrada.
  const replaced = useSyncExternalStore(subscribeTerminalReplaced, getTerminalReplacedVersion)
  void replaced
  const entry = getTerminal(directory)
  const state = useSyncExternalStore(entry.subscribe, entry.getSnapshot)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    entry.attach(host)
    const ro = new ResizeObserver(() => entry.refit())
    ro.observe(host)
    return () => ro.disconnect()
  }, [entry])

  useEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => entry.refit())
    return () => cancelAnimationFrame(id)
  }, [visible, entry])

  // «Preguntar a la IA»: lo seleccionado en la terminal o sus últimas líneas, sin claves, al compositor SIN enviar.
  const ask = (): void => {
    const selection = entry.getSelectionText()
    const raw = selection.trim() ? selection : entry.getTailText(TERMINAL_TAIL_LINES)
    const r = buildTerminalAsk(raw, t('code.terminal.askIntro'), t('code.terminal.askClipped'))
    if (r.text === null) {
      setEmptyNote(true)
      return
    }
    setEmptyNote(false)
    usePendingTerminalOutput.getState().setPending(directory, { text: r.text, lineCount: r.lineCount, source: 'terminal' })
  }

  const { error, exited } = state
  return (
    <div className="flex h-full min-h-0 flex-col bg-code">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1">
        {emptyNote && (
          <span role="status" className="min-w-0 truncate text-xs text-muted desk:text-meta">
            {t('code.terminal.askEmpty')}
          </span>
        )}
        <button
          type="button"
          onClick={ask}
          title={t('code.terminal.askHint')}
          aria-label={t('code.terminal.ask')}
          data-testid="terminal-ask"
          className="no-drag ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent desk:text-meta"
        >
          <MessageSquareText size={13} />
          {t('code.terminal.ask')}
        </button>
      </div>
      {(error || exited !== null) && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
          <span className={error ? 'text-danger' : 'text-muted'}>
            {error ? t('code.terminal.openFailed', { error }) : t('code.terminal.exited', { code: exited ?? '' })}
          </span>
          <IconButton
            label={t('code.terminal.restart')}
            className="ml-auto h-6 w-6"
            onClick={() => {
              restartTerminal(directory)
            }}
          >
            <RotateCcw size={13} />
          </IconButton>
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1 desk:px-4 desk:py-2.5" />
    </div>
  )
}
