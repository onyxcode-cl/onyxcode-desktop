/**
 * Panel lateral de la PWA (rediseño F8-B102, T1): lista del modo activo, «Nueva conversación», búsqueda, y pie con Ajustes y el
 * estado del enlace. Es un diálogo modal a la izquierda (320 px) sobre un velo; mientras está abierto el resto del armazón queda
 * `inert` (lo hace MobileShell). Se cierra con la X, el velo, deslizar a la izquierda, `Esc` y el «atrás» del sistema (el panel
 * cuenta como una entrada del historial: ver `nav-history.ts`) y también al elegir un hilo (cambia la conversación activa o la pila).
 *
 * Sin portal: se pinta dentro de la raíz `[data-surface='mobile']` (así hereda tokens y sigue al `visualViewport`) y no se monta
 * cerrado. El movimiento es una animación WAAPI (translateX con fill `backwards`, regla 6 de docs/MOBILE-UI.md; con
 * «reducir movimiento», solo fundido).
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Search, Settings, SquarePen, X } from 'lucide-react'
import { LogoMark } from '../../components/Logo'
import { useT } from '../../lib/i18n'
import { useCode } from '../../features/code/impl/store'
import { MODES_BY_ID } from '../modes'
import { useActiveIds } from './adapters'
import { useLinkStatus } from './link'
import { SETTINGS_SCREEN, navPush, useMobileNav, useMobileNavStore } from './nav'

/** Desplazamiento horizontal mínimo (px) para que un deslizamiento hacia la izquierda cierre el panel. */
export const DRAWER_SWIPE_PX = 60

/** ¿El gesto cierra el panel? Hacia la izquierda, de al menos `DRAWER_SWIPE_PX` y más horizontal que vertical. */
export function swipeClosesDrawer(dx: number, dy: number): boolean {
  return dx <= -DRAWER_SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5
}

const ROW =
  'flex min-h-[var(--m-row-list)] w-full min-w-0 items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-[15px] leading-5 active:bg-hover'

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const STATUS = {
  online: { dot: 'bg-success', key: 'mobile.phone.status.online' },
  connecting: { dot: 'bg-warning', key: 'mobile.phone.status.connecting' },
  reconnecting: { dot: 'bg-warning', key: 'mobile.phone.status.reconnecting' },
  locked: { dot: 'bg-warning', key: 'mobile.phone.status.locked' },
  offline: { dot: 'bg-subtle', key: 'mobile.phone.status.offline' }
} as const

/** Estado del enlace en el pie: punto de color + texto (nunca solo color). */
function LinkState(): React.JSX.Element {
  const t = useT()
  const s = STATUS[useLinkStatus()]
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted" data-testid="drawer-link-status">
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {t(s.key)}
    </span>
  )
}

