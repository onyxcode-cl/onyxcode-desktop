import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  Archive,
  ArchiveRestore,
  CheckCheck,
  ChevronDown,
  Circle,
  FolderOpen,
  GitBranchPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  ShieldAlert,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { displayTitle } from './session-title'
import { dayBucket } from './day-bucket'
import type { MsgKey } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { baseName, NewWorktreeDialog, pickAndOpenFolder } from './ProjectPicker'
import { sameDir } from './open-projects'
import { rootSessionID, selectProjectIsLive, selectProjectSessions, useCode } from './store'
import { timeAgo } from './ui'
import { deriveSessionState, legacyBaseline, sessionNeedsReview, summarySignature } from './review-logic'
import { registerAction } from '../../../keybindings/registry'
import { useUi } from '../../../stores/ui'
import { LoadMoreSessions } from '../../../components/LoadMoreSessions'
import { isSubmitKey } from '../../../lib/textarea'
import { isRemoteSurface, platformCaps } from '../../../lib/platform'
import { SidebarEmpty } from '../../../components/SidebarEmpty'
import { StateDot, useSidebarTree, SidebarTreeRegion, type SessionState } from '../../../components/SidebarTree'
import { Sheet } from '../../../components/mobile/Sheet'
import { SheetAction } from './SheetAction'
import { SwipeRow, useLongPress } from '../../../components/mobile/SwipeRow'

const OPEN_KEY = 'sidebar.projectOpen:'

function readOpen(directory: string | null): boolean {
  if (!directory) return true
  try {
    return localStorage.getItem(OPEN_KEY + directory) !== '0'
  } catch {
    return true
  }
}

function writeOpen(directory: string | null, open: boolean): void {
  if (!directory) return
  try {
    localStorage.setItem(OPEN_KEY + directory, open ? '1' : '0')
  } catch {
    // sin storage: el plegado no se recuerda
  }
}

