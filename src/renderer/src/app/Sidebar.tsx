import { PanelLeftClose, Plus, Settings } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import { IconButton } from '../components/IconButton'
import { LogoMark } from '../components/Logo'
import { useServer } from '../stores/server'
import { useUi } from '../stores/ui'
import { MODES, MODES_BY_ID } from './modes'

const STATUS_LABEL: Record<string, string> = {
  ready: 'Conectado',
  starting: 'Iniciando…',
  stopped: 'Detenido',
  error: 'Error de conexión'
}

export function Sidebar(): React.JSX.Element {
  const { mode, setMode, settingsOpen, openSettings, toggleSidebar } = useUi()
  const serverState = useServer((s) => s.status.state)
  const def = MODES_BY_ID[mode]
  const SidebarContent = def.SidebarContent
  const activeIndex = MODES.findIndex((m) => m.id === mode)

  const dot =
    serverState === 'ready'
      ? 'bg-success'
      : serverState === 'error'
        ? 'bg-danger'
        : 'bg-warning animate-pulse'

  return (
    <aside className="flex h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Zona de titlebar (semáforos de macOS) */}
      <div className="drag flex h-12 shrink-0 items-center justify-end px-2">
        <IconButton label="Ocultar barra lateral (⌘\)" onClick={toggleSidebar}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      {/* Selector de modo (segmentado con indicador deslizante) */}
      <div className="px-3">
        <div
          role="tablist"
          aria-label="Modo"
          className="relative grid rounded-xl border border-border/70 bg-inset p-1"
          style={{ gridTemplateColumns: `repeat(${MODES.length}, minmax(0, 1fr))` }}
        >
          {!settingsOpen && activeIndex >= 0 && (
            <span
              aria-hidden
              className="absolute top-1 bottom-1 left-1 rounded-lg bg-elevated shadow-sm ring-1 ring-border/70 transition-transform duration-300 ease-out"
              style={{
                width: `calc((100% - 8px) / ${MODES.length})`,
                transform: `translateX(${activeIndex * 100}%)`
              }}
            />
          )}
          {MODES.map((m) => {
            const Icon = m.icon
            const active = m.id === mode && !settingsOpen
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m.id)}
                title={m.label}
                className={`no-drag relative z-10 flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium transition-colors duration-200 ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}
              >
                <Icon size={15} className={active ? 'text-accent' : ''} strokeWidth={active ? 2.2 : 1.9} />
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {def.newAction && (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => {
              openSettings(false)
              def.newAction?.run()
            }}
            className="no-drag group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-hover"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm transition-transform duration-200 group-hover:scale-105 group-hover:rotate-90 group-active:scale-95">
              <Plus size={15} strokeWidth={2.4} />
            </span>
            {def.newAction.label}
          </button>
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-2"
        onClickCapture={() => settingsOpen && openSettings(false)}
      >
        {SidebarContent ? <SidebarContent /> : null}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="relative flex shrink-0" title={`OpenCode: ${STATUS_LABEL[serverState] ?? serverState}`}>
          <LogoMark size={20} />
          <span
            className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2 ring-[var(--bg-sidebar)] ${dot}`}
            aria-label={`OpenCode: ${STATUS_LABEL[serverState] ?? serverState}`}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-display text-[13px] font-semibold tracking-tight">{APP_NAME}</span>
          <span className="truncate text-[10.5px] text-subtle">{STATUS_LABEL[serverState] ?? serverState}</span>
        </span>
        <IconButton label="Ajustes (⌘,)" active={settingsOpen} onClick={() => openSettings(!settingsOpen)}>
          <Settings size={16} className={`transition-transform duration-300 ${settingsOpen ? 'rotate-45' : ''}`} />
        </IconButton>
      </div>
    </aside>
  )
}
