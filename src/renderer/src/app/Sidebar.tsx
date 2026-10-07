import { CircleHelp, Moon, PanelLeft, PanelLeftOpen, Plus, Search, Settings, SquarePen, Sun } from 'lucide-react'
import { DISPLAY_NAME } from '@shared/brand'
import type { ModeId } from '@shared/types'
import { IconButton } from '../components/IconButton'
import { LogoMark } from '../components/Logo'
import { SidebarTree } from '../components/SidebarTreeRoot'
import { Tooltip } from '../components/Tooltip'
import { useT } from '../lib/i18n'
import { isMacPlatform, isWindowsPlatform, platformCaps } from '../lib/platform'
import { useServer } from '../stores/server'
import { useSettings } from '../stores/settings'
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

/**
 * Fila de la barra lateral 2c: 32 px, radio 8, padding horizontal 10, hueco icono-texto 10, hover 120 ms y pulsada a 0,985.
 * Colores solo de tokens existentes: fill-hover = `bg-hover`, texto = `text-fg`/`text-muted`/`text-subtle`.
 */
const ROW =
  'no-drag group flex h-8 min-w-0 items-center gap-2.5 rounded-ctl px-2.5 text-left text-sm transition-[background-color,color,transform] duration-[var(--dur-fast)] hover:bg-hover active:scale-[0.985] motion-reduce:active:scale-100'

/** Botón de 36 × 36 de la barra colapsada: tooltip con nombre + atajo a la derecha, con el ratón y con el foco. */
function RailButton({
  label,
  shortcut,
  onClick,
  current,
  pressed,
  badge,
  children
}: {
  label: string
  shortcut?: string
  onClick: () => void
  current?: boolean
  pressed?: boolean
  /** Punto de aviso (esquina superior derecha, con anillo del color de la barra). */
  badge?: { label: string; tone: 'bg-warning' | 'bg-success'; testId?: string }
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="relative flex">
      <Tooltip label={label} shortcut={shortcut || undefined} side="right">
        <button
          type="button"
          aria-label={label}
          aria-current={current ? 'page' : undefined}
          aria-pressed={pressed}
          onClick={onClick}
          className={`no-drag grid size-9 place-items-center rounded-ctl text-muted transition-[background-color,color,transform] duration-[var(--dur-fast)] hover:bg-hover hover:text-fg active:scale-[0.985] motion-reduce:active:scale-100 ${current || pressed ? 'bg-hover text-fg' : ''}`}
        >
          {children}
        </button>
      </Tooltip>
      {badge && (
        <span
          role="img"
          aria-label={badge.label}
          data-testid={badge.testId}
          className={`pointer-events-none absolute top-[7px] right-[7px] size-[7px] rounded-full ring-2 ring-sidebar ${badge.tone}`}
        />
      )}
    </div>
  )
}

