import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import '@xterm/xterm/css/xterm.css'
import { MessageSquareText, Plus, RotateCcw, X } from 'lucide-react'
import { buildTerminalAsk, TERMINAL_TAIL_LINES } from '@shared/terminal-context'
import { useT } from '../../../../lib/i18n'
import { IconButton } from '../../../../components/IconButton'
import { usePendingTerminalOutput } from '../terminal-output'
import {
  MAX_TABS,
  closeTab,
  cycleTab,
  getTabs,
  getTerminal,
  openTab,
  renameTab,
  restartTerminal,
  selectTab,
  subscribeTabs,
  type TabInfo
} from './terminalRegistry'

/**
 * Vista de la terminal integrada, con pestañas. El pty y el xterm de cada pestaña los guarda `terminalRegistry` (varias por
 * proyecto), así que este componente puede desmontarse (cambiar de modo, abrir Ajustes) sin matar ningún shell: al volver solo
 * reengancha el DOM de la pestaña seleccionada. Se descartan al cambiar de proyecto, al cerrar la pestaña o con «Reiniciar».
 */
export function TerminalPanel({ directory, visible }: { directory: string; visible: boolean }): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const [emptyNote, setEmptyNote] = useState(false)
  // La foto de pestañas cambia al abrir/cerrar/seleccionar o al reiniciar una (aquí o al ejecutar con el shell terminado): releer la entrada.
  const subscribe = useCallback((cb: () => void) => subscribeTabs(directory, cb), [directory])
  const tabs = useSyncExternalStore(subscribe, () => getTabs(directory))
  const entry = getTerminal(directory, tabs.activeId)
  const state = useSyncExternalStore(entry.subscribe, entry.getSnapshot)
  const [renaming, setRenaming] = useState<string | null>(null)
  const tabName = (tab: TabInfo): string => tab.title ?? t('code.terminal.tab', { n: tab.n })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Solo la pestaña seleccionada cuelga del contenedor; las demás siguen vivas fuera del DOM.
    for (const child of Array.from(host.children)) if (child !== entry.el) child.remove()
    entry.attach(host)
    const ro = new ResizeObserver(() => entry.refit())
    ro.observe(host)
    return () => ro.disconnect()
  }, [entry])

  // La pestaña seleccionada siempre queda a la vista aunque la barra desborde.
  useEffect(() => {
    tabsRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [tabs.activeId, tabs.tabs.length])

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

  // Atajos con el foco en la terminal (Ctrl+Mayús+T/W y Ctrl+RePág/AvPág no los usa ningún shell): se atienden antes que xterm.
  const onKeyDownCapture = (e: React.KeyboardEvent): void => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return
    let handled = true
    if (e.shiftKey && e.code === 'KeyT') openTab(directory)
    else if (e.shiftKey && e.code === 'KeyW') closeTab(directory, tabs.activeId)
    else if (!e.shiftKey && e.code === 'PageUp') cycleTab(directory, -1)
    else if (!e.shiftKey && e.code === 'PageDown') cycleTab(directory, 1)
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const { error, exited } = state
  const canClose = tabs.tabs.length > 1
  return (
    <div className="flex h-full min-h-0 flex-col bg-code" onKeyDownCapture={onKeyDownCapture}>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <div
          role="tablist"
          aria-label={t('code.terminal.tabs')}
          data-testid="terminal-tabs"
          ref={tabsRef}
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.tabs.map((tab) => {
            const active = tab.id === tabs.activeId
            const name = tabName(tab)
            return (
              <div
                key={tab.id}
                data-testid="terminal-tab"
                data-active={active}
                className={`group flex shrink-0 items-center rounded-md text-xs desk:text-meta ${active ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
              >
                {renaming === tab.id ? (
                  <input
                    autoFocus
                    aria-label={t('code.terminal.renameTab')}
                    defaultValue={tab.title ?? ''}
                    placeholder={name}
                    maxLength={40}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      renameTab(directory, tab.id, e.currentTarget.value)
                      setRenaming(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      else if (e.key === 'Escape') setRenaming(null)
                    }}
                    className="no-drag h-6 w-28 rounded-md border border-accent bg-code px-2 text-xs text-fg outline-none desk:text-meta"
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={t('code.terminal.renameTab')}
                    onClick={(e) => {
                      selectTab(directory, tab.id)
                      // Un doble clic abre el renombrado: no se le roba el foco a su campo.
                      if (e.detail < 2)
                        requestAnimationFrame(() => {
                          if (document.activeElement?.tagName !== 'INPUT') getTerminal(directory, tab.id).term.focus()
                        })
                    }}
                    onDoubleClick={() => setRenaming(tab.id)}
                    className={`no-drag max-w-[10rem] truncate py-1 pl-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${canClose ? 'pr-1' : 'pr-2.5'} rounded-md`}
                  >
                    {name}
                  </button>
                )}
                {canClose && renaming !== tab.id && (
                  <button
                    type="button"
                    aria-label={t('code.terminal.closeTab', { name })}
                    title={t('code.terminal.closeTab', { name })}
                    data-testid="terminal-tab-close"
                    onClick={() => closeTab(directory, tab.id)}
                    className="no-drag mr-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted hover:bg-border hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <IconButton
          size="sm"
          label={tabs.tabs.length >= MAX_TABS ? t('code.terminal.maxTabs', { max: MAX_TABS }) : t('code.terminal.newTab')}
          disabled={tabs.tabs.length >= MAX_TABS}
          data-testid="terminal-new-tab"
          className="shrink-0"
          onClick={() => {
            const e = openTab(directory)
            if (e) requestAnimationFrame(() => e.term.focus())
          }}
        >
          <Plus size={14} />
        </IconButton>
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
          {/* Con varias pestañas el espacio de la barra es de ellas: la acción queda solo con su ícono (nombre accesible intacto). */}
          {tabs.tabs.length < 2 && t('code.terminal.ask')}
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
              restartTerminal(directory, tabs.activeId)
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
