import { PanelLeft, Plus, Search, Settings, SquarePen } from 'lucide-react'
import { IconButton } from '../components/IconButton'
import { LogoMark } from '../components/Logo'
import { useT } from '../lib/i18n'
import { isMacPlatform, platformCaps } from '../lib/platform'
import { useServer } from '../stores/server'
import { useUi } from '../stores/ui'
import { useTasks } from '../features/tasks/impl/store'
import { MODES, MODES_BY_ID } from './modes'
import { hintSuffix, hintText, useEffectiveBindings } from '../keybindings/bindings'

const STATUS_KEY = {
  ready: 'app.status.ready',
  starting: 'app.status.starting',
  stopped: 'app.status.stopped',
  error: 'app.status.error'
} as const

/** Fila base de la barra lateral 1b: 32 px, radio 8, hueco icono-texto de 8, hover 120 ms, pulsada a 0,98. */
const ROW =
  'no-drag group flex h-8 min-w-0 items-center gap-2 rounded-ctl px-2 text-left text-sm transition-[background-color,color,transform] duration-[var(--dur-fast)] hover:bg-hover active:scale-[0.98] motion-reduce:active:scale-100'

export function Sidebar(): React.JSX.Element {
  const { mode, setMode, settingsOpen, openSettings, toggleSidebar, setPaletteOpen } = useUi()
  const t = useT()
  const bindings = useEffectiveBindings()
  const hints = { 'sidebar.toggle': hintText(bindings['sidebar.toggle']), 'settings.toggle': hintText(bindings['settings.toggle']) }
  const serverState = useServer((s) => s.status.state)
  const statusLabel = serverState in STATUS_KEY ? t(STATUS_KEY[serverState as keyof typeof STATUS_KEY]) : serverState
  // Aprobaciones pendientes de Tareas (el mismo dato que alimenta las tarjetas de permiso): punto de aviso en el modo.
  const approvalsPending = useTasks((s) => Object.keys(s.permissions).length > 0)
  const def = MODES_BY_ID[mode]
  const SidebarContent = def.SidebarContent
  const mac = isMacPlatform()
  const showProjects = !!def.projectAction
  const newHint = hintText(bindings['conversation.new'])

  const dot = serverState === 'ready' ? 'bg-success' : serverState === 'error' ? 'bg-danger' : 'bg-warning animate-pulse'

  return (
    <aside aria-label={t('app.sidebar.aria')} className="flex h-full w-[var(--sidebar-width)] shrink-0 flex-col bg-sidebar">
      {/* Barra de título de 48 px: en macOS los primeros 84 px son de los semáforos; solo queda el botón de ocultar. En Windows el marco es el nativo. */}
      <div className={`drag flex shrink-0 items-center justify-end pr-2.5 ${mac ? 'h-12 pl-[84px]' : 'h-10 pl-2'}`}>
        <IconButton label={t('app.sidebar.hide', { hint: hintSuffix(hints['sidebar.toggle']) })} size="sm" onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2">
        {/* Nueva conversación / sesión / tarea: logo + texto + icono de lápiz; el atajo va en el tooltip. */}
        {def.newAction && (
          <button
            type="button"
            title={`${def.newAction.label}${hintSuffix(newHint)}`}
            onClick={() => {
              openSettings(false)
              def.newAction?.run()
            }}
            className={`${ROW} w-full font-medium text-fg`}
          >
            <LogoMark size={16} />
            <span className="min-w-0 flex-1 truncate">{def.newAction.label}</span>
            <SquarePen size={16} strokeWidth={1.75} className="shrink-0 text-muted group-hover:text-fg" aria-hidden="true" />
          </button>
        )}

        {/* Búsqueda / paleta de comandos */}
        <button type="button" onClick={() => setPaletteOpen(true)} className={`${ROW} mt-0.5 w-full text-muted hover:text-fg`}>
          <Search size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t('app.sidebar.search')}</span>
          {bindings['palette.toggle'] && <kbd className="kbd">{hintText(bindings['palette.toggle'])}</kbd>}
        </button>

        {/* Modos: rejilla de 2 × 2 */}
        <nav aria-label={t('app.sidebar.mode')} className="mt-2 grid grid-cols-2 gap-0.5">
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
                className={`${ROW} ${active ? 'bg-hover font-medium text-fg' : current ? 'font-normal text-fg' : 'font-normal text-fg'}`}
              >
                <Icon size={16} className={`shrink-0 ${current ? 'text-accent' : 'text-muted group-hover:text-fg'}`} strokeWidth={1.75} />
                <span className="min-w-0 truncate">{m.label}</span>
                {m.id === 'tasks' && approvalsPending && (
                  <span
                    role="img"
                    aria-label={t('app.sidebar.pendingApproval')}
                    className="ml-auto h-2 w-2 shrink-0 rounded-full bg-warning"
                    data-testid="sidebar-approvals-dot"
                  />
                )}
              </button>
            )
          })}
        </nav>

        {/* «Proyectos»: encabezado de 28 px con «Abrir carpeta como proyecto» (solo Code y Tareas, que ya tienen esa función). */}
        {showProjects && (
          <div className="mt-4 flex h-7 shrink-0 items-center justify-between pr-1 pl-2">
            <span className="text-[11px] leading-4 font-semibold tracking-[0.02em] text-subtle">{t('app.sidebar.projects')}</span>
            {platformCaps().nativeDialogs && (
              <IconButton
                label={t('app.sidebar.openFolder')}
                size="xs"
                onClick={() => {
                  openSettings(false)
                  def.projectAction?.()
                }}
              >
                <Plus size={16} strokeWidth={1.75} />
              </IconButton>
            )}
          </div>
        )}

        <div
          className={`min-h-0 flex-1 overflow-y-auto pb-2 ${showProjects ? 'pt-0' : 'pt-4'}`}
          onClickCapture={() => settingsOpen && openSettings(false)}
        >
          {SidebarContent ? <SidebarContent /> : null}
        </div>
      </div>

      {/* Pie: Ajustes + punto de conexión. */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-2" title={`OpenCode: ${statusLabel}`}>
        <button
          type="button"
          aria-label={t('app.sidebar.settings', { hint: hintSuffix(hints['settings.toggle']) })}
          aria-pressed={settingsOpen}
          onClick={() => openSettings(!settingsOpen)}
          className={`${ROW} flex-1 ${settingsOpen ? 'bg-hover text-fg' : 'text-fg'}`}
        >
          <Settings size={16} strokeWidth={1.75} className="shrink-0 text-muted group-hover:text-fg" aria-hidden="true" />
          <span className="min-w-0 truncate">{t('app.sidebar.settingsLabel')}</span>
        </button>
        <span className="flex shrink-0 items-center gap-1.5 pr-2 text-meta text-muted tabular-nums">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
          {statusLabel}
        </span>
      </div>
    </aside>
  )
}