export default function DrawerPanel(): React.JSX.Element {
  const t = useT()
  const { tab } = useMobileNav()
  const setDrawer = useMobileNavStore((s) => s.setDrawer)
  const ids = useActiveIds()
  const stackKey = useMobileNavStore((s) => s.stacks[s.tab].join('>'))
  const directory = useCode((s) => s.directory)
  const def = MODES_BY_ID[tab]
  const List = def.SidebarContent
  const canCreate = !!def.newAction && (tab !== 'code' || !!directory)

  const scrim = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const listEl = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)

  const close = (): void => setDrawer(false)

  // Al abrir: baja el teclado, recuerda quién abrió y pasa el foco a la X; al cerrar devuelve el foco al botón de menú.
  useEffect(() => {
    opener.current = document.activeElement
    if (opener.current instanceof HTMLElement && opener.current !== document.body) opener.current.blur()
    closeBtn.current?.focus({ preventScroll: true })
    return () => {
      const back = opener.current instanceof HTMLElement && opener.current.isConnected ? opener.current : null
      const target = back ?? document.querySelector<HTMLElement>('[data-drawer-trigger]')
      target?.focus({ preventScroll: true })
    }
  }, [])

  // Entrada: el panel desliza desde la izquierda y el velo se funde; con reducir movimiento, solo fundido.
  useLayoutEffect(() => {
    const el = panel.current
    const bg = scrim.current
    if (!el || !bg || typeof el.animate !== 'function') return
    const ease = getComputedStyle(el).getPropertyValue('--ease-out').trim() || 'ease-out'
    const opts = { duration: reducedMotion() ? 140 : 260, easing: ease, fill: 'backwards' as const }
    bg.animate([{ opacity: 0 }, { opacity: 1 }], opts)
    el.animate(reducedMotion() ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateX(-100%)' }, { transform: 'none' }], opts)
  }, [])

  // Esc cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Elegir un hilo (cambia la conversación activa) o apilar/cambiar de pantalla cierra el panel.
  const seen = useRef(`${tab}|${stackKey}|${ids.chat}|${ids.code}|${ids.tasks}`)
  useEffect(() => {
    const now = `${tab}|${stackKey}|${ids.chat}|${ids.code}|${ids.tasks}`
    if (now === seen.current) return
    seen.current = now
    close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, stackKey, ids.chat, ids.code, ids.tasks])

  // Deslizar a la izquierda cierra. Dentro del panel las filas no se deslizan (`data-in-drawer`, ver mobile-shell.css): el gesto
  // es del panel, y las acciones de fila quedan en mantener pulsado o «⋯». El inicio del gesto se anota en la captura.
  const onDownCapture = (e: ReactPointerEvent): void => {
    swipe.current = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e: ReactPointerEvent): void => {
    const s = swipe.current
    swipe.current = null
    if (s && swipeClosesDrawer(e.clientX - s.x, e.clientY - s.y)) close()
  }

  const newItem = (): void => {
    def.newAction?.run()
    const nav = useMobileNavStore.getState()
    // Chat: la raíz es Inicio (conversación nueva). Tareas abre la tarea nueva. Code abre la sesión que crea `run`.
    if (tab === 'chat') nav.toRoot()
    else if (tab === 'tasks') nav.push('detail')
    close()
  }

  // Un solo buscador: la fila «Buscar o ir a…» es la puerta; el campo de la lista (oculto por CSS) se muestra y se enfoca al tocarla.
  const [searching, setSearching] = useState(false)
  const focusInput = (): void => {
    const input = listEl.current?.querySelector<HTMLInputElement>('input')
    input?.focus()
    input?.scrollIntoView({ block: 'nearest' })
  }
  useEffect(() => {
    if (searching) focusInput()
  }, [searching])
  const focusSearch = (): void => (searching ? focusInput() : setSearching(true))

  const openSettings = (): void => {
    // Una sola actualización: apila Ajustes y cierra el panel (un único ajuste del historial).
    useMobileNavStore.setState((s) => ({ ...navPush(s, SETTINGS_SCREEN), drawerOpen: false }))
  }

  return (
    <div className="absolute inset-0 z-40" data-drawer="" data-searching={searching ? '' : undefined}>
      <div ref={scrim} aria-hidden="true" data-drawer-scrim="" onClick={close} className="absolute inset-0 bg-[var(--m-backdrop)]" />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.drawer.aria')}
        data-in-drawer=""
        onPointerDownCapture={onDownCapture}
        onPointerUp={onUp}
        onPointerCancel={() => (swipe.current = null)}
        className="absolute inset-y-0 left-0 flex w-[min(var(--m-drawer),calc(100vw-40px))] touch-pan-y flex-col bg-sidebar shadow-lg"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)'
        }}
      >
        <div className="flex h-[var(--m-bar)] shrink-0 items-center gap-2 pr-1 pl-4">
          <LogoMark size={20} />
          <span className="min-w-0 flex-1 truncate font-display text-[17px] leading-6 font-semibold">OnyxCode</span>
          <button
            ref={closeBtn}
            type="button"
            onClick={close}
            aria-label={t('mobile.drawer.close')}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-hover"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-2">
          {canCreate && def.newAction && (
            <button type="button" onClick={newItem} className={`${ROW} font-medium text-fg`}>
              <SquarePen size={20} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{def.newAction.label}</span>
            </button>
          )}
          <button type="button" onClick={focusSearch} className={`${ROW} mt-1 bg-hover text-muted`}>
            <Search size={20} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t('app.sidebar.search')}</span>
          </button>

          {def.projectAction && (
            <div className="mt-4 flex min-h-9 shrink-0 items-center pr-1 pl-3">
              <span className="text-[12px] leading-4 font-semibold text-subtle">{t('app.sidebar.projects')}</span>
              {/* El «+» (abrir carpeta como proyecto) usa un diálogo nativo que el celular no tiene: no se muestra. */}
            </div>
          )}

          <div ref={listEl} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1 pb-2" data-drawer-list="">
            {List ? <List /> : null}
          </div>
        </div>

        <div className="flex min-h-[var(--m-row-list)] shrink-0 items-center gap-2 px-2 pt-1 pb-2">
          <button type="button" onClick={openSettings} className={`${ROW} flex-1 text-fg`}>
            <Settings size={20} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t('app.sidebar.settingsLabel')}</span>
          </button>
          <LinkState />
        </div>
      </aside>
    </div>
  )
}
