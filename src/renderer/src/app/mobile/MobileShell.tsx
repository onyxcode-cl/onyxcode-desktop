import { useEffect, useRef } from 'react'
import { ChevronLeft, Ellipsis, Plus } from 'lucide-react'
import { modeAvailable } from '@shared/platform-caps'
import { MODE_LABELS } from '@shared/labels'
import type { ModeId } from '@shared/types'
import { ConfirmDialogHost } from '../../components/ConfirmDialog'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { useT } from '../../lib/i18n'
import { currentPlatform } from '../../lib/platform'
import { useCode } from '../../features/code/impl/store'
import { newCodeSession } from '../../features/code/impl/CodeWorkspace'
import { SettingsView } from '../../features/settings'
import { useUi } from '../../stores/ui'
import { EngineNotice } from '../EngineNotice'
import { QuickEntryNotice } from '../QuickEntryNotice'
import { ServerBanner } from '../ServerBanner'
import { MODES_BY_ID } from '../modes'
import { LIST_MODES, clearActive, isListMode, useActiveIds, useDetailTitle, type ListMode } from './adapters'
import { useLinkStatus } from './link'
import { MoreRoot, PhoneScreen, RoutinesScreen } from './MoreScreens'
import { DETAIL_SCREEN, ROOT_SCREEN, topScreen, useMobileNav, useMobileNavStore, type MobileTab } from './nav'
import { installViewportVars } from './viewport'

/** Secciones de Ajustes que existen en el celular (el resto se cambia desde el Mac). */
export const MOBILE_SETTINGS_SECTIONS = ['general', 'models'] as const
export type MobileSettingsSection = (typeof MOBILE_SETTINGS_SECTIONS)[number]
const SETTINGS_PREFIX = 'settings:'

const isMobileSection = (v: string | null): v is MobileSettingsSection => v === 'general' || v === 'models'

/** Atrás: desde una conversación suelta la selección del modo y vuelve a la lista; en el resto desapila. */
export function popScreen(): void {
  const st = useMobileNavStore.getState()
  if (topScreen(st) === DETAIL_SCREEN && isListMode(st.tab)) clearActive(st.tab)
  st.pop()
}

// Historial del navegador: cada pantalla apilada añade una entrada para que el botón/gesto «atrás» del celular desapile.
let historyEntries = 0

function useNavHistory(): void {
  useEffect(() => {
    const onPop = (): void => {
      if (historyEntries > 0) historyEntries--
      popScreen()
    }
    window.addEventListener('popstate', onPop)
    const off = useMobileNavStore.subscribe((s, prev) => {
      if (s.tab === prev.tab && s.stacks[s.tab].length > prev.stacks[prev.tab].length) {
        try {
          history.pushState({ onyxNav: true }, '')
          historyEntries++
        } catch {
          // sin historial: solo funciona el botón de la interfaz
        }
      }
    })
    return () => {
      window.removeEventListener('popstate', onPop)
      off()
    }
  }, [])
}

