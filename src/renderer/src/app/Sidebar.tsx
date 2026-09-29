import { PanelLeftClose, Plus, Search, Settings } from 'lucide-react'
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

const isMac = navigator.userAgent.includes('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+'

export function Sidebar(): React.JSX.Element {
  const { mode, setMode, settingsOpen, openSettings, toggleSidebar, setPaletteOpen } = useUi()
  const serverState = useServer((s) => s.status.state)
  const def = MODES_BY_ID[mode]
  const SidebarContent = def.SidebarContent

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
        <IconButton label={`Ocultar barra lateral (${MOD}\\)`} onClick={toggleSidebar}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      {/* Búsqueda / paleta de comandos */}
      <div className="px-3">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="no-drag flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-inset px-2.5 text-[13px] text-subtle transition-colors hover:border-border-strong hover:text-muted"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Buscar o ir a…</span>
          <kbd className="kbd">{MOD}K</kbd>
        </button>
      </div>

      {/* Modos */}
      <nav aria-label="Modo" className="flex flex-col gap-0.5 px-3 pt-2.5">
        {MODES.map((m) => {
          const Icon = m.icon
          const active = m.id === mode && !settingsOpen
          return (
            <button
              key={m.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setMode(m.id)}
              className={`no-drag group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors duration-150 ${active ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              <Icon size={16} className={active ? 'text-accent' : 'text-subtle group-hover:text-muted'} strokeWidth={active ? 2.2 : 1.9} />
              {m.label}
            </button>
          )
        })}
      </nav>

      {(def.newAction || SidebarContent) && <div className="mx-3 mt-3 border-t border-border" />}

      {def.newAction && (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => {
              openSettings(false)
              def.newAction?.run()
            }}
            className="no-drag group flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium text-fg transition-colors hover:bg-hover"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-soft text-accent transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
              <Plus size={14} strokeWidth={2.4} />
            </span>
            <span className="flex-1 text-left">{def.newAction.label}</span>
            <span className="text-[11px] text-subtle opacity-0 transition-opacity group-hover:opacity-100">{MOD}N</span>
          </button>
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2"
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
        <IconButton label={`Ajustes (${MOD},)`} active={settingsOpen} onClick={() => openSettings(!settingsOpen)}>
          <Settings size={16} className={`transition-transform duration-300 ${settingsOpen ? 'rotate-45' : ''}`} />
        </IconButton>
      </div>
    </aside>
  )
}
