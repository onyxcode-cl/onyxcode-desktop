/**
 * Barra lateral de Tareas por carpetas (como la de Claude): TODAS las carpetas a la vista, cada una con su nombre, una flecha para plegarla y sus
 * chats debajo; los chats que no tienen carpeta van juntos en «Este equipo». Ya no hace falta elegir una carpeta para ver sus tareas.
 *
 * La carpeta conectada muestra sus tareas en vivo (`TaskList flat`); las demás, lo que guarda el índice de chats de main (carpeta, id, título y
 * última actividad): un clic conecta esa carpeta y abre el chat. Una carpeta nueva en esta versión aparece con sus chats la primera vez que se abre.
 */
import { useEffect, useMemo, useState } from 'react'
import { Archive, BookText, ChevronDown, FolderPlus, Plus } from 'lucide-react'
import type { ChatIndexEntry, TasksFolder } from '@shared/ipc-tasks'
import { useT } from '../../../lib/i18n'
import { SidebarTreeRegion, useSidebarTree } from '../../../components/SidebarTree'
import { useSessions } from '../../../stores/sessions'
import { selectSessionsForDirectory } from '../../../lib/session-reducer'
import { chooseFolder, newTask, selectFolder } from './actions'
import { loadChatIndex, useChatIndex } from './chatIndex'
import { sdkDirOf } from './path-map'
import { setProjectPanelOpen, useTasks } from './store'
import { IndexRow, TaskList } from './TaskList'
import { isChatFolderForDisplay } from './unified'
import { baseName } from './util'

const CLOSED_KEY = 'tasks.folderGroups.closed'
export const COMPUTER_GROUP = '__este-equipo__'

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
export const samePath = (a: string | null | undefined, b: string): boolean => !!a && norm(a) === norm(b)

export interface FolderGroup {
  /** Clave estable: la ruta de la carpeta, o `COMPUTER_GROUP` para los chats sin carpeta. */
  key: string
  /** Carpeta que representa (ausente en «Este equipo»). */
  path?: string
  name: string
  /** Chats guardados en el índice para este grupo (los de la carpeta conectada se leen en vivo). */
  entries: ChatIndexEntry[]
  connected: boolean
}

/**
 * Pura: de las carpetas aprobadas y las entradas del índice salen los grupos. Primero la carpeta conectada y después por último uso; las carpetas de
 * chat (sin carpeta de la persona) se juntan en «Este equipo», al final. Una carpeta sin chats igual aparece (se puede abrir y crear una tarea).
 */
export function buildFolderGroups(opts: {
  folders: TasksFolder[]
  connected: string | null
  entries: ChatIndexEntry[]
  isChatFolder: (path: string) => boolean
  computerName: string
}): FolderGroup[] {
  const { folders, connected, entries, isChatFolder, computerName } = opts
  const own = folders.filter((f) => !isChatFolder(f.path))
  const chatPaths = new Set(folders.filter((f) => isChatFolder(f.path)).map((f) => norm(f.path)))
  own.sort((a, b) => {
    const ac = samePath(connected, a.path) ? 1 : 0
    const bc = samePath(connected, b.path) ? 1 : 0
    if (ac !== bc) return bc - ac
    return (b.lastUsedAt ?? b.approvedAt ?? 0) - (a.lastUsedAt ?? a.approvedAt ?? 0)
  })
  const byFolder = (path: string): ChatIndexEntry[] =>
    entries.filter((e) => samePath(path, e.folder)).sort((a, b) => b.updatedAt - a.updatedAt)
  const groups: FolderGroup[] = own.map((f) => ({
    key: f.path,
    path: f.path,
    name: baseName(f.path),
    entries: byFolder(f.path),
    connected: samePath(connected, f.path)
  }))
  const chatEntries = entries
    .filter((e) => chatPaths.has(norm(e.folder)) || isChatFolder(e.folder))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (chatEntries.length > 0) groups.push({ key: COMPUTER_GROUP, name: computerName, entries: chatEntries, connected: false })
  return groups
}

function readClosed(): Set<string> {
  try {
    const raw = localStorage.getItem(CLOSED_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeClosed(set: Set<string>): void {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...set]))
  } catch {
    // sin storage: se recuerda solo mientras la app está abierta
  }
}

