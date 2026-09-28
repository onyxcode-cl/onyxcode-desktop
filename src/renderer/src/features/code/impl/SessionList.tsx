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
  MessageSquarePlus,
  Pencil,
  Pin,
  Search,
  ShieldAlert,
  Trash2,
  X
} from 'lucide-react'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { baseName, NewWorktreeDialog, pickAndOpenFolder } from './ProjectPicker'
import { rootSessionID, selectProjectSessions, useCode } from './store'
import { timeAgo } from './ui'

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
  const selectSession = useCode((s) => s.selectSession)
  const deleteSession = useCode((s) => s.deleteSession)
  const renameSession = useCode((s) => s.renameSession)
  const togglePin = useCode((s) => s.togglePin)
  const archiveSession = useCode((s) => s.archiveSession)
  const unarchiveSession = useCode((s) => s.unarchiveSession)
  const archived = !!(session as { time?: { archived?: number } }).time && !!(session as { time?: { archived?: number } }).time?.archived
  const [editing, setEditing] = useState(false)
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

  return (
    <div className={`group flex items-center gap-1 rounded-lg ${active ? 'bg-active' : 'hover:bg-hover'}`}>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          className="no-drag mx-2 my-1 min-w-0 flex-1 rounded-md border border-accent bg-bg px-1.5 py-1 text-[13px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => void selectSession(session.id)}
          onDoubleClick={() => setEditing(true)}
          className="no-drag flex min-w-0 flex-1 flex-col items-start px-2 py-1.5 text-left"
        >
          <span className="flex w-full items-center gap-1.5 text-[13px]">
            {pinned && <Pin size={10} className="shrink-0 text-subtle" />}
            {waiting ? (
              <ShieldAlert size={12} className="shrink-0 text-accent" />
            ) : busy ? (
              <Loader2 size={12} className="shrink-0 animate-spin text-muted" />
            ) : unread ? (
              <Circle size={7} fill="currentColor" className="shrink-0 text-accent" />
            ) : null}
            <span className={`truncate ${unread ? 'font-semibold text-fg' : ''}`}>{session.title || 'Sesión sin título'}</span>
          </span>
          <span className="text-[11px] text-subtle">
            {timeAgo(session.time.updated)}
            {session.summary && session.summary.files > 0 && (
              <>
                {' · '}
                <span className="text-success">+{session.summary.additions}</span> <span className="text-danger">-{session.summary.deletions}</span>
              </>
            )}
          </span>
        </button>
      )}
      {!editing && (
        <span className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button type="button" title="Renombrar" onClick={() => setEditing(true)} className="no-drag flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-bg hover:text-fg">
            <Pencil size={12} />
          </button>
          <button
            type="button"
            title={pinned ? 'Quitar de fijadas' : 'Fijar sesión'}
            onClick={() => togglePin(session.id)}
            className={`no-drag flex h-6 w-6 items-center justify-center rounded-md hover:bg-bg hover:text-fg ${pinned ? 'text-accent' : 'text-subtle'}`}
          >
            <Pin size={12} />
          </button>
          <button
            type="button"
            title={archived ? 'Desarchivar' : 'Archivar'}
            onClick={() => void (archived ? unarchiveSession(session.id) : archiveSession(session.id))}
            className="no-drag flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-bg hover:text-fg"
          >
            {archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
          </button>
          <button
            type="button"
            title="Eliminar sesión"
            onClick={() => {
              void confirmDialog({
                title: '¿Eliminar sesión?',
                message: `Se eliminará la sesión "${session.title || 'sin título'}".`,
                confirmLabel: 'Eliminar',
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
}

/** Paleta ⌘K: busca sesiones del proyecto actual por título (incluye archivadas). */
export function QuickSwitcher({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const directory = useCode((s) => s.directory)
  const { sessions, sessionProject } = useCode(useShallow((s) => ({ sessions: s.sessions, sessionProject: s.sessionProject })))
  const selectSession = useCode((s) => s.selectSession)
  const [query, setQuery] = useState('')
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
        aria-label="Cambiar de sesión"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={14} className="text-subtle" />
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
            placeholder="Buscar sesión por título…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <button type="button" onClick={onClose} className="text-subtle hover:text-fg">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {list.length === 0 && <div className="px-3 py-3 text-sm text-subtle">Sin resultados.</div>}
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                void selectSession(s.id)
                onClose()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover"
            >
              {s.time.archived ? <Archive size={12} className="shrink-0 text-subtle" /> : null}
              <span className="min-w-0 flex-1 truncate">{s.title || 'Sesión sin título'}</span>
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
  const directory = useCode((s) => s.directory)
  const { sessions, sessionProject } = useCode(useShallow((s) => ({ sessions: s.sessions, sessionProject: s.sessionProject })))
  const activeSessionID = useCode((s) => s.activeSessionID)
  const runState = useCode((s) => s.runState)
  const permissions = useCode((s) => s.permissions)
  const unread = useCode((s) => s.unread)
  const pinnedMap = useCode((s) => s.pinned)
  const loading = useCode((s) => s.loadingSessions)
  const newSession = useCode((s) => s.newSession)
  const [showArchived, setShowArchived] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [worktreeOpen, setWorktreeOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSwitcherOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  if (!directory) return null

  return (
    <div className="flex min-h-0 flex-col">
      <QuickSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      {worktreeOpen && <NewWorktreeDialog directory={directory} onClose={() => setWorktreeOpen(false)} />}
      {!compact && (
        <button
          type="button"
          onClick={() => void pickAndOpenFolder()}
          title={directory}
          className="no-drag mx-2 mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hover"
        >
          <FolderOpen size={15} className="shrink-0 text-accent" />
          <span className="truncate font-medium">{baseName(directory)}</span>
        </button>
      )}
      <div className="mx-2 mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => void newSession()}
          className="no-drag flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg"
        >
          <MessageSquarePlus size={15} /> Nueva sesión
        </button>
        <button
          type="button"
          title="Nueva sesión en worktree nuevo"
          onClick={() => setWorktreeOpen(true)}
          className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
        >
          <GitBranchPlus size={13} />
        </button>
        <button
          type="button"
          title="Buscar sesiones (⌘K)"
          onClick={() => setSwitcherOpen(true)}
          className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
        >
          <Search size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {loading && list.length === 0 && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-subtle">
            <Loader2 size={12} className="animate-spin" /> Cargando sesiones…
          </div>
        )}
        {!loading && list.length === 0 && <div className="px-2 py-1 text-xs text-subtle">Sin sesiones todavía.</div>}
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
        {archivedList.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setShowArchived((o) => !o)}
              className="no-drag flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium tracking-wide text-subtle uppercase hover:text-fg"
            >
              <ChevronDown size={11} className={`transition-transform ${showArchived ? 'rotate-180' : ''}`} />
              Archivadas ({archivedList.length})
            </button>
            {showArchived &&
              archivedList
                .sort((a, b) => b.time.updated - a.time.updated)
                .map((s) => (
                  <SessionRow key={s.id} session={s} active={s.id === activeSessionID} waiting={false} busy={false} unread={false} pinned={false} />
                ))}
          </div>
        )}
      </div>
    </div>
  )
}
