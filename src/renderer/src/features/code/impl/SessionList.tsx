import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Circle,
  FolderOpen,
  GitBranchPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  Search,
  ShieldAlert,
  SquarePen,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../lib/i18n'
import { baseName, NewWorktreeDialog, pickAndOpenFolder } from './ProjectPicker'
import { rootSessionID, selectProjectSessions, useCode } from './store'
import { timeAgo } from './ui'
import { registerAction } from '../../../keybindings/registry'
import { useUi } from '../../../stores/ui'
import { LoadMoreSessions } from '../../../components/LoadMoreSessions'
import { isSubmitKey } from '../../../lib/textarea'
import { isRemoteSurface, platformCaps } from '../../../lib/platform'
import { SidebarEmpty } from '../../../components/SidebarEmpty'
import { Sheet } from '../../../components/mobile/Sheet'
import { SheetAction } from './SheetAction'
import { SwipeRow, useLongPress } from '../../../components/mobile/SwipeRow'

/** Fila de sesión con menú contextual (renombrar / fijar / archivar / eliminar). */
function SessionRow({
  session,
  active,
  waiting,
  busy,
  unread,
  pinned
}: {
  session: { id: string; title: string; time: { updated: number }; summary?: { additions: number; deletions: number; files: number } }
  active: boolean
  waiting: boolean
  busy: boolean
  unread: boolean
  pinned: boolean
}): React.JSX.Element {
  const t = useT()
  const selectSession = useCode((s) => s.selectSession)
  const deleteSession = useCode((s) => s.deleteSession)
  const renameSession = useCode((s) => s.renameSession)
  const togglePin = useCode((s) => s.togglePin)
  const archiveSession = useCode((s) => s.archiveSession)
  const unarchiveSession = useCode((s) => s.unarchiveSession)
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

  const row = (
    <div
      className={`group flex items-center gap-1 rounded-lg desk:relative desk:h-8 desk:gap-0.5 desk:rounded-ctl ${mobile ? 'min-h-14' : ''} ${active ? 'bg-active desk:bg-hover' : 'hover:bg-hover'}`}
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
          onClick={() => void selectSession(session.id)}
          onDoubleClick={() => setEditing(true)}
          className={`no-drag flex min-w-0 flex-1 flex-col items-start px-2 text-left desk:h-full desk:flex-row desk:items-center desk:gap-2 desk:px-2.5 desk:pl-[30px] desk:py-0 ${mobile ? 'min-h-14 justify-center px-3' : 'py-1.5'}`}
          {...(mobile ? press : {})}
        >
          <span
            className={`flex w-full items-center gap-1.5 desk:w-auto desk:min-w-0 desk:flex-1 desk:text-ui ${mobile ? 'text-[15px]' : 'text-[13px]'} ${active ? ' desk:font-medium desk:text-fg' : ' desk:text-muted'}`}
          >
            {pinned && <Pin size={10} className="shrink-0 text-subtle" />}
            {waiting ? (
              <ShieldAlert size={12} className="shrink-0 text-accent desk:hidden" />
            ) : busy ? (
              <Loader2 size={12} className="shrink-0 animate-spin text-muted desk:hidden" />
            ) : unread ? (
              <Circle size={7} fill="currentColor" className="shrink-0 text-accent" />
            ) : null}
            <span className={`truncate ${unread ? 'font-semibold text-fg' : ''}`}>{session.title || t('code.sessions.untitled')}</span>
          </span>
          {!mobile && waiting ? (
            <span className="hidden h-5 shrink-0 items-center rounded-full border border-warning/45 bg-warning/10 px-2 text-meta font-medium text-warning desk:inline-flex desk:group-hover:hidden">
              {t('tasks.list.metaApprove')}
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
              className={`text-subtle desk:shrink-0 desk:text-meta desk:tabular-nums desk:group-hover:hidden ${mobile ? 'text-xs' : 'text-[11px]'}`}
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
            aria-label={t('code.m.itemActions', { name: session.title || t('code.sessions.untitled') })}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted active:bg-hover"
          >
            <MoreHorizontal size={19} />
          </button>
          <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={session.title || t('code.sessions.untitled')} size="half">
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
        <span className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            type="button"
            title={t('code.sessions.rename')}
            onClick={() => setEditing(true)}
            className="no-drag flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-bg hover:text-fg"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            title={pinned ? t('code.sessions.unpin') : t('code.sessions.pin')}
            onClick={() => togglePin(session.id)}
            className={`no-drag flex h-6 w-6 items-center justify-center rounded-md hover:bg-bg hover:text-fg ${pinned ? 'text-accent' : 'text-subtle'}`}
          >
            <Pin size={12} />
          </button>
          <button
            type="button"
            title={archived ? t('code.sessions.unarchive') : t('code.sessions.archive')}
            onClick={() => void (archived ? unarchiveSession(session.id) : archiveSession(session.id))}
            className="no-drag flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-bg hover:text-fg"
          >
            {archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
          </button>
          <button
            type="button"
            title={t('code.sessions.delete')}
            onClick={() => {
              void confirmDialog({
                title: t('code.sessions.deleteTitle'),
                message: t('code.sessions.deleteMessage', { title: session.title || t('code.sessions.untitledLower') }),
                confirmLabel: t('code.sessions.deleteConfirm'),
                danger: true
              }).then((ok) => {
                if (ok) void deleteSession(session.id)
              })
            }}
            className="no-drag flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-bg hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        </span>
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
  const moreSessions = useCode((s) => s.moreSessions)
  const [query, setQuery] = useState('')
  // La búsqueda cubre todas las sesiones del proyecto: al buscar se cargan las que faltan (M12).
  const wantAll = open && moreSessions && query.trim().length > 0
  useEffect(() => {
    if (wantAll) void useCode.getState().loadMoreSessions(true)
  }, [wantAll])
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

  return (
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
              <span className="min-w-0 flex-1 truncate">{s.title || t('code.sessions.untitled')}</span>
              <span className="shrink-0 text-[11px] text-subtle">{timeAgo(s.time.updated)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Lista de sesiones del proyecto actual. Pensada tanto para la columna interna de
 * `CodeWorkspace` como para `SidebarContent` del modo en la barra lateral global.
 */
export function SessionList({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const t = useT()
  const directory = useCode((s) => s.directory)
  const { sessions, sessionProject } = useCode(useShallow((s) => ({ sessions: s.sessions, sessionProject: s.sessionProject })))
  const activeSessionID = useCode((s) => s.activeSessionID)
  const runState = useCode((s) => s.runState)
  const permissions = useCode((s) => s.permissions)
  const unread = useCode((s) => s.unread)
  const pinnedMap = useCode((s) => s.pinned)
  const loading = useCode((s) => s.loadingSessions)
  const moreSessions = useCode((s) => s.moreSessions)
  const [showArchived, setShowArchived] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(true)
  const desktop = !isRemoteSurface()

  // ⌘K (configurable en Ajustes › Atajos): buscador de sesiones, mientras la lista esté montada y la paleta cerrada.
  useEffect(
    () =>
      registerAction('code.sessionSwitcher', {
        enabled: () => !useUi.getState().paletteOpen,
        run: () => setSwitcherOpen((o) => !o)
      }),
    []
  )

  const pinnedIds = useMemo(() => new Set(directory ? (pinnedMap[directory] ?? []) : []), [pinnedMap, directory])

  const list = useMemo(
    () => (directory ? selectProjectSessions({ sessions, sessionProject }, directory) : []),
    [sessions, sessionProject, directory]
  )
  const sortedList = useMemo(
    () => [...list].sort((a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)) || b.time.updated - a.time.updated),
    [list, pinnedIds]
  )
  const archivedList = useMemo(
    () => (directory ? Object.values(sessions).filter((x) => sessionProject[x.id] === directory && !x.parentID && x.time.archived) : []),
    [sessions, sessionProject, directory]
  )
  const waiting = useMemo(
    () => new Set(Object.values(permissions).map((p) => rootSessionID(sessions, p.sessionID))),
    [permissions, sessions]
  )

  if (!directory) {
    // Escritorio: sin proyecto abierto el encabezado «Proyectos» de la barra lateral lleva el «+»; aquí va la pista.
    return desktop ? <SidebarEmpty text={t('app.sidebar.noProjects')} hint /> : null
  }

  return (
    <div className="flex min-h-0 flex-col">
      <QuickSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      {worktreeOpen && <NewWorktreeDialog directory={directory} onClose={() => setWorktreeOpen(false)} />}
      {desktop && (
        <div className="group/proj relative flex h-8 shrink-0 items-center rounded-ctl hover:bg-hover focus-within:bg-hover">
          <button
            type="button"
            aria-expanded={projectOpen}
            aria-label={t(projectOpen ? 'app.sidebar.collapseProject' : 'app.sidebar.expandProject', { name: baseName(directory) })}
            title={directory}
            onClick={() => setProjectOpen((o) => !o)}
            className="no-drag flex h-8 min-w-0 flex-1 items-center gap-2 rounded-ctl px-2 text-left text-sm font-medium text-fg"
          >
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              className={`shrink-0 text-subtle transition-transform duration-[var(--dur-fast)] ${projectOpen ? '' : '-rotate-90'}`}
              aria-hidden="true"
            />
            <FolderOpen size={16} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="truncate">{baseName(directory)}</span>
          </button>
          <span className="absolute top-1/2 right-1 hidden -translate-y-1/2 items-center gap-0.5 group-focus-within/proj:flex group-hover/proj:flex">
            <button
              type="button"
              title={t('code.sessions.newWorktree')}
              onClick={() => setWorktreeOpen(true)}
              className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-fg"
            >
              <GitBranchPlus size={14} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title={t('code.sessions.searchTitle')}
              onClick={() => setSwitcherOpen(true)}
              className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-fg"
            >
              <Search size={14} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title={t('code.sessions.newHere')}
              onClick={() => void useCode.getState().newSession()}
              className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-fg"
            >
              <SquarePen size={14} strokeWidth={1.75} />
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
          onClick={() => setSwitcherOpen(true)}
          className={`no-drag flex shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg ${isRemoteSurface() ? 'h-11 w-11' : 'h-7 w-7'} desk:opacity-0 desk:group-focus-within/sec:opacity-100 desk:group-hover/sec:opacity-100`}
        >
          <Search size={13} />
        </button>
      </div>
      <div
        className={`min-h-0 flex-1 overflow-y-auto px-2 desk:flex desk:flex-col desk:gap-0.5 desk:px-0 ${desktop && !projectOpen ? 'hidden' : ''}`}
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
        {sortedList.map((s) => {
          const st = runState[s.id]
          return (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeSessionID}
              waiting={waiting.has(s.id)}
              busy={st === 'busy' || st === 'retry'}
              unread={!!unread[s.id]}
              pinned={pinnedIds.has(s.id)}
            />
          )
        })}
        <LoadMoreSessions visible={moreSessions} onClick={() => void useCode.getState().loadMoreSessions()} />
        {archivedList.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
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
                    active={s.id === activeSessionID}
                    waiting={false}
                    busy={false}
                    unread={false}
                    pinned={false}
                  />
                ))}
          </div>
        )}
      </div>
    </div>
  )
}