function Header({
  group,
  open,
  count,
  onToggle
}: {
  group: FolderGroup
  open: boolean
  count: number
  onToggle: () => void
}): React.JSX.Element {
  const t = useT()
  const tree = useSidebarTree()
  const showArchived = useTasks((s) => s.showArchived)
  const folderPath = group.path
  const startNew = (): void => {
    if (!folderPath) return newTask()
    void selectFolder(folderPath).then(() => newTask())
  }
  return (
    <div
      className="group/fh flex h-8 items-center rounded-ctl pr-1 hover:bg-hover"
      role={tree ? 'treeitem' : undefined}
      aria-level={tree ? 1 : undefined}
      aria-expanded={tree ? open : undefined}
      aria-label={tree ? group.name : undefined}
      data-testid="folder-group-header"
    >
      <button
        type="button"
        onClick={onToggle}
        data-tree-primary={tree ? '' : undefined}
        aria-expanded={tree ? undefined : open}
        aria-label={t(open ? 'app.sidebar.collapseProject' : 'app.sidebar.expandProject', { name: group.name })}
        title={folderPath ?? group.name}
        className="no-drag flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-ctl pl-1.5 text-left text-ui text-muted"
      >
        <ChevronDown
          size={12}
          strokeWidth={1.8}
          className={`shrink-0 text-subtle transition-transform duration-[var(--dur-fast)] ${open ? '' : '-rotate-90'}`}
          aria-hidden="true"
        />
        <span className={`min-w-0 flex-1 truncate font-medium ${group.connected ? 'text-fg' : ''}`}>{group.name}</span>
        <span className="shrink-0 pr-1 text-meta text-subtle tabular-nums group-hover/fh:hidden group-focus-within/fh:hidden">{count}</span>
      </button>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover/fh:flex group-focus-within/fh:flex">
        {group.connected && (
          <>
            <button
              type="button"
              onClick={() => useTasks.setState({ showArchived: !showArchived })}
              aria-pressed={showArchived}
              title={showArchived ? t('tasks.list.backToTasks') : t('tasks.list.showArchived')}
              aria-label={showArchived ? t('tasks.list.backToTasks') : t('tasks.list.showArchived')}
              className={`no-drag flex size-6 items-center justify-center rounded-ctl-sm hover:bg-active hover:text-fg ${showArchived ? 'text-accent' : 'text-muted'}`}
            >
              <Archive size={13} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => setProjectPanelOpen(true)}
              title={t('tasks.sidebar.projectTitle')}
              aria-label={t('tasks.sidebar.project')}
              className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-fg"
            >
              <BookText size={13} strokeWidth={1.75} />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={startNew}
          title={t('tasks.groups.newIn', { name: group.name })}
          aria-label={t('tasks.groups.newIn', { name: group.name })}
          className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-fg"
        >
          <Plus size={14} strokeWidth={1.75} />
        </button>
      </span>
    </div>
  )
}

export function FolderGroups(): React.JSX.Element {
  const t = useT()
  const tree = useSidebarTree()
  const folders = useTasks((s) => s.folders)
  const connected = useTasks((s) => s.folder)
  const conn = useTasks((s) => s.conn)
  const activeId = useTasks((s) => s.activeTaskId)
  const entries = useChatIndex((s) => s.entries)
  const opening = useChatIndex((s) => s.opening)
  const openError = useChatIndex((s) => s.error)
  const sessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const [closed, setClosed] = useState<Set<string>>(readClosed)

  useEffect(() => {
    void loadChatIndex()
  }, [])

  const groups = useMemo(
    () =>
      buildFolderGroups({
        folders,
        connected,
        entries,
        isChatFolder: isChatFolderForDisplay,
        computerName: t('tasks.groups.thisComputer')
      }),
    [folders, connected, entries, t]
  )

  // Cuántas tareas vivas (sin subtareas) tiene la carpeta conectada: la lista corrida las pinta, el número de la cabecera sale de aquí.
  const dirKey = connected ? sdkDirOf(conn, connected) : ''
  const liveCount = useMemo(() => {
    if (!connected) return 0
    const list = selectSessionsForDirectory({ sessions, sessionSource, directorySource }, dirKey)
    return list.filter((s) => !s.parentID).length
  }, [sessions, sessionSource, directorySource, connected, dirKey])

  const toggle = (key: string): void => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeClosed(next)
      return next
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="folder-groups">
      {openError && (
        <p role="alert" data-testid="index-open-error" className="px-2 py-1.5 text-meta text-danger">
          {openError}
        </p>
      )}
      <SidebarTreeRegion>
        {groups.map((g) => {
          const open = !closed.has(g.key)
          const count = g.connected ? Math.max(liveCount, 0) : g.entries.length
          return (
            <div key={g.key} className="mb-0.5" role={tree ? 'group' : undefined} data-testid="folder-group">
              <Header group={g} open={open} count={count} onToggle={() => toggle(g.key)} />
              {open && (
                <div className="ml-3 border-l border-border/60 pl-1">
                  {g.connected ? (
                    <TaskList flat />
                  ) : (
                    <div className="space-y-0.5">
                      {g.entries.map((e) => (
                        <IndexRow
                          key={`ix:${e.folder}:${e.sessionId}`}
                          entry={e}
                          active={e.sessionId === activeId && samePath(connected, e.folder)}
                          opening={opening?.sessionId === e.sessionId && opening.folder === e.folder}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </SidebarTreeRegion>
      <button
        type="button"
        onClick={() => void chooseFolder()}
        className="no-drag mt-1 flex h-8 items-center gap-2 rounded-ctl px-2 text-ui text-muted hover:bg-hover hover:text-fg"
      >
        <FolderPlus size={14} strokeWidth={1.75} aria-hidden="true" />
        {t('tasks.groups.addFolder')}
      </button>
    </div>
  )
}
