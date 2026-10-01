/**
 * Lista de tareas de la carpeta: estado (icono), tiempo relativo, agrupación por fecha o por grupo, búsqueda
 * (títulos y contenido de las conversaciones), fijar / renombrar / mover a grupo / archivar / eliminar y la
 * vista de archivadas con "Restaurar".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { dateLocale, useT } from '../../../lib/i18n'
import type { Session } from '@opencode-ai/sdk/v2/client'
import {
  Archive,
  ArchiveRestore,
  FolderTree,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Search,
  ShieldOff,
  Trash2,
  X
} from 'lucide-react'
import { confirmDialog, promptDialog } from '../../../components/ConfirmDialog'
import { MAIN_SOURCE, useSessions } from '../../../stores/sessions'
import { selectSessionsForDirectory } from '../../../lib/session-reducer'
import { archiveTask, deleteTask, moveTaskToGroup, openTask, renameTask, restoreTask } from './actions'
import { MIN_QUERY_LENGTH, useTranscriptSearch, type TranscriptHit } from './search'
import { requestScrollToPart } from './scroll'
import {
  archivedSessionsForDirectory,
  filterByTitle,
  groupByDate,
  groupByGroup,
  StatusIcon,
  statusTextClass,
  type TaskGroup
} from './SidebarSections'
import { isPinned, isPlanPending, isUsingComputer, markUnread, togglePinned, useTasks } from './store'
import {
  evictedStatusOf,
  isArchivedSession,
  permissionBelongsTo,
  relTime,
  rememberEvictedStatus,
  sessionBelongsTo,
  taskStatus,
  TASK_STATUS_LABEL,
  type TaskStatus
} from './util'

// `StatusIcon` vive en SidebarSections (evita un ciclo de imports); se reexporta para quien lo importaba de aquí.
export { StatusIcon }

type GroupMode = 'date' | 'group'
// F7-B35: al desalojar el historial de una tarea (LRU) se conserva su estado terminal (error) para la lista.
useSessions.getState().addEvictionListener((evicted) => {
  for (const { id, entries } of evicted) rememberEvictedStatus(id, entries)
})

const GROUP_MODE_KEY = 'tasks.sidebarGroupMode'

function readGroupMode(): GroupMode {
  try {
    return localStorage.getItem(GROUP_MODE_KEY) === 'group' ? 'group' : 'date'
  } catch {
    return 'date'
  }
}

/** Botón "…" y menú de una tarea (fijar, renombrar, mover a grupo, no leída, archivar/restaurar, eliminar). */
function TaskMenu({
  id,
  title,
  archived,
  group,
  knownGroups
}: {
  id: string
  title: string
  archived?: boolean
  group?: string | null
  knownGroups: string[]
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pinned = useTasks((s) => !!s.pinned[id])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    // Foco al primer elemento del menú para poder usarlo con el teclado.
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger?: boolean): React.JSX.Element => (
    <button
      type="button"
      role="menuitem"
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:bg-hover ${danger ? 'text-danger' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setOpen(false)
        onClick()
      }}
    >
      {icon}
      {label}
    </button>
  )

  const moveToGroup = (): void => {
    void promptDialog({
      title: t('tasks.list.moveTitle'),
      message: knownGroups.length > 0 ? t('tasks.list.moveExisting', { groups: knownGroups.join(', ') }) : t('tasks.list.moveNew'),
      defaultValue: group ?? '',
      placeholder: t('tasks.list.groupName'),
      confirmLabel: t('tasks.list.move')
    }).then((next) => {
      if (next !== null) void moveTaskToGroup(id, next.trim() || null).catch(() => undefined)
    })
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        title={t('tasks.list.moreActions')}
        aria-label={t('tasks.list.moreActionsFor', { title: title || t('tasks.list.untitledLower') })}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`rounded p-0.5 text-subtle group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('tasks.list.menuAria')}
          className="absolute top-full right-0 z-30 mt-1 w-52 rounded-xl border border-border bg-elevated p-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onMenuKey}
        >
          {!archived &&
            item(pinned ? <PinOff size={13} /> : <Pin size={13} />, pinned ? t('tasks.list.unpin') : t('tasks.list.pin'), () =>
              togglePinned(id)
            )}
          {!archived &&
            item(<Pencil size={13} />, t('tasks.list.renameItem'), () => {
              void promptDialog({ title: t('tasks.list.renameTitle'), defaultValue: title, confirmLabel: t('tasks.list.rename') }).then(
                (next) => {
                  if (next && next.trim()) void renameTask(id, next).catch(() => undefined)
                }
              )
            })}
          {!archived && item(<FolderTree size={13} />, t('tasks.list.moveItem'), moveToGroup)}
          {!archived &&
            group &&
            item(<X size={13} />, t('tasks.list.removeFromGroup'), () => void moveTaskToGroup(id, null).catch(() => undefined))}
          {!archived && item(<Mail size={13} />, t('tasks.list.markUnread'), () => markUnread(id))}
          {!archived && item(<Archive size={13} />, t('tasks.list.archive'), () => void archiveTask(id).catch(() => undefined))}
          {archived && item(<ArchiveRestore size={13} />, t('tasks.list.restore'), () => void restoreTask(id).catch(() => undefined))}
          {item(
            <Trash2 size={13} />,
            t('tasks.list.deleteItem'),
            () => {
              void confirmDialog({
                title: t('tasks.list.deleteTitle'),
                message: t('tasks.list.deleteMsg', { title: title || t('tasks.list.untitledLower') }),
                confirmLabel: t('tasks.list.delete'),
                danger: true
              }).then((ok) => {
                if (ok) void deleteTask(id).catch(() => undefined)
              })
            },
            true
          )}
        </div>
      )}
    </div>
  )
}

/** Una tarea de la lista de la carpeta. */
function TaskRow({
  task,
  status,
  active,
  unseen,
  blockedHost,
  archivedView,
  group,
  knownGroups
}: {
  task: Session
  status: TaskStatus
  active: boolean
  unseen: boolean
  blockedHost: boolean
  archivedView: boolean
  group: string | null | undefined
  knownGroups: string[]
}): React.JSX.Element {
  const t = useT()
  const busy = status === 'running' || status === 'using_computer' || status === 'waiting' || status === 'question'
  const pinned = isPinned(task.id)
  return (
    <div className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? 'bg-active' : 'hover:bg-hover'}`}>
      <span className="shrink-0">
        <StatusIcon status={status} size={13} />
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        aria-current={active ? 'true' : undefined}
        onClick={() => void openTask(task.id)}
      >
        <div className={`truncate ${unseen ? 'font-semibold' : ''}`}>
          {pinned && <Pin size={10} className="mr-1 inline-block -translate-y-px text-subtle" />}
          {task.title || t('tasks.list.untitled')}
        </div>
        <div className={`truncate text-[11px] ${statusTextClass(status)}`}>
          {status === 'archived'
            ? t('tasks.list.archivedAgo', { when: relTime(task.time.archived ?? task.time.updated) })
            : status === 'running' ||
                status === 'using_computer' ||
                status === 'waiting' ||
                status === 'question' ||
                status === 'plan_ready'
              ? TASK_STATUS_LABEL[status]
              : relTime(task.time.updated)}
          {group && !archivedView && <span className="text-subtle"> · {group}</span>}
        </div>
      </button>
      {blockedHost && (
        <span className="shrink-0 text-warning" title={t('tasks.list.blocked')}>
          <ShieldOff size={12} />
        </span>
      )}
      {unseen && <span className="h-2 w-2 shrink-0 rounded-full bg-accent group-hover:hidden" />}
      {archivedView && (
        <button
          type="button"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] text-accent hover:bg-hover"
          onClick={() => void restoreTask(task.id).catch(() => undefined)}
        >
          {t('tasks.list.restore')}
        </button>
      )}
      {!busy && <TaskMenu id={task.id} title={task.title || ''} archived={archivedView} group={group} knownGroups={knownGroups} />}
    </div>
  )
}