/** `showLabel`: nombre del botón «Mostrar barra lateral» de la barra colapsada (lo trae App, que ya conoce el atajo). */
export function Sidebar({ showLabel }: { showLabel?: string }): React.JSX.Element {
  const { mode, setMode, settingsOpen, openSettings, openSettingsAt, toggleSidebar, setPaletteOpen } = useUi()
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const t = useT()
  const bindings = useEffectiveBindings()
  const hints = { 'sidebar.toggle': hintText(bindings['sidebar.toggle']), 'settings.toggle': hintText(bindings['settings.toggle']) }
  const serverState = useServer((s) => s.status.state)
  const statusLabel = serverState in STATUS_KEY ? t(STATUS_KEY[serverState as keyof typeof STATUS_KEY]) : serverState
  // Aprobaciones pendientes de Tareas (el mismo dato que alimenta las tarjetas de permiso): punto de aviso en el modo.
  const approvalsPending = useTasks((s) => Object.keys(s.permissions).length > 0)
  const themePref = useSettings((s) => s.settings.theme)
  const def = MODES_BY_ID[mode]
  const SidebarContent = def.SidebarContent
  const mac = isMacPlatform()
  // Barra de título integrada de 48 px en macOS y Windows; Linux conserva el marco estándar.
  const tall = mac || isWindowsPlatform()
  const showProjects = !!def.projectAction
  const newHint = hintText(bindings['conversation.new'])
  const searchHint = hintText(bindings['palette.toggle'])

  const dot = serverState === 'ready' ? 'bg-success' : serverState === 'error' ? 'bg-danger' : 'bg-warning animate-pulse'
  const dark = typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'dark'
  const toggleTheme = (): void => void useSettings.getState().update({ theme: dark ? 'light' : 'dark' })
  void themePref // la suscripción repinta el icono al cambiar el tema

  const newAction = (): void => {
    openSettings(false)
    def.newAction?.run()
  }
  const goMode = (id: ModeId): void => setMode(id)

  // ───────────── Colapsada: 56 px, solo iconos de 36 × 36 ─────────────
  if (collapsed) {
    return (
      <aside
        aria-label={t('app.sidebar.aria')}
        data-collapsed=""
        className="flex h-full w-14 shrink-0 flex-col items-center bg-sidebar pb-2"
      >
        {/* Espacio superior: en macOS libre para los semáforos (44 px); en Windows, la franja de arrastre bajo el overlay de controles.
            Es un hermano de los botones, no su contenedor (en Windows una franja `drag` se come los clics de sus hijos). */}
        <div aria-hidden="true" className={`drag w-full shrink-0 ${tall ? 'h-11' : 'h-2'}`} />
        <div className="flex flex-col items-center gap-0.5">
          <RailButton label={showLabel ?? t('app.sidebar.show', { hint: '' })} shortcut={hints['sidebar.toggle']} onClick={toggleSidebar}>
            <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden="true" />
          </RailButton>
          {def.newAction && (
            <RailButton label={def.newAction.label} shortcut={newHint} onClick={newAction}>
              <SquarePen size={16} strokeWidth={1.75} aria-hidden="true" />
            </RailButton>
          )}
          <RailButton label={t('app.sidebar.search')} shortcut={searchHint} onClick={() => setPaletteOpen(true)}>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          </RailButton>
        </div>
        <div className="h-3 shrink-0" aria-hidden="true" />
        <nav aria-label={t('app.sidebar.mode')} className="flex flex-col items-center gap-0.5">
          {MODES.map((m) => {
            const Icon = m.icon
            return (
              <RailButton
                key={m.id}
                label={m.label}
                shortcut={hintText(bindings[`mode.${m.id}`])}
                current={m.id === mode && !settingsOpen}
                onClick={() => goMode(m.id)}
                badge={
                  m.id === 'tasks' && approvalsPending
                    ? { label: t('app.sidebar.pendingApproval'), tone: 'bg-warning', testId: 'sidebar-approvals-dot' }
                    : undefined
                }
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              </RailButton>
            )
          })}
        </nav>
        <div className="flex-1" />
        <RailButton
          label={t('app.sidebar.settings', { hint: '' })}
          shortcut={hints['settings.toggle']}
          pressed={settingsOpen}
          onClick={() => openSettings(!settingsOpen)}
          badge={{ label: statusLabel, tone: serverState === 'ready' ? 'bg-success' : 'bg-warning' }}
        >
          <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
        </RailButton>
      </aside>
    )
  }

  // ───────────── Expandida ─────────────
  return (
    <aside aria-label={t('app.sidebar.aria')} className="flex h-full w-[var(--sidebar-width)] shrink-0 flex-col bg-sidebar">
      {/* Cabecera: en macOS los primeros 84 px son de los semáforos; solo queda el botón de ocultar. En Windows (titleBarOverlay) no hay
          reserva izquierda; los controles nativos van a la derecha de la ventana. */}
      <div className={`flex shrink-0 items-center pr-2 ${mac ? 'h-12 pl-[84px]' : tall ? 'h-12 pl-2' : 'h-10 pl-2'}`}>
        {/* La zona de arrastre es un hermano del botón (no su contenedor): en Windows una franja `drag` se come los clics de sus hijos. */}
        <div aria-hidden="true" className="drag h-full min-w-0 flex-1" />
        <IconButton label={t('app.sidebar.hide', { hint: hintSuffix(hints['sidebar.toggle']) })} size="sm" onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      {/* Marca */}
      <div className="flex shrink-0 items-center gap-2 px-[18px] pt-0.5 pb-3.5">
        <LogoMark size={20} />
        <span className="text-title-sm text-fg">{DISPLAY_NAME}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-px px-2">
          {/* Nueva conversación / sesión / tarea: lápiz + texto 500 + atajo. */}
          {def.newAction && (
            <button
              type="button"
              aria-keyshortcuts={newHint || undefined}
              onClick={newAction}
              className={`${ROW} h-[34px] w-full font-medium text-fg`}
            >
              <SquarePen size={16} strokeWidth={1.75} className="shrink-0 text-muted group-hover:text-fg" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{def.newAction.label}</span>
              {newHint && (
                <span aria-hidden="true" className="shrink-0 font-mono text-[11px] leading-4 font-normal text-subtle">
                  {newHint}
                </span>
              )}
            </button>
          )}

          {/* Buscar o ir a…: campo sobre la «tarjeta» (fondo del lienzo en oscuro, elevado en claro) con borde interior. Abre la paleta. */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={`${ROW} sb-card mt-1 mb-2 w-full text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:text-fg`}
          >
            <Search size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t('app.sidebar.search')}</span>
            {searchHint && (
              <span aria-hidden="true" className="shrink-0 font-mono text-[11px] leading-4 text-subtle">
                {searchHint}
              </span>
            )}
          </button>

          {/* Segmentado de modos. Con Ajustes abiertos el modo actual conserva el texto fuerte, sin fondo; `aria-current` lo lleva Ajustes. */}
          <nav
            aria-label={t('app.sidebar.mode')}
            className="grid gap-0.5 rounded-[10px] bg-hover p-[3px]"
            style={{ gridTemplateColumns: `repeat(${MODES.length}, minmax(0, 1fr))` }}
          >
            {MODES.map((m) => {
              const current = m.id === mode
              const active = current && !settingsOpen
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => goMode(m.id)}
                  className={`no-drag relative flex h-7 min-w-0 items-center justify-center rounded-[7px] px-1 text-[13px] leading-4 transition-[background-color,color,transform] duration-[var(--dur-fast)] active:scale-[0.985] motion-reduce:active:scale-100 ${
                    active ? 'sb-card font-medium text-fg shadow-sm' : current ? 'font-medium text-fg' : 'text-muted hover:text-fg'
                  }`}
                >
                  <span className="truncate">{m.label}</span>
                  {m.id === 'tasks' && approvalsPending && (
                    <span
                      role="img"
                      aria-label={t('app.sidebar.pendingApproval')}
                      className="absolute top-[5px] right-1.5 size-1.5 rounded-full bg-warning"
                      data-testid="sidebar-approvals-dot"
                    />
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Lista con scroll: rótulo de sección («Proyectos» con «Abrir carpeta», o «Sin proyecto» en Chat) y el árbol del modo. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-5 pb-2">
          {SidebarContent && (
            <div className="flex h-7 shrink-0 items-center justify-between pr-1 pl-2.5">
              <span className="text-meta font-medium text-subtle">
                {showProjects ? t('app.sidebar.projects') : t('app.sidebar.noProject')}
              </span>
              {showProjects && platformCaps().nativeDialogs && (
                <IconButton
                  label={t('app.sidebar.openFolder')}
                  size="xs"
                  className="text-subtle"
                  onClick={() => {
                    openSettings(false)
                    def.projectAction?.()
                  }}
                >
                  <Plus size={14} strokeWidth={1.75} />
                </IconButton>
              )}
            </div>
          )}
          {SidebarContent ? (
            <SidebarTree onClickCapture={() => settingsOpen && openSettings(false)}>
              <SidebarContent />
            </SidebarTree>
          ) : null}
        </div>
      </div>

      {/* Pie de 48 px: Ajustes · Ayuda · Tema y el estado de la conexión. */}
      <div className="flex h-12 shrink-0 items-center gap-0.5 px-2">
        <IconButton
          label={t('app.sidebar.settings', { hint: hintSuffix(hints['settings.toggle']) })}
          aria-pressed={settingsOpen}
          active={settingsOpen}
          onClick={() => openSettings(!settingsOpen)}
        >
          <Settings size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label={t('app.sidebar.help')} onClick={() => openSettingsAt('shortcuts')}>
          <CircleHelp size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label={t('app.sidebar.theme')} onClick={toggleTheme}>
          {dark ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
        </IconButton>
        <span className="flex-1" />
        <span className="flex shrink-0 items-center gap-1.5 pr-2 text-meta text-subtle tabular-nums" title={`OpenCode: ${statusLabel}`}>
          <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
          {statusLabel}
        </span>
      </div>
    </aside>
  )
}
