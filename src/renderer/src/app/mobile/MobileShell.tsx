import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, FileCode2, GitCompare, LayoutGrid, Loader2, Menu, MoreHorizontal, SquarePen, WifiOff } from 'lucide-react'
import { modeAvailable } from '@shared/platform-caps'
import { MODE_LABELS } from '@shared/labels'
import type { ModeId } from '@shared/types'
import { ConfirmDialogHost } from '../../components/ConfirmDialog'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { useT } from '../../lib/i18n'
import { currentFlags, currentPlatform } from '../../lib/platform'
import { useCode } from '../../features/code/impl/store'
import { MobileTasksHome } from '../../features/tasks'
import { useTasks } from '../../features/tasks/impl/store'
import { BranchPill, newCodeSession } from '../../features/code/impl/CodeWorkspace'
import { CodeActionsSheet, CodePanelScreen } from '../../features/code/impl/MobileCode'
import { abbreviatePath } from '../../features/code/impl/mobile-logic'
import { SettingsView } from '../../features/settings'
import { useUi } from '../../stores/ui'
import { EngineNotice } from '../EngineNotice'
import { QuickEntryNotice } from '../QuickEntryNotice'
import { ServerBanner } from '../ServerBanner'
import { MODES_BY_ID } from '../modes'
import { LIST_MODES, clearActive, useActiveIds, useDetailTitle, type ListMode } from './adapters'
import { bannerFor, useLinkStatus, type BannerKind } from './link'
import { MobileDrawer } from './MobileDrawer'
import { RoutinesScreen, SettingsHome } from './MoreScreens'
import { createHistorySync, historyTarget, userBackAction } from './nav-history'
import {
  CODE_ACTIONS,
  CODE_BROWSER,
  CODE_CHANGES,
  CODE_FILES,
  CODE_PANEL_SCREENS,
  DETAIL_SCREEN,
  MOBILE_TABS,
  PHONE_SCREEN,
  ROOT_SCREEN,
  SETTINGS_PREFIX,
  SETTINGS_SCREEN,
  isSettingsScreen,
  navAnimation,
  topScreen,
  useMobileNav,
  useMobileNavStore,
  type MobileTab
} from './nav'
import { installViewportVars } from './viewport'
import './mobile-shell.css'

/** Secciones de Ajustes que existen en el celular (el resto se cambia desde el Mac). */
export const MOBILE_SETTINGS_SECTIONS = ['general', 'models'] as const
export type MobileSettingsSection = (typeof MOBILE_SETTINGS_SECTIONS)[number]

const isMobileSection = (v: string | null): v is MobileSettingsSection => v === 'general' || v === 'models'

/** El gesto/botón atrás del navegador ya animó solo: la siguiente transición de pantalla no repite la animación. */
let skipNextAnim = false

/** ¿La pestaña es la de un modo con lista (Chat, Code, Tareas)? Rutinas no tiene lista ni conversación. */
const isListTab = (tab: MobileTab): tab is ListMode => tab !== 'routines'

/** Atrás: desde una conversación suelta la selección del modo y vuelve a la lista; en el resto desapila. */
export function popScreen(): void {
  const st = useMobileNavStore.getState()
  if (topScreen(st) === DETAIL_SCREEN && isListTab(st.tab)) clearActive(st.tab)
  st.pop()
}

