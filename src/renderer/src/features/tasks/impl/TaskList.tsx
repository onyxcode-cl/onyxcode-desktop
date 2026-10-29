/**
 * Lista de tareas de la carpeta: estado (icono), tiempo relativo, agrupación por fecha o por grupo, búsqueda
 * (títulos y contenido de las conversaciones), fijar / renombrar / mover a grupo / archivar / eliminar y la
 * vista de archivadas con "Restaurar".
 */
import { useUnifiedApps } from './unified'
import { chatDisplayTitle, loadChatIndex, syncChatSession, useChatIndex, visibleEntries } from './chatIndex'
import { openIndexedChat } from './chatIndexOpen'
import type { ChatIndexEntry } from '@shared/ipc-tasks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dateLocale, useT } from '../../../lib/i18n'
import type { Session } from '@opencode-ai/sdk/v2/client'
import {
  Archive,
  ArchiveRestore,
  FolderTree,
  Loader2,
  ListChecks,
  Mail,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Search,
  ShieldOff,
  Trash2,
  X,
  ArrowUpDown
} from 'lucide-react'
import { confirmDialog, promptDialog } from '../../../components/ConfirmDialog'
import { m as mob } from '../../../app/mobile/m'
import { MAIN_SOURCE, sessionsKey, useSessions } from '../../../stores/sessions'
import { SidebarEmpty } from '../../../components/SidebarEmpty'
import { SidebarTreeRegion, StateDot, useSidebarTree, type SessionState } from '../../../components/SidebarTree'
import { isRemoteSurface } from '../../../lib/platform'
import { LoadMoreSessions } from '../../../components/LoadMoreSessions'
import { selectSessionsForDirectory } from '../../../lib/session-reducer'
import { archiveTask, deleteTask, moveTaskToGroup, openTask, renameTask, restoreTask } from './actions'
import { MIN_QUERY_LENGTH, useTranscriptSearch, type TranscriptHit } from './search'
import { requestScrollToPart } from './scroll'
import {
  archivedSessionsForDirectory,
  filterByTitle,
  groupByDate,
  groupByGroup,
  splitInProgress,
  StatusIcon,
  statusTextClass,
  type TaskGroup
} from './SidebarSections'
import { sdkDirOf } from './path-map'
import { useTaskStatusOf } from './useTaskStatusOf'
import { isPinned, markUnread, togglePinned, useTasks } from './store'
import { relTime, rememberEvictedStatus, TASK_STATUS_LABEL, type TaskStatus } from './util'

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
  knownGroups,
  active = false
}: {
  id: string
  title: string
  archived?: boolean
  group?: string | null
  knownGroups: string[]
  /** Fila abierta: en escritorio el «⋯» queda siempre a la vista, como en Chat y Code. */
  active?: boolean
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
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:bg-hover desk:h-8 desk:gap-2.5 desk:rounded-ctl desk:px-2.5 desk:py-0 desk:text-ui ${danger ? 'text-danger' : ''}`}
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
    // Escritorio: el `translate` crea un contexto de apilamiento y el z-30 del menú quedaría dentro; con el menú abierto
    // el contenedor sube de capa (z-30 solo en escritorio) para que no lo tapen las filas siguientes.
    <div
      ref={rootRef}
      className={`relative shrink-0 desk:absolute! desk:inset-y-0 desk:right-1 desk:flex desk:items-center${open ? ' desk:z-30' : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        title={t('tasks.list.moreActions')}
        aria-label={t('tasks.list.moreActionsFor', { title: title || t('tasks.list.untitledLower') })}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`rounded p-0.5 text-subtle group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100 desk:flex desk:size-6 desk:items-center desk:justify-center desk:rounded-ctl-sm desk:text-muted desk:hover:bg-active ${
          open ? 'opacity-100' : 'opacity-0'
        }${active ? ' desk:opacity-100' : ''}`}
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
          className="absolute top-full right-0 z-30 mt-1 w-52 rounded-xl border border-border bg-elevated p-1 shadow-lg desk:rounded-card desk:shadow-pop"
          {...mob('task-menu')}
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
export function TaskRow({
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
  const tree = useSidebarTree()
  const unified = useUnifiedApps()
  // Modo unificado: sin título propio se dice «Chat sin título · fecha», nunca el id interno.
  const shownTitle = unified ? chatDisplayTitle(task.title, task.time.updated) : task.title || t('tasks.list.untitled')
  const busy = status === 'running' || status === 'using_computer' || status === 'waiting' || status === 'question'
  const pinned = isPinned(task.id)
  // Escritorio: la fila es de una sola línea; el estado se lee a la derecha (no en una segunda línea).
  const quiet = status === 'done' || status === 'idle'
  const waitsUser = status === 'waiting' || status === 'question'
  const working = status === 'running' || status === 'using_computer'
  const failed = status === 'error'
  const showTime = !waitsUser && !working && !failed
  // 1b (solo escritorio): el estado se lee a la derecha. «Terminada», «plan listo» e «interrumpida» conservan su icono, pero a la
  // derecha; el resto se dice con texto o chip («Aprobar», «Trabajando», «Falló») y el icono de la izquierda se oculta.
  const iconRight = status === 'done' || status === 'plan_ready' || status === 'interrupted'
  // Celular (rediseño PWA T3): filas de 44 px y el estado como chip («Aprobar» / «Trabajando»); el escritorio no cambia.
  const remote = isRemoteSurface()
  const chipRemote = remote && (waitsUser || working)
  // 2c (árbol): esperando / trabajando / terminada se dicen con el punto de estado de 7 px; el resto conserva su icono.
  const state: SessionState | null = waitsUser ? 'waiting' : working ? 'working' : failed ? 'error' : status === 'done' ? 'done' : null
  const iconDesk = iconRight && !(tree && state === 'done') ? ' desk:order-1 desk:group-hover:hidden' : ' desk:hidden'
  const metaHide = tree ? ' desk:group-focus-within:hidden' : ''
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm${remote ? ' min-h-11' : ''} desk:relative desk:min-h-0 desk:rounded-ctl desk:py-0${tree ? ' desk:h-auto desk:min-h-[42px] desk:gap-2 desk:px-2 desk:py-1.5 desk:text-ui' : ' desk:h-8 desk:gap-2 desk:px-2 desk:pl-[30px] desk:text-sm'}${busy ? '' : active ? ' desk:pr-8' : ' desk:focus-within:pr-8 desk:hover:pr-8'} ${active ? (tree ? 'bg-active desk:text-fg' : 'bg-active desk:bg-hover desk:font-medium') : 'hover:bg-hover'}`}
      role={tree ? 'treeitem' : undefined}
      aria-level={tree ? 2 : undefined}
      aria-current={tree && active ? 'page' : undefined}
      aria-label={tree ? (tree.stateAria(shownTitle, state) ?? shownTitle) : undefined}
      {...mob('task-row')}
    >
      {tree && state && <StateDot state={state} />}
      <span className={`shrink-0${iconDesk}`}>
        <StatusIcon status={status} size={13} />
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        data-tree-primary={tree ? '' : undefined}
        aria-current={active && !tree ? 'true' : undefined}
        onClick={() => void openTask(task.id)}
      >
        <div className={`truncate ${unseen ? 'font-semibold' : ''}`}>
          {pinned && <Pin size={10} className="mr-1 inline-block -translate-y-px text-subtle" />}
          {shownTitle}
        </div>
        <div
          data-quiet={quiet || undefined}
          className={`truncate text-[11px] desk:text-meta ${tree ? ' desk:mt-0.5' : ' desk:hidden'} ${statusTextClass(status)}${chipRemote ? ' hidden' : ''}`}
        >
          {status === 'archived'
            ? t('tasks.list.archivedAgo', { when: relTime(task.time.archived ?? task.time.updated) })
            : status === 'running' ||
                status === 'using_computer' ||
                status === 'waiting' ||
                status === 'question' ||
                status === 'plan_ready' ||
                status === 'interrupted'
              ? TASK_STATUS_LABEL[status]
              : tree && status === 'done'
                ? `${TASK_STATUS_LABEL.done} · ${relTime(task.time.updated)}`
                : relTime(task.time.updated)}
          {group && !archivedView && <span className="text-subtle"> · {group}</span>}
        </div>
      </button>
      {/* En el árbol de escritorio (maqueta B) la fila es solo punto + título: sin hora, que recortaba el título. */}
      {showTime && !tree && (
        <span
          className={`hidden shrink-0 text-[11px] text-subtle tabular-nums desk:inline desk:order-2 desk:text-meta ${busy ? '' : ' desk:group-hover:hidden'}${metaHide}`}
        >
          {relTime(task.time.updated)}
        </span>
      )}
      {waitsUser && tree && <span className="sr-only">{t('tasks.list.metaApprove')}</span>}
      {waitsUser && !tree && (
        <span
          className={`${remote ? 'inline-flex h-6 items-center rounded-full border border-warning/45 bg-warning/10 px-2.5 text-[12px] font-medium text-warning' : 'hidden'} shrink-0 desk:inline-flex desk:h-5 desk:items-center desk:rounded-full desk:border desk:border-warning/45 desk:bg-warning/10 desk:px-2 desk:text-meta desk:font-medium desk:text-warning desk:group-hover:hidden`}
        >
          {t('tasks.list.metaApprove')}
        </span>
      )}
      {working && tree && <span className="sr-only">{TASK_STATUS_LABEL.running}</span>}
      {working && !tree && (
        <span
          className={`${remote ? 'inline-flex h-6 items-center gap-1.5 text-[12px] text-accent' : 'hidden'} shrink-0 desk:inline-flex desk:items-center desk:gap-1.5 desk:text-meta desk:text-accent desk:before:size-2.5 desk:before:animate-spin desk:before:rounded-full desk:before:border-2 desk:before:border-accent desk:before:border-r-transparent desk:before:content-[''] desk:motion-reduce:before:animate-none`}
        >
          {remote && <Loader2 size={12} className="animate-spin" aria-hidden />}
          {TASK_STATUS_LABEL.running}
        </span>
      )}
      {failed && !tree && <span className="hidden shrink-0 desk:inline desk:text-meta desk:text-danger">{t('tasks.list.metaFailed')}</span>}
      {blockedHost && (
        <span className="shrink-0 text-warning" title={t('tasks.list.blocked')}>
          <ShieldOff size={12} />
        </span>
      )}
      {unseen && <span className="h-2 w-2 shrink-0 rounded-full bg-accent group-hover:hidden" />}
      {archivedView && (
        <button
          type="button"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] desk:text-meta text-accent hover:bg-hover"
          onClick={() => void restoreTask(task.id).catch(() => undefined)}
        >
          {t('tasks.list.restore')}
        </button>
      )}
      {!busy && (
        <TaskMenu id={task.id} title={task.title || ''} archived={archivedView} group={group} knownGroups={knownGroups} active={active} />
      )}
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
      <div className="flex items-center gap-1.5 px-1 pt-2.5 pb-1 text-[11.5px] desk:text-meta font-medium text-subtle">
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
                <span className="shrink-0 text-[10.5px] desk:text-meta text-subtle">{relTime(h.at)}</span>
              </div>
              <div className="line-clamp-2 text-[11.5px] desk:text-meta leading-snug text-muted">{h.snippet}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Chat de otra carpeta (viene del índice): se abre con un clic, conectando su carpeta si hace falta. */
export function IndexRow({ entry, active, opening }: { entry: ChatIndexEntry; active: boolean; opening: boolean }): React.JSX.Element {
  const t = useT()
  const tree = useSidebarTree()
  const title = chatDisplayTitle(entry.title, entry.updatedAt)
  return (
    <div
      data-testid="index-row"
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm desk:relative desk:min-h-0 desk:rounded-ctl desk:py-0${tree ? ' desk:h-auto desk:min-h-[42px] desk:gap-2 desk:px-2 desk:py-1.5 desk:text-ui' : ' desk:h-8 desk:gap-2 desk:px-2 desk:pl-[30px] desk:text-sm'} ${active ? 'bg-active' : 'hover:bg-hover'}`}
      role={tree ? 'treeitem' : undefined}
      aria-level={tree ? 2 : undefined}
      aria-current={tree && active ? 'page' : undefined}
      aria-busy={opening || undefined}
      aria-label={tree ? title : undefined}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        data-tree-primary={tree ? '' : undefined}
        aria-current={active && !tree ? 'true' : undefined}
        disabled={opening}
        title={title}
        onClick={() => void openIndexedChat(entry)}
      >
        <div className="truncate">{title}</div>
        <div className={`truncate text-[11px] desk:text-meta text-subtle${tree ? ' desk:mt-0.5' : ' desk:hidden'}`}>
          {opening ? t('tasks.unified.opening') : relTime(entry.updatedAt)}
        </div>
      </button>
      {opening ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-accent" aria-hidden />
      ) : (
        !tree && <span className="hidden shrink-0 text-meta text-subtle tabular-nums desk:inline">{relTime(entry.updatedAt)}</span>
      )}
    </div>
  )
}

