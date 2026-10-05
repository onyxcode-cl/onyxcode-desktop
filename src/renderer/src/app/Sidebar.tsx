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
      {/* Zona de titlebar: en macOS deja sitio a los semáforos; en Windows el marco es el nativo y no hace falta el hueco */}
      <div className={`drag flex shrink-0 items-center justify-end px-2 ${isMacPlatform() ? 'h-12' : 'h-10'}`}>
        <IconButton label={t('app.sidebar.hide', { hint: hintSuffix(hints['sidebar.toggle']) })} onClick={toggleSidebar}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      {/* Búsqueda / paleta de comandos */}
      <div className="px-3">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="no-drag flex h-8 w-full items-center gap-2.5 rounded-ctl bg-transparent px-2 text-sm text-subtle transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-muted"
        >
          <Search size={16} />
          <span className="flex-1 text-left">{t('app.sidebar.search')}</span>
          {bindings['palette.toggle'] && <kbd className="kbd">{hintText(bindings['palette.toggle'])}</kbd>}
        </button>
      </div>

      {/* Modos */}
      <nav aria-label={t('app.sidebar.mode')} className="flex flex-col gap-0.5 px-3 pt-2">
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
              className={`no-drag group flex h-8 items-center gap-2 rounded-ctl px-2 text-sm transition-colors duration-[var(--dur-fast)] ${active ? 'bg-hover font-medium text-fg' : current ? 'font-normal text-fg hover:bg-hover' : 'font-normal text-muted hover:bg-hover hover:text-fg'}`}
            >
              <Icon size={16} className={current ? 'text-accent' : 'text-subtle group-hover:text-muted'} strokeWidth={1.75} />
              {m.label}
            </button>
          )
        })}
      </nav>

      {def.newAction && (
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={() => {
              openSettings(false)
              def.newAction?.run()
            }}
            className="no-drag group flex h-8 w-full items-center gap-2 rounded-ctl px-2 text-sm font-medium text-fg transition-colors duration-[var(--dur-fast)] hover:bg-hover"
          >
            <Plus size={16} strokeWidth={1.75} className="shrink-0 text-accent" />
            <span className="flex-1 text-left">{def.newAction.label}</span>
            <span className="text-caption font-normal text-subtle tabular-nums">{hintText(bindings['conversation.new'])}</span>
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-2" onClickCapture={() => settingsOpen && openSettings(false)}>
        {SidebarContent ? <SidebarContent /> : null}
      </div>

      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <span className="relative flex shrink-0" title={`OpenCode: ${statusLabel}`}>
          <LogoMark size={20} />
          <span
            className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2 ring-[var(--bg-sidebar)] ${dot}`}
            aria-hidden="true"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-display text-[13px] font-semibold tracking-tight">{APP_NAME}</span>
          <span className="truncate text-caption font-normal text-subtle">{statusLabel}</span>
        </span>
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
