import {
  CircleHelp,
  Clock,
  FolderPlus,
  LayoutGrid,
  Moon,
  Blocks,
  PanelLeft,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sun,
  Zap
} from 'lucide-react'
import { useEffect } from 'react'
import type { ModeId } from '@shared/types'
import { IconButton } from '../components/IconButton'
import { SidebarTree } from '../components/SidebarTreeRoot'
import { Tooltip } from '../components/Tooltip'
import { useT } from '../lib/i18n'
import { isMacPlatform, isWindowsPlatform, platformCaps } from '../lib/platform'
import { useServer } from '../stores/server'
import { useSettings } from '../stores/settings'
import { selectListCollapsed, useUi } from '../stores/ui'
import { useTasks } from '../features/tasks/impl/store'
import { selectInboxPending, syncInbox, useRoutines } from '../features/routines/impl/store'
import { FirstStepsCard } from '../features/onboarding/FirstStepsCard'
import { MODES, MODES_BY_ID } from './modes'
import type { ModeDefinition } from './types'
import { hintSuffix, hintText, useEffectiveBindings } from '../keybindings/bindings'

const STATUS_KEY = {
  ready: 'app.status.ready',
  starting: 'app.status.starting',
  stopped: 'app.status.stopped',
  error: 'app.status.error'
} as const

/**
 * Ícono del modo en el riel de escritorio (maqueta B): Overdrive lleva un rayo y Rutinas un reloj; el celular conserva los suyos (la PWA
 * no cambia).
 */
const modeIcon = (m: ModeDefinition): ModeDefinition['icon'] => (m.id === 'tasks' ? Zap : m.id === 'routines' ? Clock : m.icon)

/** Botón de 36 × 36 (radio 10) del riel: tooltip con nombre + atajo a la derecha, con el ratón y con el foco. */
function RailButton({
  label,
  shortcut,
  onClick,
  current,
  pressed,
  badge,
  testId,
  children
}: {
  label: string
  shortcut?: string
  onClick: () => void
  current?: boolean
  pressed?: boolean
  testId?: string
  /** Punto de aviso (esquina superior derecha, con anillo del color de la barra). */
  badge?: { label: string; tone: 'bg-warning' | 'bg-success' | 'bg-danger' | 'bg-accent'; testId?: string; count?: number }
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
          data-testid={testId}
          onClick={onClick}
          className={`no-drag grid size-9 place-items-center rounded-[10px] transition-[background-color,color,transform] duration-[var(--dur-fast)] hover:text-fg active:scale-[0.985] motion-reduce:active:scale-100 ${current || pressed ? 'bg-active text-fg' : 'text-muted hover:bg-hover'}`}
        >
          {children}
        </button>
      </Tooltip>
      {badge && badge.count !== undefined && (
        <span
          role="img"
          aria-label={badge.label}
          data-testid={badge.testId}
          className={`pointer-events-none absolute top-[2px] right-[2px] grid min-w-[15px] place-items-center rounded-full px-[3px] text-[10px] desk:text-meta leading-[15px] font-semibold text-white ring-2 ring-sidebar ${badge.tone}`}
        >
          {badge.count > 99 ? '99+' : badge.count}
        </span>
      )}
      {badge && badge.count === undefined && (
        <span
          role="img"
          aria-label={badge.label}
          data-testid={badge.testId}
          className={`pointer-events-none absolute top-[6px] right-[6px] size-[7px] rounded-full ring-2 ring-sidebar ${badge.tone}`}
        />
      )}
    </div>
  )
}

/** Filtros de la lista de Code (píldoras de la maqueta B): «Todas / Activas / Cambios». Los aplica `SessionList` leyendo `sessionFilter`. */
const FILTERS = ['all', 'active', 'review'] as const

function FilterPills(): React.JSX.Element {
  const t = useT()
  const filter = useUi((s) => s.sessionFilter)
  const setFilter = useUi((s) => s.setSessionFilter)
  return (
    <div role="group" aria-label={t('app.sidebar.filters')} className="mx-0.5 mt-1 flex shrink-0 flex-nowrap items-center gap-1.5">
      {FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={filter === f}
          // Nombre accesible propio («Filtrar: con cambios»): «Cambios» a secas chocaba con el botón del panel Cambios de Code.
          aria-label={t(`app.sidebar.filterAria.${f}`)}
          onClick={() => setFilter(f)}
          className={`no-drag inline-flex h-[22px] shrink-0 items-center rounded-full border px-[9px] desk:h-6 text-[11.5px] desk:text-meta whitespace-nowrap transition-colors duration-[var(--dur-fast)] ${
            filter === f ? 'border-transparent bg-accent-soft text-accent' : 'border-border text-muted hover:bg-hover hover:text-fg'
          }`}
        >
          {t(`app.sidebar.filter.${f}`)}
        </button>
      ))}
    </div>
  )
}