/** Fila de sesión con menú contextual (renombrar / fijar / archivar / eliminar). */
function SessionRow({
  session,
  directory,
  active,
  waiting,
  busy,
  unread,
  needsReview,
  pinned
}: {
  session: { id: string; title: string; time: { updated: number }; summary?: { additions: number; deletions: number; files: number } }
  /** Proyecto al que pertenece (del grupo donde se pinta): si no tiene el foco, abrirla primero le da el foco. */
  directory: string
  active: boolean
  waiting: boolean
  busy: boolean
  unread: boolean
  /** Terminó con cambios que aún no se aceptaron en el panel Cambios. */
  needsReview: boolean
  pinned: boolean
}): React.JSX.Element {
  const t = useT()
  const tree = useSidebarTree()
  const state: SessionState | null = deriveSessionState({ waiting, busy, unread, needsReview })
  const [deskMenu, setDeskMenu] = useState(false)
  const menuRoot = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selectSession = useCode((s) => s.selectSession)
  const deleteSession = useCode((s) => s.deleteSession)
  const renameSession = useCode((s) => s.renameSession)
  const togglePin = useCode((s) => s.togglePin)
  const archiveSession = useCode((s) => s.archiveSession)
  const unarchiveSession = useCode((s) => s.unarchiveSession)
  const acceptSession = useCode((s) => s.acceptSession)
  const archived = !!(session as { time?: { archived?: number } }).time && !!(session as { time?: { archived?: number } }).time?.archived
  const [editing, setEditing] = useState(false)
  // Celular: tocar abre la conversación; renombrar/fijar/archivar/eliminar salen de un menú «⋯» (sin hover ni doble clic).
  const mobile = isRemoteSurface()
  const [menuOpen, setMenuOpen] = useState(false)
  const press = useLongPress(() => setMenuOpen(true))
  const [draft, setDraft] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(session.title)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing, session.title])

  const commit = (): void => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== session.title) void renameSession(session.id, draft.trim())
  }

  // Menú «⋯» de escritorio (fijar, renombrar, archivar, eliminar): se cierra al pulsar fuera y se recorre con ↑ ↓; Esc devuelve el foco.
  useEffect(() => {
    if (!deskMenu) return
    const onDown = (e: MouseEvent): void => {
      if (menuRoot.current && !menuRoot.current.contains(e.target as Node)) setDeskMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [deskMenu])
  const onMenuKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setDeskMenu(false)
      menuRoot.current?.querySelector<HTMLButtonElement>('button')?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  const menuItem = (icon: React.ReactNode, label: string, onClick: () => void, danger?: boolean): React.JSX.Element => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setDeskMenu(false)
        onClick()
      }}
      className={`no-drag flex h-8 w-full items-center gap-2.5 rounded-ctl px-2.5 text-left text-ui hover:bg-hover focus-visible:bg-hover ${danger ? 'text-danger' : ''}`}
    >
      {icon}
      {label}
    </button>
  )

  // Nunca se borra con un gesto: el deslizamiento y la hoja pasan por la misma confirmación.
  const askDelete = (): void => {
    void confirmDialog({
      title: t('code.sessions.deleteTitle'),
      message: t('code.sessions.deleteMessage', { title: session.title || t('code.sessions.untitledLower') }),
      confirmLabel: t('code.sessions.deleteConfirm'),
      danger: true
    }).then((ok) => {
      if (ok) void deleteSession(session.id)
    })
  }

  const rowTitle = displayTitle(session.title, t('code.sessions.untitled'))
  const row = (
    <div
      role={tree ? 'treeitem' : undefined}
      aria-level={tree ? 2 : undefined}
      aria-current={tree && active ? 'page' : undefined}
      aria-label={tree ? (tree.stateAria(rowTitle, state) ?? rowTitle) : undefined}
      onContextMenu={
        mobile || editing
          ? undefined
          : (e) => {
              e.preventDefault()
              setDeskMenu(true)
            }
      }
      className={`group flex items-center gap-1 rounded-lg desk:relative desk:h-8 desk:gap-0.5 desk:rounded-ctl ${tree ? " desk:ml-[22px] desk:before:absolute desk:before:inset-y-0 desk:before:-left-[9px] desk:before:w-px desk:before:bg-border desk:before:content-['']" : ''} ${mobile ? 'min-h-14' : ''} ${active ? 'bg-active desk:bg-hover' : 'hover:bg-hover'}`}
    >
      {active && !mobile && !editing && (
        <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent desk:hidden" aria-hidden />
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (isSubmitKey(e, { allowShift: true })) commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          className={`no-drag mx-2 my-1 min-w-0 flex-1 rounded-md border border-accent bg-bg px-1.5 py-1 text-[13px] outline-none ${mobile ? 'min-h-11' : ''}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            const store = useCode.getState()
            // Sesión de un grupo que no tiene el foco: primero le da el foco, luego la abre (si no, quedaría
            // seleccionada una sesión de otro proyecto mientras el resto de la interfaz sigue mostrando el anterior).
            if (!sameDir(store.directory ?? '', directory)) void store.focusProject(directory).then(() => selectSession(session.id))
            else void selectSession(session.id)
          }}
          onDoubleClick={() => setEditing(true)}
          data-tree-primary={tree ? '' : undefined}
          title={
            tree && state ? (state === 'review' ? t('code.sessions.reviewTip') : t(`app.sidebar.state.${state}` as MsgKey)) : undefined
          }
          className={`no-drag flex min-w-0 flex-1 flex-col items-start px-2 text-left desk:h-full desk:flex-row desk:items-center desk:px-2.5 desk:py-0 ${tree ? ' desk:gap-2.5' : ' desk:gap-2 desk:pl-[30px]'} ${mobile ? 'min-h-14 justify-center px-3' : 'py-1.5'}`}
          {...(mobile ? press : {})}
        >
          <span
            className={`flex w-full items-center gap-1.5 desk:w-auto desk:min-w-0 desk:flex-1 ${tree ? ' desk:gap-2.5 desk:text-sm' : ' desk:text-ui'} ${mobile ? 'text-[15px]' : 'text-[13px]'} ${active ? ' desk:font-medium desk:text-fg' : ' desk:text-muted'}`}
          >
            {tree && state && <StateDot state={state} />}
            {pinned && <Pin size={10} className="shrink-0 text-subtle" />}
            {tree ? null : waiting ? (
              <ShieldAlert size={12} className="shrink-0 text-accent desk:hidden" />
            ) : busy ? (
              <Loader2 size={12} className="shrink-0 animate-spin text-muted desk:hidden" />
            ) : unread ? (
              <Circle size={7} fill="currentColor" className="shrink-0 text-accent" />
            ) : null}
            <span className={`truncate ${unread ? 'font-semibold text-fg' : ''}`}>
              {displayTitle(session.title, t('code.sessions.untitled'))}
            </span>
          </span>
          {!mobile && waiting && tree ? (
            // Esperando aprobación: la meta «Aprobar» no se oculta nunca (ni al pasar el ratón).
            <span className="hidden shrink-0 text-meta font-medium text-warning desk:inline">{t('tasks.list.metaApprove')}</span>
          ) : !mobile && waiting ? (
            <span className="hidden h-5 shrink-0 items-center rounded-full border border-warning/45 bg-warning/10 px-2 text-meta font-medium text-warning desk:inline-flex desk:group-hover:hidden">
              {t('tasks.list.metaApprove')}
            </span>
          ) : !mobile && busy && tree ? (
            <span
              className={`hidden shrink-0 text-meta text-subtle desk:inline desk:group-focus-within:hidden desk:group-hover:hidden ${active ? ' desk:hidden' : ''}`}
            >
              {t('app.sidebar.working')}
            </span>
          ) : !mobile && busy ? (
            <span className="hidden shrink-0 items-center gap-1.5 text-meta text-muted desk:inline-flex desk:group-hover:hidden">
              <span
                className="size-2.5 animate-spin rounded-full border-2 border-accent border-r-transparent motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t('app.sidebar.working')}
            </span>
          ) : (
            <span
              className={`text-subtle desk:shrink-0 desk:text-meta desk:tabular-nums desk:group-hover:hidden ${tree ? ` desk:group-focus-within:hidden ${active ? ' desk:hidden' : ''}` : ''} ${mobile ? 'text-xs' : 'text-[11px]'}`}
            >
              {timeAgo(session.time.updated)}
              {session.summary && session.summary.files > 0 && (
                <>
                  {' · '}
                  <span className="text-success">+{session.summary.additions}</span>{' '}
                  <span className="text-danger">-{session.summary.deletions}</span>
                </>
              )}
            </span>
          )}
        </button>
      )}
      {!editing && mobile && (
        <>
          <button
            type="button"
            aria-label={t('code.m.itemActions', { name: displayTitle(session.title, t('code.sessions.untitled')) })}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted active:bg-hover"
          >
            <MoreHorizontal size={19} />
          </button>
          <Sheet
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            title={displayTitle(session.title, t('code.sessions.untitled'))}
            size="half"
          >
            <SheetAction
              icon={<Pencil size={19} />}
              label={t('code.sessions.rename')}
              onClick={() => {
                setMenuOpen(false)
                setEditing(true)
              }}
            />
            <SheetAction
              icon={<Pin size={19} />}
              label={pinned ? t('code.sessions.unpin') : t('code.sessions.pin')}
              onClick={() => {
                setMenuOpen(false)
                togglePin(session.id)
              }}
            />
            <SheetAction
              icon={archived ? <ArchiveRestore size={19} /> : <Archive size={19} />}
              label={archived ? t('code.sessions.unarchive') : t('code.sessions.archive')}
              onClick={() => {
                setMenuOpen(false)
                void (archived ? unarchiveSession(session.id) : archiveSession(session.id))
              }}
            />
            <SheetAction
              danger
              icon={<Trash2 size={19} />}
              label={t('code.sessions.delete')}
              onClick={() => {
                setMenuOpen(false)
                askDelete()
              }}
            />
          </Sheet>
        </>
      )}
      {!editing && !mobile && (
        <div
          ref={menuRoot}
          className={`relative mr-1 shrink-0 items-center ${deskMenu || active ? 'flex' : 'hidden group-focus-within:flex group-hover:flex'}`}
        >
          <button
            type="button"
            title={t('code.m.itemActions', { name: displayTitle(session.title, t('code.sessions.untitled')) })}
            aria-label={t('code.m.itemActions', { name: displayTitle(session.title, t('code.sessions.untitled')) })}
            aria-haspopup="menu"
            aria-expanded={deskMenu}
            onClick={() => setDeskMenu((o) => !o)}
            className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-fg"
          >
            <MoreHorizontal size={14} strokeWidth={1.75} />
          </button>
          {deskMenu && (
            <div
              ref={menuRef}
              role="menu"
              aria-label={t('code.m.itemActions', { name: displayTitle(session.title, t('code.sessions.untitled')) })}
              onKeyDown={onMenuKey}
              className="absolute top-full right-0 z-30 mt-1 w-52 rounded-card bg-elevated p-1 shadow-pop"
            >
              {needsReview &&
                menuItem(<CheckCheck size={14} strokeWidth={1.75} />, t('code.sessions.markReviewed'), () =>
                  // Solo estado de interfaz: no toca archivos ni git (como «Aceptar todo» del panel Cambios).
                  acceptSession(session.id, summarySignature(session.summary), {})
                )}
              {menuItem(<Pin size={14} strokeWidth={1.75} />, pinned ? t('code.sessions.unpin') : t('code.sessions.pin'), () =>
                togglePin(session.id)
              )}
              {menuItem(<Pencil size={14} strokeWidth={1.75} />, t('code.sessions.rename'), () => setEditing(true))}
              {menuItem(
                archived ? <ArchiveRestore size={14} strokeWidth={1.75} /> : <Archive size={14} strokeWidth={1.75} />,
                archived ? t('code.sessions.unarchive') : t('code.sessions.archive'),
                () => void (archived ? unarchiveSession(session.id) : archiveSession(session.id))
              )}
              {menuItem(<Trash2 size={14} strokeWidth={1.75} />, t('code.sessions.delete'), askDelete, true)}
            </div>
          )}
        </div>
      )}
    </div>
  )
  if (!mobile || editing) return row
  return (
    <SwipeRow
      actions={[
        { label: t('code.sessions.rename'), tone: 'accent', icon: <Pencil size={18} />, onClick: () => setEditing(true) },
        { label: t('code.sessions.delete'), tone: 'danger', icon: <Trash2 size={18} />, onClick: askDelete }
      ]}
    >
      {row}
    </SwipeRow>
  )
}

/** Paleta ⌘K: busca sesiones del proyecto actual por título (incluye archivadas). */
export function QuickSwitcher({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const t = useT()
  const directory = useCode((s) => s.directory)
  const { sessions, sessionProject } = useCode(useShallow((s) => ({ sessions: s.sessions, sessionProject: s.sessionProject })))
  const selectSession = useCode((s) => s.selectSession)
  const moreSessions = useCode((s) => (directory ? (s.moreSessionsByDir[directory] ?? false) : false))
  const [query, setQuery] = useState('')
  // La búsqueda cubre todas las sesiones del proyecto con foco: al buscar se cargan las que faltan (M12).
  const wantAll = open && moreSessions && query.trim().length > 0
  useEffect(() => {
    if (wantAll && directory) void useCode.getState().loadMoreSessions(true, directory)
  }, [wantAll, directory])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const list = useMemo(() => {
    if (!directory) return []
    const all = Object.values(sessions).filter((x) => sessionProject[x.id] === directory && !x.parentID)
    const q = query.trim().toLowerCase()
    const filtered = q ? all.filter((x) => (x.title || '').toLowerCase().includes(q)) : all
    return filtered.sort((a, b) => b.time.updated - a.time.updated).slice(0, 30)
  }, [directory, sessions, sessionProject, query])

  if (!open) return null

  // En el `body`: un diálogo dentro del árbol de la barra lateral rompe su estructura ARIA.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-fg/20 pt-[15vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('code.sessions.switch')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl desk:max-w-[600px] desk:rounded-modal desk:border-transparent desk:shadow-modal"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 desk:h-[52px] desk:gap-3 desk:border-border/60 desk:px-4 desk:py-0">
          <Search size={14} className="text-subtle desk:size-5 desk:text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && list[0]) {
                void selectSession(list[0].id)
                onClose()
              }
            }}
            placeholder={t('code.sessions.searchPlaceholder')}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle desk:text-[15px] desk:placeholder:text-muted"
          />
          <button type="button" onClick={onClose} aria-label={t('code.sessions.close')} className="text-subtle hover:text-fg">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto py-1 desk:px-2 desk:pt-1.5 desk:pb-2">
          {list.length === 0 && <div className="px-3 py-3 text-sm text-subtle">{t('code.sessions.noResults')}</div>}
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                void selectSession(s.id)
                onClose()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover desk:h-8 desk:rounded-ctl desk:px-2 desk:py-0"
            >
              {s.time.archived ? <Archive size={12} className="shrink-0 text-subtle" /> : null}
              <span className="min-w-0 flex-1 truncate">{displayTitle(s.title, t('code.sessions.untitled'))}</span>
              <span className="shrink-0 text-[11px] text-subtle">{timeAgo(s.time.updated)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Cierra `directory`: si tiene algo trabajando, confirma antes (el trabajo sigue en segundo plano, pero se pierden avisos y cola). */
export async function askCloseProject(t: ReturnType<typeof useT>, directory: string): Promise<void> {
  const live = selectProjectIsLive(useCode.getState(), directory)
  if (live) {
    const ok = await confirmDialog({
      title: t('code.sessions.closeProjectBusyTitle', { name: baseName(directory) }),
      message: t('code.sessions.closeProjectBusyMessage'),
      confirmLabel: t('code.sessions.closeProjectConfirm'),
      danger: true
    })
    if (!ok) return
  }
  useCode.getState().closeOneProject(directory)
}

/** Un proyecto abierto: fila plegable + sus sesiones debajo. Varias instancias conviven en `SessionList` (una por proyecto abierto). */
function ProjectGroup({
  directory,
  focused,
  waiting,
  tree,
  desktop,
  compact,
  onSearch
}: {
  directory: string
  focused: boolean
  waiting: Set<string>
  tree: ReturnType<typeof useSidebarTree>
  desktop: boolean
  compact: boolean
  onSearch: () => void
}): React.JSX.Element {
  const t = useT()
  const { sessions, sessionProject } = useCode(useShallow((s) => ({ sessions: s.sessions, sessionProject: s.sessionProject })))
  const activeSessionID = useCode((s) => s.activeSessionID)
  const runState = useCode((s) => s.runState)
  const unread = useCode((s) => s.unread)
  const reviewed = useCode((s) => s.reviewed)
  const reviewedSince = useCode((s) => s.reviewedSince)
  const pinnedMap = useCode((s) => s.pinned)
  const loading = useCode((s) => s.loadingSessionsByDir[directory] ?? false)
  const moreSessions = useCode((s) => s.moreSessionsByDir[directory] ?? false)
  const [showArchived, setShowArchived] = useState(false)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  // El plegado se recuerda por proyecto (un proyecto plegado sigue plegado al volver).
  const [projectOpen, setProjectOpenState] = useState(() => readOpen(directory))
  useEffect(() => setProjectOpenState(readOpen(directory)), [directory])
  const setProjectOpen = (f: (o: boolean) => boolean): void => {
    const next = f(projectOpen)
    setProjectOpenState(next)
    writeOpen(directory, next)
  }

  const pinnedIds = useMemo(() => new Set(pinnedMap[directory] ?? []), [pinnedMap, directory])
  const list = useMemo(() => selectProjectSessions({ sessions, sessionProject }, directory), [sessions, sessionProject, directory])
  const sortedList = useMemo(
    () => [...list].sort((a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)) || b.time.updated - a.time.updated),
    [list, pinnedIds]
  )
  // Migración del registro de revisión: las sesiones anteriores a él se fijan como revisadas al verlas por primera vez
  // (solo cambiarán a «por revisar» si el agente vuelve a editar archivos).
  useEffect(() => {
    const base = legacyBaseline(list, useCode.getState().reviewed, reviewedSince)
    if (Object.keys(base).length) useCode.getState().baselineReviewed(base)
  }, [list, reviewedSince])
  // Con pocas sesiones las etiquetas de día sobran; tampoco en el celular (lista a pantalla completa).
  const groupByDay = !isRemoteSurface() && sortedList.length > 3
  const archivedList = useMemo(
    () => Object.values(sessions).filter((x) => sessionProject[x.id] === directory && !x.parentID && x.time.archived),
    [sessions, sessionProject, directory]
  )

  // En un grupo sin foco, buscar o crear aquí le da el foco primero (si no, la interfaz mostraría un proyecto
  // mientras la sesión activa pertenece a otro).
  const focusThen = (fn: () => void): void => {
    if (focused) fn()
    else void useCode.getState().focusProject(directory).then(fn)
  }

  return (
    <div className="flex min-h-0 shrink-0 flex-col">
      {/* En el `body`: un diálogo dentro del árbol de la barra lateral rompe su estructura ARIA. */}
      {worktreeOpen && createPortal(<NewWorktreeDialog directory={directory} onClose={() => setWorktreeOpen(false)} />, document.body)}
      {desktop && (
        <div
          className="group/proj relative flex h-8 shrink-0 items-center rounded-ctl hover:bg-hover focus-within:bg-hover"
          role={tree ? 'treeitem' : undefined}
          aria-level={tree ? 1 : undefined}
          aria-expanded={tree ? projectOpen : undefined}
          aria-label={tree ? baseName(directory) : undefined}
        >
          <button
            type="button"
            aria-expanded={tree ? undefined : projectOpen}
            data-tree-primary={tree ? '' : undefined}
            aria-label={
              tree ? undefined : t(projectOpen ? 'app.sidebar.collapseProject' : 'app.sidebar.expandProject', { name: baseName(directory) })
            }
            title={directory}
            onClick={() => setProjectOpen((o) => !o)}
            className={`no-drag flex h-8 min-w-0 flex-1 items-center gap-2 rounded-ctl px-2.5 text-left text-sm font-medium ${focused ? 'text-fg' : 'text-muted'}`}
          >
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              className={`-ml-1 shrink-0 text-subtle transition-transform duration-[var(--dur-fast)] ${projectOpen ? '' : '-rotate-90'}`}
              aria-hidden="true"
            />
            <FolderOpen size={16} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="truncate">{baseName(directory)}</span>
          </button>
          <span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
            <button
              type="button"
              title={t('code.sessions.closeProject', { name: baseName(directory) })}
              aria-label={t('code.sessions.closeProject', { name: baseName(directory) })}
              onClick={() => void askCloseProject(t, directory)}
              className="no-drag hidden size-6 items-center justify-center rounded-ctl-sm text-muted group-focus-within/proj:flex group-hover/proj:flex hover:bg-active hover:text-fg"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title={t('code.sessions.newWorktree')}
              onClick={() => setWorktreeOpen(true)}
              className="no-drag hidden size-6 items-center justify-center rounded-ctl-sm text-muted group-focus-within/proj:flex group-hover/proj:flex hover:bg-active hover:text-fg"
            >
              <GitBranchPlus size={14} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title={t('code.sessions.searchTitle')}
              onClick={() => focusThen(onSearch)}
              className="no-drag hidden size-6 items-center justify-center rounded-ctl-sm text-muted group-focus-within/proj:flex group-hover/proj:flex hover:bg-active hover:text-fg"
            >
              <Search size={14} strokeWidth={1.75} />
            </button>
            {/* «+» siempre visible (descubrible): crea una sesión dentro del proyecto. */}
            <button
              type="button"
              title={t('code.sessions.newHere')}
              aria-label={t('code.sessions.newHere')}
              onClick={() => focusThen(() => void useCode.getState().newSessionAt(directory))}
              className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-fg"
            >
              <Plus size={14} strokeWidth={1.75} />
            </button>
          </span>
        </div>
      )}
      {!compact && !desktop && (
        <button
          type="button"
          onClick={() => void pickAndOpenFolder()}
          disabled={!platformCaps().nativeDialogs}
          title={directory}
          className="no-drag mx-2 mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hover disabled:pointer-events-none desk:mx-0 desk:mb-0 desk:h-8 desk:gap-2.5 desk:rounded-ctl desk:px-2.5 desk:py-0 desk:text-ui"
        >
          <FolderOpen size={15} className="shrink-0 text-accent desk:size-4" />
          <span className="truncate font-medium">{baseName(directory)}</span>
        </button>
      )}
      <div className={`group/sec mx-2 mb-2 flex items-center gap-1 desk:mx-0 desk:mt-3 desk:mb-1 ${desktop ? 'hidden' : ''}`}>
        <span className="flex-1 px-2 text-[11.5px] font-medium text-subtle desk:px-2.5 desk:text-meta">{t('code.sessions.title')}</span>
        <button
          type="button"
          title={t('code.sessions.newWorktree')}
          onClick={() => setWorktreeOpen(true)}
          className={`no-drag flex shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg ${isRemoteSurface() ? 'h-11 w-11' : 'h-7 w-7'} desk:opacity-0 desk:group-focus-within/sec:opacity-100 desk:group-hover/sec:opacity-100`}
        >
          <GitBranchPlus size={13} />
        </button>
        <button
          type="button"
          title={t('code.sessions.searchTitle')}
          onClick={onSearch}
          className={`no-drag flex shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg ${isRemoteSurface() ? 'h-11 w-11' : 'h-7 w-7'} desk:opacity-0 desk:group-focus-within/sec:opacity-100 desk:group-hover/sec:opacity-100`}
        >
          <Search size={13} />
        </button>
      </div>
      <div
        role={tree ? 'group' : undefined}
        className={`min-h-0 overflow-y-auto px-2 desk:flex desk:flex-col desk:gap-0.5 desk:px-0 ${desktop && !projectOpen ? 'hidden' : ''}`}
      >
        {loading && list.length === 0 && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-subtle desk:px-2.5">
            <Loader2 size={12} className="animate-spin" /> {t('code.sessions.loading')}
          </div>
        )}
        {!loading && list.length === 0 && !isRemoteSurface() && (
          <SidebarEmpty icon={<Terminal size={18} strokeWidth={1.75} />} text={t('code.sessions.empty')} hint />
        )}
        {!loading && list.length === 0 && isRemoteSurface() && (
          <div className="px-2 py-1 text-xs text-subtle desk:px-2.5 desk:py-2 desk:text-meta">{t('code.sessions.empty')}</div>
        )}
        {sortedList.map((s, i) => {
          const st = runState[s.id]
          // Etiquetas «Hoy / Ayer / Esta semana / Antes» (solo en escritorio, con lista larga y fuera de las fijadas).
          const bucket = dayBucket(s.time.updated)
          const prev = sortedList[i - 1]
          const showLabel =
            groupByDay && !pinnedIds.has(s.id) && (!prev || pinnedIds.has(prev.id) || dayBucket(prev.time.updated) !== bucket)
          return (
            <Fragment key={s.id}>
              {showLabel && (
                <div role="presentation" className="px-2.5 pt-2 pb-0.5 text-[10.5px] font-medium tracking-wide text-subtle uppercase">
                  {t(`code.sessions.day.${bucket}` as MsgKey)}
                </div>
              )}
              <SessionRow
                session={s}
                directory={directory}
                active={s.id === activeSessionID}
                waiting={waiting.has(s.id)}
                busy={st === 'busy' || st === 'retry'}
                unread={!!unread[s.id]}
                needsReview={sessionNeedsReview(s.summary, reviewed[s.id], { updated: s.time.updated, since: reviewedSince })}
                pinned={pinnedIds.has(s.id)}
              />
            </Fragment>
          )
        })}
        <LoadMoreSessions visible={moreSessions} onClick={() => void useCode.getState().loadMoreSessions(false, directory)} />
        {archivedList.length > 0 && (
          <div className="mt-2 border-t border-border pt-2 desk:border-t-0 desk:pt-0">
            <button
              type="button"
              onClick={() => setShowArchived((o) => !o)}
              className={`no-drag flex w-full items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-medium text-subtle hover:text-fg ${isRemoteSurface() ? 'min-h-11' : 'py-1'}`}
            >
              <ChevronDown size={11} className={`transition-transform ${showArchived ? 'rotate-180' : ''}`} />
              {t('code.sessions.archived', { count: archivedList.length })}
            </button>
            {showArchived &&
              archivedList
                .sort((a, b) => b.time.updated - a.time.updated)
                .map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    directory={directory}
                    active={s.id === activeSessionID}
                    waiting={false}
                    busy={false}
                    unread={false}
                    needsReview={false}
                    pinned={false}
                  />
                ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Lista de sesiones de los proyectos abiertos (uno en el celular; varios en escritorio, cada uno con su propio
 * grupo plegable). Pensada tanto para la columna interna de `CodeWorkspace` como para `SidebarContent` del modo
 * en la barra lateral global.
 */
export function SessionList({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const t = useT()
  const directory = useCode((s) => s.directory)
  const openDirectories = useCode((s) => s.openDirectories)
  const sessions = useCode((s) => s.sessions)
  const permissions = useCode((s) => s.permissions)
  const questions = useCode((s) => s.questions)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const tree = useSidebarTree()
  const desktop = !isRemoteSurface()

  // ⌘K (configurable en Ajustes › Atajos): buscador de sesiones del proyecto con foco, mientras la lista esté montada y la paleta cerrada.
  useEffect(
    () =>
      registerAction('code.sessionSwitcher', {
        enabled: () => !useUi.getState().paletteOpen,
        run: () => setSwitcherOpen((o) => !o)
      }),
    []
  )

  const waiting = useMemo(
    // Un permiso O una pregunta pendiente bloquean a la sesión (y a la raíz de sus subagentes).
    () =>
      new Set([
        ...Object.values(permissions).map((p) => rootSessionID(sessions, p.sessionID)),
        ...Object.values(questions).map((q) => rootSessionID(sessions, q.sessionID))
      ]),
    [permissions, questions, sessions]
  )

  if (!directory) {
    // Escritorio: sin proyecto abierto el encabezado «Proyectos» de la barra lateral lleva el «+»; aquí va la pista.
    return desktop ? <SidebarEmpty text={t('app.sidebar.noProjects')} hint /> : null
  }

  // Celular: un solo proyecto, como siempre (openDirectories tiene como mucho uno). Escritorio: un grupo por abierto.
  const groups = desktop ? openDirectories : [directory]

  return (
    <div className="flex min-h-0 flex-col gap-0.5">
      <QuickSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <SidebarTreeRegion>
        {groups.map((dir) => (
          <ProjectGroup
            key={dir}
            directory={dir}
            focused={dir === directory}
            waiting={waiting}
            tree={tree}
            desktop={desktop}
            compact={compact}
            onSearch={() => setSwitcherOpen(true)}
          />
        ))}
      </SidebarTreeRegion>
    </div>
  )
}