// Historial del navegador: siempre hay `profundidad - 1` entradas propias de la pestaña activa (ver `nav-history.ts`), así el
// botón/gesto «atrás» del celular desapila la pantalla de arriba, y al cambiar de pestaña no quedan entradas viejas.
function useNavHistory(): void {
  useEffect(() => {
    const target = (): number => {
      const st = useMobileNavStore.getState()
      return historyTarget(st.stacks[st.tab].length, st.drawerOpen)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = createHistorySync(
      {
        push: () => {
          try {
            history.pushState({ lazunoxNav: true }, '')
          } catch {
            // sin historial: solo funciona el botón de la interfaz
          }
        },
        go: (n) => {
          try {
            history.go(n)
          } catch {
            // idem
          }
          clearTimeout(timer)
          timer = setTimeout(sync.settle, 700)
        }
      },
      target
    )
    const onPop = (): void => {
      if (sync.popstate() === 'user') {
        // Con el panel abierto, «atrás» solo lo cierra (la entrada del panel ya se consumió).
        if (userBackAction(useMobileNavStore.getState().drawerOpen) === 'close-drawer') {
          useMobileNavStore.getState().setDrawer(false)
        } else {
          skipNextAnim = true
          popScreen()
        }
      }
      sync.reconcile()
    }
    window.addEventListener('popstate', onPop)
    const off = useMobileNavStore.subscribe(() => sync.reconcile())
    sync.reconcile()
    return () => {
      window.removeEventListener('popstate', onPop)
      off()
      clearTimeout(timer)
    }
  }, [])
}

/** Sincroniza la navegación con los cambios que vienen de fuera (notificaciones, entrada rápida, «Conectar una IA»). */
function useExternalSync(): void {
  const mode = useUi((s) => s.mode)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const ids = useActiveIds()
  const prev = useRef(ids)
  const directory = useCode((s) => s.directory)

  // Cerrar o cambiar de proyecto de Code devuelve esa pestaña a su lista (sin pantallas viejas apiladas).
  useEffect(() => {
    useMobileNavStore.getState().resetTab('code')
  }, [directory])

  useEffect(() => {
    if ((MOBILE_TABS as readonly string[]).includes(mode)) useMobileNavStore.getState().showTab(mode as MobileTab)
  }, [mode])

  // Algo pidió abrir Ajustes (p. ej. «conectar una IA»): se abre la versión del celular, apilada en la pestaña activa.
  useEffect(() => {
    if (!settingsOpen) return
    const nav = useMobileNavStore.getState()
    let wanted: string | null = null
    try {
      wanted = localStorage.getItem('settings.section')
    } catch {
      // sin storage
    }
    // Si Ajustes ya está apilado en esta pestaña no se repite.
    if (!nav.stacks[nav.tab].some(isSettingsScreen)) {
      nav.push(SETTINGS_SCREEN)
      if (isMobileSection(wanted)) nav.push(SETTINGS_PREFIX + wanted)
    }
    useUi.getState().openSettings(false)
  }, [settingsOpen])

  // Abrir una conversación (lista, notificación, entrada rápida) la muestra a pantalla completa.
  useEffect(() => {
    const before = prev.current
    prev.current = ids
    for (const m of LIST_MODES) {
      if (before[m] || !ids[m]) continue
      const nav = useMobileNavStore.getState()
      if (nav.tab === m) nav.push(DETAIL_SCREEN)
      else if (useUi.getState().mode === m) nav.openDetail(m)
    }
  }, [ids])
}

function TabBar({ onReselect }: { onReselect: () => void }): React.JSX.Element {
  const t = useT()
  const { tab, depth, setTab } = useMobileNav()
  // Aprobaciones pendientes de Tareas: el mismo dato que el punto de la barra de escritorio (app/Sidebar.tsx). Solo refleja
  // permisos cuando el store de Tareas ya está conectado (decisiones-pwa #3: no se carga al arrancar).
  const approvalsPending = useTasks((s) => Object.keys(s.permissions).length > 0)
  const tabs: { id: MobileTab; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
    ...LIST_MODES.filter((m) => modeAvailable(m, currentPlatform(), currentFlags())).map((m) => ({
      id: m as MobileTab,
      label: MODE_LABELS[m],
      // Tareas usa ListChecks, igual que escritorio (decisiones-pwa #2).
      icon: MODES_BY_ID[m].icon
    })),
    { id: 'routines', label: MODE_LABELS.routines, icon: MODES_BY_ID.routines.icon }
  ]
  const choose = (id: MobileTab): void => {
    // Tocar de nuevo la pestaña activa: con pila vuelve a la lista (`setTab`); ya en la lista, sube al principio.
    if (id === tab && depth === 1) onReselect()
    setTab(id)
    useUi.getState().setMode(id as ModeId)
  }
  return (
    <nav
      aria-label={t('mobile.nav.aria')}
      data-tabbar=""
      className="flex shrink-0 bg-sidebar px-2 pt-1.5 select-none"
      style={{ paddingBottom: 'max(12px, var(--sab, 0px))' }}
    >
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = id === tab
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => choose(id)}
            className="group flex min-h-[var(--m-tab-item)] flex-1 flex-col items-center gap-0.5 text-[11px] leading-[14px] font-medium"
          >
            <span
              className={`flex h-[var(--m-pill-h)] w-[var(--m-pill-w)] items-center justify-center rounded-full transition-[background-color,transform] duration-[var(--dur-base)] group-active:scale-[0.98] group-active:bg-hover motion-reduce:group-active:scale-100 ${active ? 'bg-hover text-accent' : 'text-muted'}`}
            >
              <span className="relative inline-flex">
                <Icon size={20} strokeWidth={1.75} />
                {id === 'tasks' && approvalsPending && (
                  <span
                    role="img"
                    aria-label={t('app.sidebar.pendingApproval')}
                    className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-sidebar"
                  />
                )}
              </span>
            </span>
            <span className={active ? 'font-semibold text-fg' : 'text-muted'}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function TopBar({
  title,
  subtitle,
  onBack,
  action,
  root
}: {
  title: string
  subtitle?: React.ReactNode
  onBack?: () => void
  action?: React.ReactNode
  /** Cabecera de una pantalla raíz: botón de menú a la izquierda y filete solo al desplazar (ver mobile-shell.css). */
  root?: boolean
}): React.JSX.Element {
  const t = useT()
  const drawerOpen = useMobileNavStore((s) => s.drawerOpen)
  const setDrawer = useMobileNavStore((s) => s.setDrawer)
  return (
    <header
      data-edge={root ? 'root' : 'detail'}
      className="grid min-h-[calc(var(--m-bar)+env(safe-area-inset-top,0px))] shrink-0 grid-cols-[minmax(44px,auto)_minmax(0,1fr)_minmax(44px,auto)] items-center bg-bg px-2 select-none"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex items-center justify-start">
        {onBack ? (
          <button type="button" onClick={onBack} aria-label={t('mobile.back')} className={barBtn}>
            <ChevronLeft size={22} />
          </button>
        ) : root ? (
          <button
            type="button"
            data-drawer-trigger=""
            onClick={() => setDrawer(true)}
            aria-label={t('mobile.drawer.open')}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            className={barBtn}
          >
            <Menu size={20} />
          </button>
        ) : null}
      </div>
      <div className="min-w-0 text-center">
        <h1
          tabIndex={-1}
          className={`min-w-0 truncate font-display tracking-tight outline-none ${
            subtitle ? 'pt-1 text-[15px] leading-5 font-semibold' : 'text-[17px] leading-6 font-semibold'
          }`}
        >
          {title}
        </h1>
        {subtitle && <div className="flex min-h-5 min-w-0 items-center justify-center gap-1.5 pb-1">{subtitle}</div>}
      </div>
      <div className="flex items-center justify-end">{action}</div>
    </header>
  )
}

const goBack = popScreen

function titleOfSettingsScreen(screen: string, t: ReturnType<typeof useT>): string {
  if (screen === `${SETTINGS_PREFIX}general`) return t('mobile.settings.general')
  if (screen === `${SETTINGS_PREFIX}models`) return t('mobile.settings.models')
  return t('mobile.settings.title')
}

function ListScreen({ mode }: { mode: ListMode }): React.JSX.Element {
  const def = MODES_BY_ID[mode]
  const directory = useCode((s) => s.directory)
  // Code sin carpeta abierta: la pantalla de proyectos ocupa el lugar de la lista (sin cabecera propia: la del armazón).
  if (mode === 'code' && !directory) return <def.View />
  const List = def.SidebarContent
  return <div className="px-2 py-2">{List ? <List /> : null}</div>
}

/**
 * Code: la lista de sesiones es la del armazón; la conversación se queda montada (con su desplazamiento y borrador) mientras
 * Cambios/Archivos/navegador se apilan encima a pantalla completa y el menú «⋯» sale como hoja.
 */
function CodeBody({ screen, hasDetail }: { screen: string; hasDetail: boolean }): React.JSX.Element {
  const directory = useCode((s) => s.directory)
  const View = MODES_BY_ID.code.View
  if (!directory) return <View />
  if (!hasDetail) return <ListScreen mode="code" />
  const panel = CODE_PANEL_SCREENS.includes(screen)
  return (
    <>
      <div className="h-full" inert={panel || undefined} aria-hidden={panel || undefined}>
        <View />
      </div>
      {panel && (
        <div className="absolute inset-0 animate-m-push bg-bg" data-code-panel={screen}>
          <CodePanelScreen screen={screen} directory={directory} />
        </div>
      )}
      <CodeActionsSheet open={screen === CODE_ACTIONS} />
    </>
  )
}

function Body(): React.JSX.Element {
  const { tab, screen } = useMobileNav()
  const codeStack = useMobileNavStore((s) => s.stacks.code)
  // Ajustes y «Este celular» se apilan sobre la pestaña activa: se resuelven igual en cualquiera.
  if (screen === PHONE_SCREEN || screen === SETTINGS_SCREEN) return <SettingsHome />
  if (screen.startsWith(SETTINGS_PREFIX)) {
    const id = screen.slice(SETTINGS_PREFIX.length)
    return <SettingsView mobile={{ onOpen: () => undefined }} initial={isMobileSection(id) ? id : 'general'} />
  }
  if (tab === 'routines') return <RoutinesScreen />
  if (tab === 'code') return <CodeBody screen={screen} hasDetail={codeStack.includes(DETAIL_SCREEN)} />
  const mode = tab as ListMode
  if (screen === DETAIL_SCREEN) {
    const View = MODES_BY_ID[mode].View
    return <View />
  }
  // Raíz de Chat = Inicio (la vista sin conversación); raíz de Tareas = Inicio de Tareas. Las listas viven en el panel.
  if (mode === 'chat') {
    const View = MODES_BY_ID.chat.View
    return <View />
  }
  return <MobileTasksHome />
}

const CODE_PANEL_TITLE = {
  [CODE_CHANGES]: 'code.panel.changes',
  [CODE_FILES]: 'code.panel.files',
  [CODE_BROWSER]: 'code.m.browser.title'
} as const

const barBtn = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg active:bg-hover'

/** Barra de la conversación de Code: título, rama y ruta, y las acciones (Cambios, Archivos, más). Detener está en el compositor. */
function CodeDetailBar({ title, onBack, screen }: { title: string; onBack?: () => void; screen: string }): React.JSX.Element {
  const t = useT()
  const directory = useCode((s) => s.directory)
  const push = useMobileNavStore((s) => s.push)
  if (!directory) return <TopBar title={title} onBack={onBack} />
  return (
    <TopBar
      title={title}
      onBack={onBack}
      subtitle={
        <>
          <BranchPill directory={directory} />
          <span className="min-w-0 truncate font-mono text-[12px] leading-4 text-subtle" title={directory}>
            {abbreviatePath(directory, 24)}
          </span>
        </>
      }
      action={
        <>
          <button
            type="button"
            aria-label={t('code.panel.changes')}
            title={t('code.panel.changes')}
            aria-pressed={screen === CODE_CHANGES}
            onClick={() => push(CODE_CHANGES)}
            className={barBtn}
          >
            <GitCompare size={20} />
          </button>
          <button
            type="button"
            aria-label={t('code.panel.files')}
            title={t('code.panel.files')}
            aria-pressed={screen === CODE_FILES}
            onClick={() => push(CODE_FILES)}
            className={barBtn}
          >
            <FileCode2 size={20} />
          </button>
          <button
            type="button"
            aria-label={t('code.m.more')}
            title={t('code.m.more')}
            aria-haspopup="dialog"
            onClick={() => push(CODE_ACTIONS)}
            className={barBtn}
          >
            <MoreHorizontal size={20} />
          </button>
        </>
      }
    />
  )
}

function Bar(): React.JSX.Element {
  const t = useT()
  const { tab, screen, canGoBack } = useMobileNav()
  const detailTitle = useDetailTitle(isListTab(tab) ? tab : 'chat')
  const directory = useCode((s) => s.directory)
  const closeProject = useCode((s) => s.closeProject)
  const codeHasDetail = useMobileNavStore((s) => s.stacks.code.includes(DETAIL_SCREEN))
  const onBack = canGoBack ? goBack : undefined

  // Ajustes / «Este celular»: pantalla apilada en cualquier pestaña.
  if (isSettingsScreen(screen)) return <TopBar title={titleOfSettingsScreen(screen, t)} onBack={onBack} />
  if (!isListTab(tab)) return <TopBar title={MODE_LABELS.routines} onBack={onBack} root={screen === ROOT_SCREEN} />
  const mode = tab
  if (mode === 'code' && codeHasDetail && directory) {
    if (CODE_PANEL_SCREENS.includes(screen))
      return <TopBar title={t(CODE_PANEL_TITLE[screen as keyof typeof CODE_PANEL_TITLE])} onBack={onBack} />
    return <CodeDetailBar title={detailTitle} onBack={onBack} screen={screen} />
  }
  if (screen === DETAIL_SCREEN) return <TopBar title={detailTitle} onBack={onBack} />
  const canCreate = mode !== 'code' || !!directory
  const def = MODES_BY_ID[mode]
  const create = (): void => {
    if (mode === 'code') return void newCodeSession()
    def.newAction?.run()
    // Chat: la raíz ya es Inicio (conversación nueva); Tareas abre la tarea nueva.
    if (mode === 'chat') useMobileNavStore.getState().toRoot()
    else useMobileNavStore.getState().push(DETAIL_SCREEN)
  }
  return (
    <TopBar
      root
      title={def.label}
      action={
        <>
          {mode === 'code' && directory && (
            <button
              type="button"
              onClick={closeProject}
              aria-label={t('code.menu.recentProjects')}
              title={t('code.menu.recentProjects')}
              className={barBtn}
            >
              <LayoutGrid size={20} />
            </button>
          )}
          {canCreate && def.newAction && (
            <button type="button" onClick={create} aria-label={def.newAction.label} className={barBtn}>
              <SquarePen size={20} strokeWidth={1.75} />
            </button>
          )}
        </>
      }
    />
  )
}

const BANNER_STYLE: Record<BannerKind, string> = {
  reconnecting: 'border-warning/20 bg-warning/10 text-warning',
  offline: 'border-danger/20 bg-danger/10 text-danger',
  recovered: 'border-success/20 bg-success/10 text-success'
}

/** Único aviso de conexión de la interfaz completa (la capa ligera ya no pinta el suyo con la app montada). */
function LinkBanner(): React.JSX.Element {
  const t = useT()
  const status = useLinkStatus()
  const prev = useRef(status)
  const [recovered, setRecovered] = useState(false)
  useEffect(() => {
    const kind = bannerFor(prev.current, status)
    prev.current = status
    setRecovered(kind === 'recovered')
    if (kind !== 'recovered') return
    const id = setTimeout(() => setRecovered(false), 1800)
    return () => clearTimeout(id)
  }, [status])
  const kind: BannerKind | null =
    status === 'reconnecting' ? 'reconnecting' : status === 'offline' ? 'offline' : recovered ? 'recovered' : null
  // La región viva existe siempre (para que el lector de pantalla anuncie el cambio); el aviso entra y sale dentro de ella.
  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {kind && (
        <div
          key={kind}
          data-banner={kind}
          className={`flex min-h-9 animate-rise-in items-center gap-2 border-b px-4 py-1.5 text-[13px] leading-[18px] font-medium ${BANNER_STYLE[kind]}`}
        >
          {kind === 'reconnecting' ? (
            <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden="true" />
          ) : kind === 'offline' ? (
            <WifiOff size={15} className="shrink-0" aria-hidden="true" />
          ) : (
            <Check size={15} className="shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0">
            {kind === 'reconnecting'
              ? t('mobile.banner.reconnecting')
              : kind === 'offline'
                ? t('mobile.banner.offline')
                : t('mobile.banner.online')}
          </span>
        </div>
      )}
    </div>
  )
}

const ANIM_CLASS = { push: 'animate-m-push', pop: 'animate-m-pop', tab: 'animate-m-tab', none: '' } as const
const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Estructura de la interfaz en el celular (superficie `remote`): una columna a pantalla completa con navegación inferior
 * (Chat · Code · Tareas · Rutinas), navegación en pila lista → conversación y botón atrás. Sustituye a la barra lateral y a los
 * atajos de teclado de escritorio; las vistas son las mismas. La altura sigue al viewport visible (`visualViewport`), así el
 * teclado nunca tapa el compositor.
 */
export function MobileShell(): React.JSX.Element {
  const { tab, depth, drawerOpen } = useMobileNav()
  const codeHasDetail = useMobileNavStore((s) => s.stacks.code.includes(DETAIL_SCREEN))
  const codeDir = useCode((s) => s.directory)
  // Code mantiene montada la conversación mientras se apilan Cambios/Archivos: su llave no cambia con la profundidad.
  const onSettings = useMobileNavStore((s) => isSettingsScreen(topScreen(s)))
  const paneKey = tab === 'code' && !onSettings ? `code:${!codeDir ? 'picker' : codeHasDetail ? 'detail' : 'list'}` : `${tab}:${depth}`
  const t = useT()
  useNavHistory()
  useExternalSync()
  useEffect(() => installViewportVars(), [])
  const label = MODES_BY_ID[tab].label
  const root = depth === 1

  const rootEl = useRef<HTMLDivElement>(null)
  const mainEl = useRef<HTMLElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const scrollMemo = useRef(new Map<string, number>())
  const keyRef = useRef(paneKey)

  // Animación de la pantalla que entra: se decide una vez por cambio de pantalla (y no vuelve a salir al repintar).
  const anim = useRef({ key: paneKey, tab, depth, cls: '', moved: false })
  if (anim.current.key !== paneKey) {
    const kind = navAnimation({ tab: anim.current.tab, depth: anim.current.depth }, { tab, depth }, skipNextAnim)
    skipNextAnim = false
    anim.current = { key: paneKey, tab, depth, cls: ANIM_CLASS[kind], moved: anim.current.tab === tab }
  } else {
    anim.current.tab = tab
    anim.current.depth = depth
  }

  // Lista raíz: recupera su desplazamiento al volver; el resto de pantallas empieza arriba.
  useLayoutEffect(() => {
    keyRef.current = paneKey
    const main = mainEl.current
    if (main) main.scrollTop = root ? (scrollMemo.current.get(paneKey) ?? 0) : 0
  }, [paneKey, root])

  useEffect(() => {
    const main = mainEl.current
    if (!main) return
    const onScroll = (): void => {
      if (keyRef.current.endsWith(':1') || keyRef.current.endsWith(':list') || keyRef.current.endsWith(':picker'))
        scrollMemo.current.set(keyRef.current, main.scrollTop)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => main.removeEventListener('scroll', onScroll)
  }, [])

  // Filete de la cabecera de listas solo al desplazar: un centinela de 1 px al inicio de <main> (sin estado ni oyente de scroll).
  useEffect(() => {
    const main = mainEl.current
    const edge = sentinel.current
    const host = rootEl.current
    if (!main || !edge || !host || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => host.toggleAttribute('data-scrolled', !!entry && !entry.isIntersecting), {
      root: main
    })
    io.observe(edge)
    return () => io.disconnect()
  }, [])

  // Tras apilar o desapilar (no al cambiar de pestaña) el foco pasa al título, para que el lector de pantalla anuncie la pantalla.
  useEffect(() => {
    if (!anim.current.moved) return
    if (document.documentElement.dataset.keyboard === 'open') return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    rootEl.current?.querySelector('h1')?.focus({ preventScroll: true })
  }, [paneKey])

  const toTop = (): void => mainEl.current?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })

  return (
    <div
      ref={rootEl}
      data-surface="mobile"
      className="fixed inset-x-0 flex flex-col overflow-hidden bg-bg text-fg"
      style={{
        top: 'var(--vv-top, 0px)',
        height: 'var(--vv-height, 100dvh)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)'
      }}
    >
      <ConfirmDialogHost />
      {/* Con el panel abierto todo lo demás queda `inert` (sin foco, sin toques, fuera del árbol de accesibilidad). */}
      <div className="flex min-h-0 flex-1 flex-col" inert={drawerOpen || undefined}>
        <Bar />
        <ErrorBoundary label={t('app.boundary.server')}>
          <LinkBanner />
          <ServerBanner />
          <EngineNotice />
          <QuickEntryNotice />
        </ErrorBoundary>
        <main
          ref={mainEl}
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
          data-screen={`${tab}:${depth}`}
          inert={drawerOpen || undefined}
          style={root ? undefined : { paddingBottom: 'var(--sab, 0px)' }}
        >
          <div ref={sentinel} aria-hidden="true" className="-mb-px h-px" />
          <div key={paneKey} className={`${root && tab !== 'chat' ? 'min-h-full' : 'h-full'} ${anim.current.cls}`}>
            <ErrorBoundary key={paneKey} label={label}>
              <Body />
            </ErrorBoundary>
          </div>
        </main>
        {root && <TabBar onReselect={toTop} />}
      </div>
      <MobileDrawer />
    </div>
  )
}