/** Sincroniza la navegación con los cambios que vienen de fuera (notificaciones, entrada rápida, «Conectar una IA»). */
function useExternalSync(): void {
  const mode = useUi((s) => s.mode)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const ids = useActiveIds()
  const prev = useRef(ids)

  useEffect(() => {
    if (isListMode(mode)) useMobileNavStore.getState().showTab(mode)
  }, [mode])

  // Algo pidió abrir Ajustes (p. ej. «conectar una IA»): se abre la versión del celular.
  useEffect(() => {
    if (!settingsOpen) return
    const nav = useMobileNavStore.getState()
    let wanted: string | null = null
    try {
      wanted = localStorage.getItem('settings.section')
    } catch {
      // sin storage
    }
    nav.showTab('more')
    nav.toRoot()
    nav.push('settings')
    if (isMobileSection(wanted)) nav.push(SETTINGS_PREFIX + wanted)
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

function TabBar(): React.JSX.Element {
  const t = useT()
  const { tab, setTab } = useMobileNav()
  const tabs: { id: MobileTab; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
    ...LIST_MODES.filter((m) => modeAvailable(m, currentPlatform())).map((m) => ({
      id: m as MobileTab,
      label: MODE_LABELS[m],
      icon: MODES_BY_ID[m].icon
    })),
    { id: 'more', label: t('mobile.tab.more'), icon: Ellipsis }
  ]
  const choose = (id: MobileTab): void => {
    setTab(id)
    if (isListMode(id)) useUi.getState().setMode(id as ModeId)
  }
  return (
    <nav
      aria-label={t('mobile.nav.aria')}
      className="flex shrink-0 border-t border-border bg-sidebar"
      style={{ paddingBottom: 'var(--sab, 0px)' }}
    >
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = id === tab
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => choose(id)}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium ${active ? 'text-accent' : 'text-muted'}`}
          >
            <Icon size={22} strokeWidth={active ? 2.3 : 1.9} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}

function TopBar({ title, onBack, action }: { title: string; onBack?: () => void; action?: React.ReactNode }): React.JSX.Element {
  const t = useT()
  return (
    <header
      className="flex shrink-0 items-center gap-1 border-b border-border/70 bg-bg px-2"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={t('mobile.back')}
          className="inline-flex h-12 w-11 shrink-0 items-center justify-center rounded-full text-fg active:bg-hover"
        >
          <ChevronLeft size={24} />
        </button>
      ) : (
        <span className="w-2 shrink-0" />
      )}
      <h1 className="min-h-12 min-w-0 flex-1 truncate py-3 font-display text-[17px] leading-6 font-semibold tracking-tight">{title}</h1>
      <div className="flex shrink-0 items-center">{action}</div>
    </header>
  )
}

function goBack(): void {
  if (historyEntries > 0) history.back()
  else popScreen()
}

function titleOfMoreScreen(screen: string, t: ReturnType<typeof useT>): string {
  if (screen === 'routines') return MODE_LABELS.routines
  if (screen === 'phone') return t('mobile.phone.title')
  if (screen === 'settings') return t('mobile.settings.title')
  if (screen === `${SETTINGS_PREFIX}general`) return t('mobile.settings.general')
  if (screen === `${SETTINGS_PREFIX}models`) return t('mobile.settings.models')
  return t('mobile.more.title')
}

function ListScreen({ mode }: { mode: ListMode }): React.JSX.Element {
  const def = MODES_BY_ID[mode]
  const directory = useCode((s) => s.directory)
  // Code sin carpeta abierta: la pantalla de proyectos ocupa el lugar de la lista.
  if (mode === 'code' && !directory) return <def.View />
  const List = def.SidebarContent
  return <div className="px-2 py-2">{List ? <List /> : null}</div>
}

function Body(): React.JSX.Element {
  const { tab, screen, push } = useMobileNav()
  if (tab === 'more') {
    if (screen === 'routines') return <RoutinesScreen />
    if (screen === 'phone') return <PhoneScreen />
    if (screen === 'settings') return <SettingsView mobile={{ onOpen: (id) => push(SETTINGS_PREFIX + id) }} />
    if (screen.startsWith(SETTINGS_PREFIX)) {
      const id = screen.slice(SETTINGS_PREFIX.length)
      return <SettingsView mobile={{ onOpen: () => undefined }} initial={isMobileSection(id) ? id : 'general'} />
    }
    return <MoreRoot />
  }
  const mode = tab as ListMode
  if (screen === DETAIL_SCREEN) {
    const View = MODES_BY_ID[mode].View
    return <View />
  }
  return <ListScreen mode={mode} />
}

function Bar(): React.JSX.Element {
  const t = useT()
  const { tab, screen, canGoBack } = useMobileNav()
  const detailTitle = useDetailTitle(tab === 'more' ? 'chat' : (tab as ListMode))
  const directory = useCode((s) => s.directory)
  const onBack = canGoBack ? goBack : undefined

  if (tab === 'more')
    return <TopBar title={screen === ROOT_SCREEN ? t('mobile.more.title') : titleOfMoreScreen(screen, t)} onBack={onBack} />
  const mode = tab as ListMode
  if (screen === DETAIL_SCREEN) return <TopBar title={detailTitle} onBack={onBack} />
  const canCreate = mode !== 'code' || !!directory
  const def = MODES_BY_ID[mode]
  const create = (): void => {
    if (mode === 'code') return void newCodeSession()
    def.newAction?.run()
    useMobileNavStore.getState().push(DETAIL_SCREEN)
  }
  return (
    <TopBar
      title={def.label}
      action={
        canCreate && def.newAction ? (
          <button
            type="button"
            onClick={create}
            aria-label={def.newAction.label}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent active:opacity-80"
          >
            <Plus size={22} strokeWidth={2.3} />
          </button>
        ) : null
      }
    />
  )
}

function LinkBanner(): React.JSX.Element | null {
  const t = useT()
  const status = useLinkStatus()
  if (status === 'online' || status === 'locked' || status === 'connecting') return null
  const offline = status === 'offline'
  return (
    <div
      role="status"
      className={`shrink-0 border-b px-4 py-2 text-[13px] ${offline ? 'border-danger/30 bg-danger/10 text-danger' : 'border-border bg-accent-soft/50 text-muted'}`}
    >
      {offline ? t('mobile.banner.offline') : t('mobile.banner.reconnecting')}
    </div>
  )
}

/**
 * Estructura de la interfaz en el celular (superficie `remote`): una columna a pantalla completa con navegación inferior
 * (Chat · Code · Tareas · Más), navegación en pila lista → conversación y botón atrás. Sustituye a la barra lateral y a los
 * atajos de teclado de escritorio; las vistas son las mismas. La altura sigue al viewport visible (`visualViewport`), así el
 * teclado nunca tapa el compositor.
 */
export function MobileShell(): React.JSX.Element {
  const { tab, depth } = useMobileNav()
  const t = useT()
  useNavHistory()
  useExternalSync()
  useEffect(() => installViewportVars(), [])
  const label = tab === 'more' ? t('mobile.more.title') : MODES_BY_ID[tab as ListMode].label
  const root = depth === 1

  return (
    <div
      data-surface="mobile"
      className="fixed inset-x-0 flex flex-col overflow-hidden bg-bg text-fg"
      style={{ top: 'var(--vv-top, 0px)', height: 'var(--vv-height, 100dvh)' }}
    >
      <ConfirmDialogHost />
      <Bar />
      <ErrorBoundary label={t('app.boundary.server')}>
        <LinkBanner />
        <ServerBanner />
        <EngineNotice />
        <QuickEntryNotice />
      </ErrorBoundary>
      <main
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-screen={`${tab}:${depth}`}
        style={root ? undefined : { paddingBottom: 'var(--sab, 0px)' }}
      >
        <div key={`${tab}:${depth}`} className={root ? 'min-h-full' : 'h-full animate-fade-in'}>
          <ErrorBoundary key={`${tab}:${depth}`} label={label}>
            <Body />
          </ErrorBoundary>
        </div>
      </main>
      {root && <TabBar />}
    </div>
  )
}