type ListItem = { kind: 'task'; task: Session } | { kind: 'entry'; entry: ChatIndexEntry }
const itemTs = (i: ListItem): number => (i.kind === 'task' ? i.task.time.updated : i.entry.updatedAt)

/**
 * `flat`: la lista cuelga de su carpeta en la barra lateral por carpetas (`FolderGroups`): una sola lista corrida (las tareas en curso
 * primero, luego por última actividad), sin los títulos «Hoy/Ayer» ni la fila de ordenar/archivadas (el botón de archivadas vive en la
 * cabecera de la carpeta).
 */
export function TaskList({ flat = false }: { flat?: boolean } = {}): React.JSX.Element {
  const tr = useT()
  const unifiedOn = useUnifiedApps()
  const tree = useSidebarTree()
  const folder = useTasks((s) => s.folder)
  const activeId = useTasks((s) => s.activeTaskId)
  const loading = useTasks((s) => s.listLoading)
  const unseen = useTasks((s) => s.unseen)
  const networkBlocked = useTasks((s) => s.networkBlocked)
  const taskMeta = useTasks((s) => s.taskMeta)
  const showArchived = useTasks((s) => s.showArchived)
  const sessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const client = useTasks((s) => s.client)
  const baseUrl = useTasks((s) => s.conn?.baseUrl)
  // Carpeta tal como la ve OpenCode (`session.directory`): en macOS es la propia carpeta; en Windows, la ruta del sandbox.
  const dirKey = useTasks((s) => (folder ? sdkDirOf(s.conn, folder) : ''))
  const more = useSessions((s) => (folder ? !!s.moreSessions[sessionsKey(dirKey, baseUrl)] : false))
  const query = useTasks((s) => s.listQuery)
  const fullAccess = useTasks((s) => !!s.conn?.fullAccess)
  // Solo se indexa con la conexión lista y aislada: durante `starting` (conn null) aún pueden verse sesiones de Control total.
  const isolatedReady = useTasks((s) => !!s.conn && !s.conn.fullAccess)
  const indexEntries = useChatIndex((s) => s.entries)
  const opening = useChatIndex((s) => s.opening)
  const openError = useChatIndex((s) => s.error)
  const setQuery = (v: string): void => useTasks.setState({ listQuery: v })
  // Escritorio: la caja de búsqueda vive arriba en la barra lateral (`TasksSearchBox`, una sola en vez de dos); el celular la conserva aquí.
  const ownSearch = isRemoteSurface()
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
    () => (folder ? selectSessionsForDirectory({ sessions, sessionSource, directorySource }, dirKey) : []),
    [sessions, sessionSource, directorySource, folder, dirKey]
  )
  const archivedTasks = useMemo(() => {
    if (!folder) return []
    const viewSource = directorySource[dirKey] ?? MAIN_SOURCE
    return archivedSessionsForDirectory(sessions, dirKey, viewSource, (id) => sessionSource[id] ?? MAIN_SOURCE)
  }, [sessions, sessionSource, directorySource, folder, dirKey])

  // Modo unificado: lo que ve la carpeta conectada se avisa a main (índice de chats) y el índice se carga al arrancar.
  // El índice (carpeta, id, título, actividad) es la fuente de la barra lateral por carpetas: se carga y se alimenta SIEMPRE, no solo con la bandera.
  useEffect(() => {
    void loadChatIndex()
  }, [])
  useEffect(() => {
    if (!folder || fullAccess || !isolatedReady) return
    for (const s of liveTasks) {
      if (!s.parentID) syncChatSession({ folder, sessionId: s.id, title: s.title ?? '', updatedAt: s.time.updated })
    }
  }, [folder, fullAccess, isolatedReady, liveTasks])

  const source = showArchived ? archivedTasks : liveTasks
  const q = query.trim()
  const tasks = useMemo(() => filterByTitle(source, q), [source, q])
  const transcript = useTranscriptSearch(showArchived ? null : folder, q)
  // La búsqueda y el filtro deben cubrir todas las tareas: al buscar se cargan las que faltan (M12).
  const wantAll = q.length > 0 && more
  useEffect(() => {
    if (wantAll && client && folder) void useSessions.getState().loadMoreSessions(client, dirKey, baseUrl, true)
  }, [wantAll, client, folder, baseUrl, dirKey])

  // Grupos que ya existen en esta carpeta (para sugerirlos al mover una tarea).
  const knownGroups = useMemo(() => {
    const set = new Set<string>()
    for (const t of liveTasks) {
      const g = taskMeta[t.id]?.group?.trim()
      if (g) set.add(g)
    }
    return [...set].sort((a, b) => a.localeCompare(b, dateLocale(), { sensitivity: 'base' }))
  }, [liveTasks, taskMeta])

  const statusOf = useTaskStatusOf()

  const searching = q.length > 0
  // F8-B89: las tareas en curso de la carpeta abierta van en su propio grupo y NO se repiten en los grupos por
  // fecha. Usa el estado del renderer (SSE), así que el aviso de aprobación no espera al sondeo de main.
  const inProgressMode = !searching && !showArchived && groupMode === 'date'
  const split = inProgressMode ? splitInProgress(tasks, statusOf) : { live: [] as Session[], rest: tasks }
  const groups: Array<TaskGroup<Session>> = searching
    ? tasks.length > 0
      ? [{ key: 'search', label: tr('tasks.list.titleMatches'), items: tasks }]
      : []
    : showArchived
      ? groupByDate(tasks, (t) => t.time.archived ?? t.time.updated)
      : groupMode === 'group'
        ? groupByGroup(tasks, (t) => taskMeta[t.id]?.group)
        : [
            ...(split.live.length > 0 ? [{ key: 'in-progress', label: tr('tasks.side.inProgress'), items: split.live }] : []),
            ...groupByDate(split.rest, (t) => t.time.updated)
          ]

  // Lista unificada: tareas de la carpeta conectada + chats del índice de otras carpetas, por última actividad.
  const extraEntries: ChatIndexEntry[] = useMemo(() => {
    if (!unifiedOn || showArchived) return []
    const known = new Set<string>([...liveTasks, ...archivedTasks].map((s) => s.id))
    const vis = visibleEntries(indexEntries, { connectedFolder: folder, knownIds: known, connectedSettled: !loading && !more })
    return q ? vis.filter((e) => filterByTitle([{ title: chatDisplayTitle(e.title, e.updatedAt) }], q).length > 0) : vis
  }, [unifiedOn, showArchived, liveTasks, archivedTasks, indexEntries, folder, loading, more, q])
  const unifiedGroups: Array<TaskGroup<ListItem>> | null =
    unifiedOn && !showArchived
      ? ((): Array<TaskGroup<ListItem>> => {
          const toItems = (list: Session[]): ListItem[] => list.map((task) => ({ kind: 'task' as const, task }))
          const entryItems: ListItem[] = extraEntries.map((entry) => ({ kind: 'entry' as const, entry }))
          if (searching) {
            const all = [...toItems(tasks), ...entryItems].sort((a, b) => itemTs(b) - itemTs(a))
            return all.length > 0 ? [{ key: 'search', label: tr('tasks.list.titleMatches'), items: all }] : []
          }
          if (groupMode === 'group') {
            return groupByGroup<ListItem>([...toItems(tasks), ...entryItems], (i) =>
              i.kind === 'task' ? taskMeta[i.task.id]?.group : null
            )
          }
          const rest = [...toItems(split.rest), ...entryItems].sort((a, b) => itemTs(b) - itemTs(a))
          return [
            ...(split.live.length > 0 ? [{ key: 'in-progress', label: tr('tasks.side.inProgress'), items: toItems(split.live) }] : []),
            ...groupByDate<ListItem>(rest, itemTs)
          ]
        })()
      : null
  // Lista corrida (`flat`): todo en un solo grupo sin título, en curso primero y luego por última actividad.
  const flatGroups: Array<TaskGroup<Session>> | null =
    flat && !searching && !showArchived
      ? tasks.length > 0
        ? [{ key: 'flat', label: '', items: [...split.live, ...[...split.rest].sort((a, b) => b.time.updated - a.time.updated)] }]
        : []
      : null
  const shownGroups = flat && flatGroups ? flatGroups : (unifiedGroups ?? groups)
  const nothingToShow = flatGroups ? flatGroups.length === 0 : unifiedGroups ? unifiedGroups.length === 0 : tasks.length === 0

  const emptyText = ((): string => {
    if (!folder) return tr(unifiedOn ? 'tasks.list.empty.noFolder.unified' : 'tasks.list.empty.noFolder')
    if (showArchived) return searching ? tr('tasks.list.empty.archivedSearch') : tr('tasks.list.empty.archived')
    if (searching) return tr('tasks.list.empty.search')
    return tr('tasks.list.empty.none')
  })()

  const renderTask = (t: Session): React.JSX.Element => (
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
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {ownSearch && (
        <div className="relative mt-3 mb-1">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle desk:size-4" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('tasks.list.search')}
            aria-label={tr('tasks.list.search')}
            className="w-full rounded-lg border border-border bg-transparent py-1.5 pr-7 pl-8 text-[13px] outline-none placeholder:text-subtle focus:border-border-strong desk:h-8 desk:rounded-ctl desk:border-transparent desk:py-0 desk:pl-9 desk:text-sm desk:hover:bg-hover desk:focus:bg-hover [&::-webkit-search-cancel-button]:hidden"
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
      )}
      {!ownSearch && !flat && (
        // Escritorio: ordenar y archivadas son dos botones de ícono en una sola fila, con el título de lo que se está viendo.
        <div className="mt-2 mb-1 flex items-center gap-1 px-1">
          <span className="min-w-0 flex-1 truncate text-meta text-subtle">
            {showArchived ? tr('tasks.list.archived') : groupMode === 'group' ? tr('tasks.list.byGroup') : tr('tasks.list.byDate')}
          </span>
          <button
            type="button"
            disabled={showArchived || searching}
            title={`${tr('tasks.list.groupBy')}: ${groupMode === 'date' ? tr('tasks.list.byGroup') : tr('tasks.list.byDate')}`}
            aria-label={tr('tasks.list.groupBy')}
            onClick={() => changeGroupMode(groupMode === 'date' ? 'group' : 'date')}
            className="no-drag flex size-7 items-center justify-center rounded-ctl-sm text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <ArrowUpDown size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-pressed={showArchived}
            title={showArchived ? tr('tasks.list.backToTasks') : tr('tasks.list.showArchived')}
            aria-label={showArchived ? tr('tasks.list.backToTasks') : tr('tasks.list.showArchived')}
            onClick={() => useTasks.setState({ showArchived: !showArchived })}
            className={`no-drag relative flex size-7 items-center justify-center rounded-ctl-sm ${showArchived ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            <Archive size={14} strokeWidth={1.75} />
            {archivedTasks.length > 0 && !showArchived && (
              <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-hover px-1 text-[9px] desk:text-meta leading-3.5 text-muted">
                {archivedTasks.length}
              </span>
            )}
          </button>
        </div>
      )}
      <div className={`mb-1 items-center gap-1.5 desk:mt-1 ${ownSearch && !flat ? 'flex' : 'hidden'}`}>
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] desk:text-meta text-subtle">
          <span className="shrink-0 desk:sr-only">{tr('tasks.list.groupBy')}</span>
          <select
            value={groupMode}
            disabled={showArchived || searching}
            onChange={(e) => changeGroupMode(e.target.value as GroupMode)}
            className="select-field min-w-0 flex-1 rounded-md border border-border bg-transparent py-1 text-[12px] text-fg disabled:opacity-50 desk:h-7 desk:rounded-ctl-sm desk:border-transparent desk:text-ui desk:text-muted desk:hover:bg-hover desk:pr-8 desk:pl-2.5"
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
          className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] desk:h-7 desk:rounded-ctl-sm desk:border-transparent desk:px-2.5 desk:text-ui ${
            showArchived ? 'border-accent/50 bg-accent-soft text-accent' : 'border-border text-muted hover:bg-hover hover:text-fg'
          }`}
        >
          <Archive size={12} /> {tr('tasks.list.archived')}
          {archivedTasks.length > 0 ? ` (${archivedTasks.length})` : ''}
        </button>
      </div>
      {/* Escritorio: sin scroll propio (lo da la lista de la barra lateral): no aparece una barra con dos tareas ni se reserva su canal. */}
      <div className="min-h-0 flex-1 overflow-y-auto desk:overflow-visible">
        {loading && source.length === 0 && extraEntries.length === 0 && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-subtle desk:px-2 desk:text-meta desk:text-muted">
            <Loader2 size={12} className="animate-spin" /> {tr('tasks.list.loading')}
          </div>
        )}
        {unifiedOn && openError && (
          <p role="alert" data-testid="index-open-error" className="px-2 py-1.5 text-[11.5px] desk:text-meta text-danger">
            {openError}
          </p>
        )}
        {nothingToShow && !loading && (!searching || q.length < MIN_QUERY_LENGTH) && !isRemoteSurface() && (
          <SidebarEmpty
            icon={<ListChecks size={18} strokeWidth={1.75} />}
            text={emptyText}
            hint={!!folder && !showArchived && !searching ? 'tasks' : false}
          />
        )}
        {nothingToShow && !loading && (!searching || q.length < MIN_QUERY_LENGTH) && isRemoteSurface() && (
          <p className="px-1 py-2 text-xs text-subtle desk:px-2 desk:text-meta desk:text-muted">{emptyText}</p>
        )}
        <SidebarTreeRegion>
          {shownGroups.map((g) => (
            <div key={g.key} className="mb-1" role={tree ? 'group' : undefined} aria-label={tree ? g.label : undefined}>
              {g.label && (
                <div
                  aria-hidden={tree ? true : undefined}
                  className="px-1 pt-2.5 pb-1 text-[11.5px] font-medium text-subtle desk:flex desk:h-7 desk:items-end desk:px-2.5 desk:pb-0.5 desk:text-meta desk:font-normal desk:tracking-normal desk:normal-case"
                >
                  {g.label}
                </div>
              )}
              <div className="space-y-0.5">
                {(g.items as Array<Session | ListItem>).map((it) => {
                  if ('kind' in it) {
                    if (it.kind === 'entry') {
                      const e = it.entry
                      return (
                        <IndexRow
                          key={`ix:${e.folder}:${e.sessionId}`}
                          entry={e}
                          active={e.sessionId === activeId}
                          opening={opening?.sessionId === e.sessionId && opening.folder === e.folder}
                        />
                      )
                    }
                    return renderTask(it.task)
                  }
                  return renderTask(it)
                })}
              </div>
            </div>
          ))}
          <LoadMoreSessions
            visible={more && !searching}
            onClick={() => client && folder && void useSessions.getState().loadMoreSessions(client, dirKey, baseUrl)}
          />
        </SidebarTreeRegion>
        {searching && !showArchived && q.length < MIN_QUERY_LENGTH && (
          <p className="px-1 py-2 text-[11.5px] desk:text-meta text-subtle">{tr('tasks.list.minChars.pre', { n: MIN_QUERY_LENGTH })}</p>
        )}
        {searching && !showArchived && q.length >= MIN_QUERY_LENGTH && (
          <TranscriptResults hits={transcript.hits} loading={transcript.loading} scanned={transcript.scanned} total={transcript.total} />
        )}
      </div>
    </div>
  )
}