/** Coincidencias dentro de las conversaciones (con fragmento). */
function TranscriptResults({
  hits,
  loading,
  scanned,
  total
}: {
  hits: TranscriptHit[]
  loading: boolean
  scanned: number
  total: number
}): React.JSX.Element {
  const t = useT()
  const open = (h: TranscriptHit): void => {
    void openTask(h.sessionId).then(() => {
      // Deja que la conversación se pinte antes de pedir el scroll.
      requestAnimationFrame(() => requestScrollToPart(h.partId))
    })
  }
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 px-1 pt-2.5 pb-1 text-[11.5px] font-medium text-subtle">
        {t('tasks.list.inChats')}
        {loading && (
          <span className="flex items-center gap-1 font-normal">
            <Loader2 size={10} className="animate-spin" /> {scanned}/{total}
          </span>
        )}
      </div>
      {hits.length === 0 && !loading && <p className="px-1 py-1 text-xs text-subtle">{t('tasks.list.noContentMatch')}</p>}
      <ul className="space-y-0.5">
        {hits.map((h) => (
          <li key={`${h.sessionId}:${h.partId}`}>
            <button type="button" className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-hover" onClick={() => open(h)}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{h.title || t('tasks.list.untitled')}</span>
                <span className="shrink-0 text-[10.5px] text-subtle">{relTime(h.at)}</span>
              </div>
              <div className="line-clamp-2 text-[11.5px] leading-snug text-muted">{h.snippet}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TaskList(): React.JSX.Element {
  const tr = useT()
  const folder = useTasks((s) => s.folder)
  const activeId = useTasks((s) => s.activeTaskId)
  const loading = useTasks((s) => s.listLoading)
  const permissions = useTasks((s) => s.permissions)
  const questions = useTasks((s) => s.questions)
  const unseen = useTasks((s) => s.unseen)
  const networkBlocked = useTasks((s) => s.networkBlocked)
  const taskMeta = useTasks((s) => s.taskMeta)
  const showArchived = useTasks((s) => s.showArchived)
  // Solo para repintar el estado "usando el Mac" / "plan listo".
  useTasks((s) => s.lastAction)
  useTasks((s) => s.accessRequest)
  const sessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const status = useSessions((s) => s.status)
  const errors = useSessions((s) => s.errors)
  const messages = useSessions((s) => s.messages)
  const [query, setQuery] = useState('')
  const [groupMode, setGroupMode] = useState<GroupMode>(readGroupMode)
  const [, tick] = useState(0)

  // Refresca los "hace X min".
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const changeGroupMode = (m: GroupMode): void => {
    setGroupMode(m)
    try {
      localStorage.setItem(GROUP_MODE_KEY, m)
    } catch {
      // sin storage
    }
  }

  // Tareas de la carpeta: activas y archivadas (el selector del store oculta las archivadas).
  const liveTasks = useMemo(
    () => (folder ? selectSessionsForDirectory({ sessions, sessionSource, directorySource }, folder) : []),
    [sessions, sessionSource, directorySource, folder]
  )
  const archivedTasks = useMemo(() => {
    if (!folder) return []
    const viewSource = directorySource[folder] ?? MAIN_SOURCE
    return archivedSessionsForDirectory(sessions, folder, viewSource, (id) => sessionSource[id] ?? MAIN_SOURCE)
  }, [sessions, sessionSource, directorySource, folder])

  const source = showArchived ? archivedTasks : liveTasks
  const q = query.trim()
  const tasks = useMemo(() => filterByTitle(source, q), [source, q])
  const transcript = useTranscriptSearch(showArchived ? null : folder, q)

  // Grupos que ya existen en esta carpeta (para sugerirlos al mover una tarea).
  const knownGroups = useMemo(() => {
    const set = new Set<string>()
    for (const t of liveTasks) {
      const g = taskMeta[t.id]?.group?.trim()
      if (g) set.add(g)
    }
    return [...set].sort((a, b) => a.localeCompare(b, dateLocale(), { sensitivity: 'base' }))
  }, [liveTasks, taskMeta])

  const perms = Object.values(permissions)
  const qs = Object.values(questions)

  const statusOf = (t: Session): TaskStatus =>
    taskStatus({
      run: status[t.id],
      waiting: perms.some((p) => permissionBelongsTo(p, t.id, sessions)),
      hasQuestion: qs.some((x) => sessionBelongsTo(x.sessionID, t.id, sessions)),
      error: errors[t.id],
      entries: messages[t.id],
      evicted: evictedStatusOf(t.id),
      usingComputer: isUsingComputer(t.id),
      planPending: isPlanPending(t.id),
      archived: isArchivedSession(t)
    })

  const searching = q.length > 0
  const groups: Array<TaskGroup<Session>> = searching
    ? tasks.length > 0
      ? [{ key: 'search', label: tr('tasks.list.titleMatches'), items: tasks }]
      : []
    : showArchived
      ? groupByDate(tasks, (t) => t.time.archived ?? t.time.updated)
      : groupMode === 'group'
        ? groupByGroup(tasks, (t) => taskMeta[t.id]?.group)
        : groupByDate(tasks, (t) => t.time.updated)

  const emptyText = ((): string => {
    if (!folder) return tr('tasks.list.empty.noFolder')
    if (showArchived) return searching ? tr('tasks.list.empty.archivedSearch') : tr('tasks.list.empty.archived')
    if (searching) return tr('tasks.list.empty.search')
    return tr('tasks.list.empty.none')
  })()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mt-3 mb-1">
        <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('tasks.list.search')}
          aria-label={tr('tasks.list.search')}
          className="w-full rounded-lg border border-border bg-transparent py-1.5 pr-7 pl-8 text-[13px] outline-none placeholder:text-subtle focus:border-border-strong [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            title={tr('tasks.list.clear')}
            aria-label={tr('tasks.list.clearSearch')}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-fg"
            onClick={() => setQuery('')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="mb-1 flex items-center gap-1.5">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-subtle">
          <span className="shrink-0">{tr('tasks.list.groupBy')}</span>
          <select
            value={groupMode}
            disabled={showArchived || searching}
            onChange={(e) => changeGroupMode(e.target.value as GroupMode)}
            className="select-field min-w-0 flex-1 rounded-md border border-border bg-transparent py-1 text-[12px] text-fg disabled:opacity-50"
          >
            <option value="date">{tr('tasks.list.byDate')}</option>
            <option value="group">{tr('tasks.list.byGroup')}</option>
          </select>
        </label>
        <button
          type="button"
          aria-pressed={showArchived}
          title={showArchived ? tr('tasks.list.backToTasks') : tr('tasks.list.showArchived')}
          onClick={() => useTasks.setState({ showArchived: !showArchived })}
          className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] ${
            showArchived ? 'border-accent/50 bg-accent-soft text-accent' : 'border-border text-muted hover:bg-hover hover:text-fg'
          }`}
        >
          <Archive size={12} /> {tr('tasks.list.archived')}
          {archivedTasks.length > 0 ? ` (${archivedTasks.length})` : ''}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && source.length === 0 && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-subtle">
            <Loader2 size={12} className="animate-spin" /> {tr('tasks.list.loading')}
          </div>
        )}
        {tasks.length === 0 && !loading && (!searching || q.length < MIN_QUERY_LENGTH) && (
          <p className="px-1 py-2 text-xs text-subtle">{emptyText}</p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="mb-1">
            <div className="px-1 pt-2.5 pb-1 text-[11.5px] font-medium text-subtle">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  status={statusOf(t)}
                  active={t.id === activeId}
                  unseen={!!unseen[t.id] && t.id !== activeId}
                  blockedHost={(networkBlocked[t.id] ?? []).some((b) => !b.resolved)}
                  archivedView={showArchived}
                  group={taskMeta[t.id]?.group}
                  knownGroups={knownGroups}
                />
              ))}
            </div>
          </div>
        ))}
        {searching && !showArchived && q.length < MIN_QUERY_LENGTH && (
          <p className="px-1 py-2 text-[11.5px] text-subtle">{tr('tasks.list.minChars.pre', { n: MIN_QUERY_LENGTH })}</p>
        )}
        {searching && !showArchived && q.length >= MIN_QUERY_LENGTH && (
          <TranscriptResults hits={transcript.hits} loading={transcript.loading} scanned={transcript.scanned} total={transcript.total} />
        )}
      </div>
    </div>
  )
}