/**
 * Barra lateral de escritorio, diseño «riel + lista» (maqueta B aprobada): un RIEL de 56 px con los modos arriba y Ayuda, Tema y Ajustes
 * abajo (siempre visible) y, a su lado, la LISTA de 236 px del modo («Nueva …» de acento suave, Buscar con ⌘K, filtros de Code, árbol y
 * «● Conectado» abajo).
 *
 * Plegado (⌘\ o el botón de la lista): se oculta la LISTA y queda el riel, que entonces gana «Mostrar», «Nueva» y «Buscar» (nada se pierde).
 * Rutinas no tiene lista (su vista ya trae la suya): ahí solo hay riel. Ventana angosta (`ui.narrow`, < `NARROW_WINDOW_PX`): la lista se
 * pliega sola a riel y «Mostrar» la abre SUPERPUESTA al contenido (no lo estrecha); se cierra al pulsar el contenido o con Esc.
 * `showLabel`: nombre del botón «Mostrar barra lateral» (lo trae App, que ya conoce el atajo).
 */
export function Sidebar({ showLabel }: { showLabel?: string }): React.JSX.Element {
  const {
    mode,
    setMode,
    settingsOpen,
    personalizationOpen,
    openSettings,
    openPersonalization,
    openSettingsAt,
    toggleSidebar,
    setPaletteOpen
  } = useUi()
  const listCollapsed = useUi(selectListCollapsed)
  const narrow = useUi((s) => s.narrow)
  const t = useT()
  const bindings = useEffectiveBindings()
  const hints = { 'sidebar.toggle': hintText(bindings['sidebar.toggle']), 'settings.toggle': hintText(bindings['settings.toggle']) }
  const serverState = useServer((s) => s.status.state)
  const statusLabel = serverState in STATUS_KEY ? t(STATUS_KEY[serverState as keyof typeof STATUS_KEY]) : serverState
  // Aprobaciones pendientes de Tareas (el mismo dato que alimenta las tarjetas de permiso): punto de aviso en el modo.
  const approvalsPending = useTasks((s) => Object.keys(s.permissions).length > 0)
  const inboxPending = useRoutines(selectInboxPending)
  useEffect(() => syncInbox(), [])
  const themePref = useSettings((s) => s.settings.theme)
  const def = MODES_BY_ID[mode]
  const SidebarContent = def.SidebarContent
  // Barra de título integrada de 48 px en macOS y Windows; Linux conserva el marco estándar.
  const tall = isMacPlatform() || isWindowsPlatform()
  const newHint = hintText(bindings['conversation.new'])
  const searchHint = hintText(bindings['palette.toggle'])
  /** La lista se dibuja solo si el modo tiene una y no está plegada. */
  const listShown = !!SidebarContent && !listCollapsed

  const dot = serverState === 'ready' ? 'bg-success' : serverState === 'error' ? 'bg-danger' : 'bg-warning animate-pulse'
  // Tema efectivo desde el AJUSTE (no desde `data-theme`, que useTheme aplica DESPUÉS de dibujar y dejaba el valor un paso atrasado:
  // el segundo clic repetía el mismo tema).
  const prefersDark = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const dark = themePref === 'system' ? prefersDark() : themePref === 'dark'
  const toggleTheme = (): void => {
    const cur = useSettings.getState().settings.theme
    const isDark = cur === 'system' ? prefersDark() : cur === 'dark'
    void useSettings.getState().update({ theme: isDark ? 'light' : 'dark' })
  }

  const newAction = (): void => {
    openSettings(false)
    openPersonalization(false)
    def.newAction?.run()
  }
  const goMode = (id: ModeId): void => setMode(id)

  const rail = (
    <aside
      aria-label={t('app.sidebar.aria')}
      data-rail=""
      data-collapsed={listShown ? undefined : ''}
      className="flex h-full w-14 shrink-0 flex-col items-center border-r border-border bg-sidebar pb-3"
    >
      {/* Espacio superior: en macOS libre para los semáforos; en Windows, la franja de arrastre bajo el overlay de controles. Es un
          hermano de los botones, no su contenedor (en Windows una franja `drag` se come los clics de sus hijos). */}
      <div aria-hidden="true" className={`drag w-full shrink-0 ${tall ? 'h-9' : 'h-3'}`} />
      <nav aria-label={t('app.sidebar.mode')} className="flex flex-col items-center gap-1">
        {MODES.map((m) => {
          const Icon = modeIcon(m)
          return (
            <RailButton
              key={m.id}
              label={m.label}
              shortcut={hintText(bindings[`mode.${m.id}`])}
              current={m.id === mode && !settingsOpen && !personalizationOpen}
              onClick={() => goMode(m.id)}
              badge={
                m.id === 'tasks' && approvalsPending
                  ? { label: t('app.sidebar.pendingApproval'), tone: 'bg-warning', testId: 'sidebar-approvals-dot' }
                  : m.id === 'routines' && inboxPending > 0
                    ? {
                        label: t('app.sidebar.inboxPending', { count: inboxPending }),
                        tone: 'bg-accent' as const,
                        testId: 'sidebar-inbox-count',
                        count: inboxPending
                      }
                    : undefined
              }
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            </RailButton>
          )
        })}
      </nav>
      {/* Sin lista visible, lo que vivía en ella pasa al riel: «Mostrar», «Nueva» y «Buscar», separados de los modos por una raya. */}
      {!listShown && (
        <div className="mt-2 flex flex-col items-center gap-1.5 border-t border-border pt-2">
          {SidebarContent && (
            <RailButton
              label={showLabel ?? t('app.sidebar.show', { hint: '' })}
              shortcut={hints['sidebar.toggle']}
              onClick={settingsOpen || personalizationOpen ? () => (openSettings(false), openPersonalization(false)) : toggleSidebar}
            >
              <PanelLeftOpen size={18} strokeWidth={1.8} aria-hidden="true" />
            </RailButton>
          )}
          {def.newAction && (
            <RailButton label={def.newAction.label} shortcut={newHint} onClick={newAction}>
              <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
            </RailButton>
          )}
          <RailButton label={t('app.sidebar.search')} shortcut={searchHint} onClick={() => setPaletteOpen(true)}>
            <Search size={18} strokeWidth={1.8} aria-hidden="true" />
          </RailButton>
        </div>
      )}
      <div className="min-h-2 flex-1" />
      <div className="flex flex-col items-center gap-1.5">
        <RailButton
          label={t('app.sidebar.personalization')}
          pressed={personalizationOpen}
          onClick={() => openPersonalization(!personalizationOpen)}
          testId="sidebar-personalization"
        >
          <Blocks size={18} strokeWidth={1.8} aria-hidden="true" />
        </RailButton>
        <RailButton label={t('app.sidebar.help')} onClick={() => openSettingsAt('shortcuts')}>
          <CircleHelp size={18} strokeWidth={1.8} aria-hidden="true" />
        </RailButton>
        <RailButton label={t('app.sidebar.theme')} onClick={toggleTheme}>
          {dark ? <Sun size={18} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={18} strokeWidth={1.8} aria-hidden="true" />}
        </RailButton>
        <RailButton
          label={t('app.sidebar.settings', { hint: '' })}
          shortcut={hints['settings.toggle']}
          pressed={settingsOpen}
          onClick={() => openSettings(!settingsOpen)}
          // Con la lista visible el estado va en su pie; aquí solo avisa si no está conectado. Sin lista, siempre (no se pierde).
          badge={
            !listShown || serverState !== 'ready'
              ? { label: statusLabel, tone: serverState === 'ready' ? 'bg-success' : serverState === 'error' ? 'bg-danger' : 'bg-warning' }
              : undefined
          }
        >
          <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
        </RailButton>
      </div>
    </aside>
  )

  const list = listShown && SidebarContent && (
    <aside
      aria-label={t('app.sidebar.list', { mode: def.label })}
      data-list=""
      onKeyDown={
        narrow
          ? (e) => {
              if (e.key === 'Escape') toggleSidebar()
            }
          : undefined
      }
      className={`group/list flex h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border bg-sidebar ${narrow ? 'absolute inset-y-0 left-14 z-30 shadow-pop' : ''}`}
    >
      {/* Franja superior (48 px, como la cabecera del contenido): arrastre de ventana y, a la derecha, «Ocultar» y las acciones del
          proyecto (abrir carpeta, proyectos recientes), que la maqueta no trae: solo aparecen al pasar por la lista o con el foco del
          teclado. La zona de arrastre es hermana de los botones, no su contenedor. */}
      <div className={`flex shrink-0 items-center gap-0.5 pr-2.5 ${tall ? 'h-9' : 'h-10'}`}>
        <div aria-hidden="true" className="drag h-full min-w-0 flex-1" />
        {def.projectAction && platformCaps().nativeDialogs && (
          <IconButton
            label={t('app.sidebar.openFolder')}
            size="sm"
            className="text-subtle opacity-0 transition-opacity duration-[var(--dur-fast)] group-focus-within/list:opacity-100 group-hover/list:opacity-100 focus-visible:opacity-100"
            onClick={() => {
              openSettings(false)
              def.projectAction?.()
            }}
          >
            <FolderPlus size={15} strokeWidth={1.75} />
          </IconButton>
        )}
        {def.projectAction && def.backToProjects && (
          <IconButton
            label={t('app.sidebar.recentProjects')}
            size="sm"
            className="text-subtle opacity-0 transition-opacity duration-[var(--dur-fast)] group-focus-within/list:opacity-100 group-hover/list:opacity-100 focus-visible:opacity-100"
            onClick={() => {
              openSettings(false)
              def.backToProjects?.()
            }}
          >
            <LayoutGrid size={15} strokeWidth={1.75} />
          </IconButton>
        )}
        <IconButton
          label={t('app.sidebar.hide', { hint: hintSuffix(hints['sidebar.toggle']) })}
          size="sm"
          className="text-subtle"
          onClick={toggleSidebar}
        >
          <PanelLeft size={15} strokeWidth={1.75} />
        </IconButton>
      </div>

      <div className="flex shrink-0 flex-col px-2.5">
        {/* «Nueva conversación / sesión / tarea»: botón primario de acento suave con su atajo. */}
        {def.newAction && (
          <button
            type="button"
            title={newHint ? `${def.newAction.label} (${newHint})` : undefined}
            aria-keyshortcuts={newHint || undefined}
            onClick={newAction}
            className="no-drag mt-0.5 mb-1.5 flex h-8 w-full min-w-0 items-center gap-[7px] rounded-[9px] bg-accent-soft px-2.5 text-left text-ui font-medium whitespace-nowrap text-accent transition-[filter,transform] duration-[var(--dur-fast)] hover:brightness-110 active:scale-[0.985] motion-reduce:active:scale-100"
          >
            <Plus size={15} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{def.newAction.label}</span>
          </button>
        )}

        {/* Buscar: caja con borde que abre la paleta (⌘K). El nombre accesible completo va en `aria-label`. Un modo puede poner su
            propio buscador en el mismo sitio (Tareas: busca sus tareas, con la paleta a un clic en el atajo). */}
        {def.SidebarSearch ? (
          <def.SidebarSearch openPalette={() => setPaletteOpen(true)} paletteHint={searchHint} />
        ) : (
          <button
            type="button"
            aria-label={t('app.sidebar.search')}
            aria-keyshortcuts={searchHint || undefined}
            onClick={() => setPaletteOpen(true)}
            className="no-drag mt-0.5 mb-1.5 flex h-8 w-full min-w-0 items-center gap-2 rounded-[9px] border border-border px-2.5 text-left text-ui whitespace-nowrap text-subtle transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-muted"
          >
            <Search size={15} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t('app.sidebar.searchShort')}</span>
            {searchHint && (
              <span aria-hidden="true" className="shrink-0 text-[11px] desk:text-meta leading-4">
                {searchHint}
              </span>
            )}
          </button>
        )}

        {/* Filtros: solo donde aplican (sesiones de Code: «Cambios» = por revisar). */}
        {mode === 'code' && <FilterPills />}
      </div>

      {/* Árbol del modo con su propio scroll. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-2">
        <SidebarTree onClickCapture={() => (settingsOpen && openSettings(false), personalizationOpen && openPersonalization(false))}>
          <SidebarContent />
        </SidebarTree>
      </div>

      {/* «Primeros pasos»: tarjeta plegable y discreta, solo mientras la persona no la complete ni la oculte. */}
      <FirstStepsCard />

      {/* Pie discreto: estado de la conexión (el punto cambia de color si arranca o falla). */}
      <div
        className="mx-2.5 flex h-[42px] shrink-0 items-center gap-2.5 border-t border-border text-ui text-muted"
        title={`OpenCode: ${statusLabel}`}
      >
        <span className={`size-[7px] shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <span className="min-w-0 truncate">{statusLabel}</span>
      </div>
    </aside>
  )

  // `relative`: ancla de la lista superpuesta en ventana angosta; en flujo normal la lista empuja al contenido.
  return (
    <div className="relative flex h-full shrink-0">
      {rail}
      {list}
    </div>
  )
}
