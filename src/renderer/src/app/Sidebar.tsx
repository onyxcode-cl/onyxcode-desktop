import { PanelLeftClose, Plus, Settings } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import { IconButton } from '../components/IconButton'
import { useServer } from '../stores/server'
import { useUi } from '../stores/ui'
import { MODES, MODES_BY_ID } from './modes'

export function Sidebar(): React.JSX.Element {
  const { mode, setMode, settingsOpen, openSettings, toggleSidebar } = useUi()
  const serverState = useServer((s) => s.status.state)
  const def = MODES_BY_ID[mode]
  const SidebarContent = def.SidebarContent

  const dot =
    serverState === 'ready' ? 'bg-emerald-500' : serverState === 'error' ? 'bg-red-500' : 'bg-amber-400 animate-pulse'

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Zona de titlebar (semáforos de macOS) */}
      <div className="drag flex h-12 shrink-0 items-center justify-end px-2">
        <IconButton label="Ocultar barra lateral" onClick={toggleSidebar}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      {/* Selector de modo */}
      <div className="px-3">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-hover/70 p-1">
          {MODES.map((m) => {
            const Icon = m.icon
            const active = m.id === mode && !settingsOpen
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                title={m.label}
                className={`no-drag flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] transition ${active ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
              >
                <Icon size={15} />
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
            className="no-drag flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-fg hover:bg-hover"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-fg">
              <Plus size={15} />
            </span>
            {def.newAction.label}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-2" onClickCapture={() => settingsOpen && openSettings(false)}>
        {SidebarContent ? <SidebarContent /> : null}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} title={`OpenCode: ${serverState}`} />
        <span className="flex-1 truncate text-xs text-muted">{APP_NAME}</span>
        <IconButton label="Ajustes" active={settingsOpen} onClick={() => openSettings(!settingsOpen)}>
          <Settings size={16} />
        </IconButton>
      </div>
    </aside>
  )
}
