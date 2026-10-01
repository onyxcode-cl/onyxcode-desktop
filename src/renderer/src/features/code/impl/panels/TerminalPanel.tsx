import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import '@xterm/xterm/css/xterm.css'
import { RotateCcw } from 'lucide-react'
import { useT } from '../../../../lib/i18n'
import { IconButton } from '../../../../components/IconButton'
import { getTerminal, restartTerminal } from './terminalRegistry'

/**
 * Vista de la terminal integrada. El pty y el xterm los guarda `terminalRegistry` (uno por proyecto), así que
 * este componente puede desmontarse (cambiar de modo, abrir Ajustes) sin matar el shell: al volver solo
 * reengancha el DOM. Se descarta al cambiar de proyecto o con «Reiniciar».
 */
export function TerminalPanel({ directory, visible }: { directory: string; visible: boolean }): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const [generation, setGeneration] = useState(0)
  // `generation` fuerza a releer la entrada tras reiniciar.
  const entry = getTerminal(directory)
  void generation
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

  const { error, exited } = state
  return (
    <div className="flex h-full min-h-0 flex-col bg-code">
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
              setGeneration((g) => g + 1)
            }}
          >
            <RotateCcw size={13} />
          </IconButton>
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  )
}
