import { PanelLeftClose, Plus, Search, Settings } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import { IconButton } from '../components/IconButton'
import { LogoMark } from '../components/Logo'
import { useT } from '../lib/i18n'
import { isMacPlatform } from '../lib/platform'
import { useServer } from '../stores/server'
import { useUi } from '../stores/ui'
import { MODES, MODES_BY_ID } from './modes'
import { hintSuffix, hintText, useEffectiveBindings } from '../keybindings/bindings'

const STATUS_KEY = {
  ready: 'app.status.ready',
  starting: 'app.status.starting',
  stopped: 'app.status.stopped',
  error: 'app.status.error'
} as const

export function Sidebar(): React.JSX.Element {
  const { mode, setMode, settingsOpen, openSettings, toggleSidebar, setPaletteOpen } = useUi()
  const t = useT()
  const bindings = useEffectiveBindings()
  const hints = { 'sidebar.toggle': hintText(bindings['sidebar.toggle']), 'settings.toggle': hintText(bindings['settings.toggle']) }
  const serverState = useServer((s) => s.status.state)
  const statusLabel = serverState in STATUS_KEY ? t(STATUS_KEY[serverState as keyof typeof STATUS_KEY]) : serverState
  const def = MODES_BY_ID[mode]
  const SidebarContent = def.SidebarContent

  const dot = serverState === 'ready' ? 'bg-success' : serverState === 'error' ? 'bg-danger' : 'bg-warning animate-pulse'

  return (
    <aside aria-label={t('app.sidebar.aria')} className="flex h-full w-[var(--sidebar-width)] shrink-0 flex-col bg-sidebar">
      {/* Zona de titlebar: en macOS los semáforos ocupan los primeros 80 px (el logo va a su derecha); en Windows el marco es el nativo */}
      <div className={`drag flex shrink-0 items-center justify-between gap-2 pr-2 ${isMacPlatform() ? 'h-12 pl-[88px]' : 'h-10 pl-4'}`}>
        <span className="flex min-w-0 items-center gap-2" data-testid="sidebar-brand">
          <LogoMark size={20} />
          <span className="truncate font-display text-[14px] font-semibold tracking-tight text-fg">{APP_NAME}</span>
        </span>
        <IconButton label={t('app.sidebar.hide', { hint: hintSuffix(hints['sidebar.toggle']) })} onClick={toggleSidebar}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Búsqueda / paleta de comandos */}
        <div className="px-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="no-drag flex h-9 w-full items-center gap-2.5 rounded-[10px] bg-transparent px-2.5 text-sm text-subtle transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-muted"
          >
            <Search size={16} />
            <span className="flex-1 text-left">{t('app.sidebar.search')}</span>
            {bindings['palette.toggle'] && <kbd className="kbd">{hintText(bindings['palette.toggle'])}</kbd>}
          </button>
        </div>

        {/* Modos */}
        <nav aria-label={t('app.sidebar.mode')} className="flex flex-col gap-0.5 px-3">
          {MODES.map((m) => {
            const Icon = m.icon
            // Con Ajustes abiertos el modo actual conserva una marca suave (icono de acento, sin fondo); `aria-current` lo lleva Ajustes.
            const current = m.id === mode
            const active = current && !settingsOpen
            return (
              <button
                key={m.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setMode(m.id)}
                className={`no-drag group flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-sm transition-colors duration-[var(--dur-fast)] ${active ? 'bg-active font-medium text-fg' : current ? 'font-normal text-fg hover:bg-hover' : 'font-normal text-muted hover:bg-hover hover:text-fg'}`}
              >
                <Icon size={16} className={current ? 'text-accent' : 'text-subtle group-hover:text-muted'} strokeWidth={1.75} />
                {m.label}
              </button>
            )
          })}
        </nav>

        {def.newAction && (
          <div className="px-3">
            <button
              type="button"
              onClick={() => {
                openSettings(false)
                def.newAction?.run()
              }}
              className="no-drag group flex h-9 w-full items-center gap-2 rounded-[10px] bg-accent-soft px-3 text-sm font-medium text-accent transition-colors duration-[var(--dur-fast)] hover:bg-[color-mix(in_srgb,var(--accent)_14%,var(--accent-soft))]"
            >
              <Plus size={16} strokeWidth={1.75} className="shrink-0 text-accent" />
              <span className="flex-1 text-left">{def.newAction.label}</span>
              <span className="text-caption font-normal text-accent/70 tabular-nums">{hintText(bindings['conversation.new'])}</span>
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-3 border-t border-border/60" aria-hidden="true" />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-2" onClickCapture={() => settingsOpen && openSettings(false)}>
            {SidebarContent ? <SidebarContent /> : null}
          </div>
        </div>
      </div>

      <div className="mx-3 flex h-12 shrink-0 items-center gap-2.5 border-t border-border/60 pl-1" title={`OpenCode: ${statusLabel}`}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{statusLabel}</span>
        <IconButton
          label={t('app.sidebar.settings', { hint: hintSuffix(hints['settings.toggle']) })}
          active={settingsOpen}
          onClick={() => openSettings(!settingsOpen)}
        >
          <Settings
            size={16}
            className={`transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] ${settingsOpen ? 'rotate-45' : ''}`}
          />
        </IconButton>
      </div>
    </aside>
  )
}
