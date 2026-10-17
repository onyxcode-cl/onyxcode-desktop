import { useEffect, useRef, useState } from 'react'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { Archive, Check, Loader2, MessagesSquare, MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react'
import { t as tr, localeTag } from '@shared/i18n'
import { useT } from '../../lib/i18n'
import { isSubmitKey } from '../../lib/textarea'
import { LoadMoreSessions } from '../../components/LoadMoreSessions'
import { SidebarEmpty } from '../../components/SidebarEmpty'
import { StateDot, useSidebarTree } from '../../components/SidebarTree'
import { PopoverPanel } from '../../components/PopoverPanel'
import { isRemoteSurface } from '../../lib/platform'
import { relCompact } from '../../lib/rel-compact'
import { MobileSessionList } from './MobileSessionList'
import { ChatSidebarRow } from './ChatSidebarRow'

interface Props {
  sessions: Session[]
  activeId: string | null
  busyIds?: Set<string>
  loading?: boolean
  emptyText?: string
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  /** Puede haber más sesiones en el servidor que las cargadas. */
  hasMore?: boolean
  /** `all` = pedir todas (al filtrar). */
  onLoadMore?: (all: boolean) => void
  /** Solo la barra lateral de escritorio (1b): hora relativa a la derecha de cada fila y «Trabajando» en las ocupadas. */
  showTime?: boolean
  /** Ids fijados (solo escritorio): salen primero, en el grupo «Fijadas». */
  pinnedIds?: ReadonlySet<string>
  onTogglePin?: (id: string) => void
  onArchive?: (id: string) => void | Promise<void>
  onRestore?: (id: string) => void | Promise<void>
  /** Conversaciones archivadas: con `onToggleArchived` aparece el botón de ícono con su contador (solo escritorio). */
  archived?: Session[]
  showArchived?: boolean
  onToggleArchived?: () => void
}

function groupLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfDay) return tr('chat.group.today')
  if (ts >= startOfDay - 86_400_000) return tr('chat.group.yesterday')
  if (ts >= startOfDay - 7 * 86_400_000) return tr('chat.group.last7')
  if (ts >= startOfDay - 30 * 86_400_000) return tr('chat.group.last30')
  return d.toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' })
}

function PlainRow({
  session,
  active,
  busy,
  showTime,
  onSelect,
  onRename,
  onDelete
}: {
  session: Session
  active: boolean
  busy: boolean
  showTime?: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useT()
  const tree = useSidebarTree()
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      const inSheet = e.target instanceof Element && !!e.target.closest('[data-sheet]')
      if (!inSheet && rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setMenu(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const commit = (): void => {
    const title = draft.trim()
    setEditing(false)
    if (title && title !== session.title) onRename(title)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-elevated px-2 py-1 ring-2 ring-accent/40">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e, { allowShift: true })) commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <Check size={14} className="text-muted" />
      </div>
    )
  }

  return (
    <div
      ref={rowRef}
      className="group relative"
      role={tree ? 'treeitem' : undefined}
      aria-level={tree ? 1 : undefined}
      aria-label={
        tree
          ? (tree.stateAria(session.title || t('chat.list.untitled'), busy ? 'working' : null) ??
            (session.title || t('chat.list.untitled')))
          : undefined
      }
      aria-current={active && tree ? 'page' : undefined}
      onContextMenu={
        tree
          ? (e) => {
              e.preventDefault()
              setMenu(true)
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onSelect}
        data-tree-primary={tree ? '' : undefined}
        aria-current={active && !tree ? 'true' : undefined}
        className={`relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition-colors ${tree ? 'duration-150 desk:h-[30px] desk:gap-2 desk:rounded-ctl desk:px-2 desk:py-0 desk:text-ui' : 'duration-150 desk:h-8 desk:gap-2.5 desk:rounded-ctl desk:px-2.5 desk:py-0 desk:text-sm'} ${active ? (tree ? 'bg-active text-fg desk:font-normal' : 'bg-active font-medium text-fg desk:bg-hover') : 'text-muted hover:bg-hover hover:text-fg'} ${menu ? 'bg-hover' : ''}`}
      >
        {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent desk:hidden" aria-hidden />}
        {tree && busy && <StateDot state="working" />}
        {/* En el árbol la fila activa muestra «⋯» fijo: el título le deja su hueco y se trunca con «…» en vez de pisarlo. */}
        <span className={`flex-1 truncate group-hover:pr-5${tree && (active || menu) ? ' desk:pr-5' : ''}`}>
          {session.title || t('chat.list.untitled')}
        </span>
        {busy && !showTime && <Loader2 size={13} className="shrink-0 animate-spin text-accent group-hover:opacity-0" />}
        {showTime &&
          (tree && busy ? (
            <span className={`shrink-0 text-meta text-subtle group-focus-within:hidden group-hover:hidden ${active ? 'hidden' : ''}`}>
              {t('app.sidebar.working')}
            </span>
          ) : tree ? null : busy ? (
            <span className="flex shrink-0 items-center gap-1.5 text-meta text-muted group-hover:hidden">
              <span
                className="size-2.5 animate-spin rounded-full border-2 border-accent border-r-transparent motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t('app.sidebar.working')}
            </span>
          ) : (
            <span className="shrink-0 text-meta text-subtle tabular-nums group-hover:hidden">{relCompact(session.time.updated)}</span>
          ))}
      </button>
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-label={t('chat.list.options')}
        className={`absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted transition-opacity hover:bg-active hover:text-fg focus-visible:opacity-100 ${menu || (tree && active) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <MoreHorizontal size={15} />
      </button>
      <PopoverPanel
        open={menu}
        onClose={() => {
          setMenu(false)
          setConfirmDelete(false)
        }}
        title={session.title || t('chat.list.untitled')}
        className="absolute top-full right-0 z-40 mt-1 w-44 origin-top-right animate-pop-in overflow-hidden rounded-xl border border-border bg-elevated p-1 text-sm shadow-lg"
      >
        <button
          type="button"
          onClick={() => {
            setMenu(false)
            setDraft(session.title)
            setEditing(true)
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-hover desk:h-8 desk:gap-2.5 desk:rounded-ctl desk:py-0"
        >
          <Pencil size={14} className="text-muted" /> {t('chat.list.rename')}
        </button>
        {confirmDelete ? (
          <div className="flex items-center gap-1 px-2 py-1">
            <button
              type="button"
              onClick={() => {
                setMenu(false)
                setConfirmDelete(false)
                onDelete()
              }}
              className="flex-1 rounded-md bg-danger px-2 py-1 text-xs font-medium text-danger-fg"
            >
              {t('chat.list.confirm')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md p-1 text-muted hover:bg-hover"
              aria-label={t('chat.list.cancel')}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-danger hover:bg-danger/10 desk:h-8 desk:gap-2.5 desk:rounded-ctl desk:py-0"
          >
            <Trash2 size={14} /> {t('chat.list.delete')}
          </button>
        )}
      </PopoverPanel>
    </div>
  )
}

type RowProps = Parameters<typeof PlainRow>[0] & {
  pinned?: boolean
  archivedView?: boolean
  onTogglePin?: () => void
  onArchive?: () => void
  onRestore?: () => void
}

/** En el árbol de la barra lateral de escritorio la fila es la de dos líneas (como Overdrive y Code); fuera de él (pruebas, celular) no cambia. */
function Row(props: RowProps): React.JSX.Element {
  const tree = useSidebarTree()
  if (tree) return <ChatSidebarRow {...props} />
  const { pinned: _p, archivedView: _a, onTogglePin: _t, onArchive: _r, onRestore: _s, ...plain } = props
  return <PlainRow {...plain} />
}

/** Lista de sesiones agrupada por fecha, con renombrar/eliminar. En el celular es la lista táctil de `MobileSessionList`. */
export function ChatSessionList(props: Props): React.JSX.Element {
  return isRemoteSurface() ? <MobileSessionList {...props} /> : <DesktopSessionList {...props} />
}

function DesktopSessionList({
  sessions,
  activeId,
  busyIds,
  loading,
  emptyText,
  onSelect,
  onRename,
  onDelete,
  hasMore,
  onLoadMore,
  showTime,
  pinnedIds,
  onTogglePin,
  onArchive,
  onRestore,
  archived,
  showArchived = false,
  onToggleArchived
}: Props): React.JSX.Element {
  const t = useT()
  const tree = useSidebarTree()
  const [filter, setFilter] = useState('')
  // Al filtrar, el filtro debe cubrir TODAS las sesiones: se cargan las que faltan (M12).
  const filtering = filter.trim().length > 0
  useEffect(() => {
    if (filtering && hasMore) onLoadMore?.(true)
  }, [filtering, hasMore, onLoadMore])
  if (loading && sessions.length === 0) {
    return (
      <div className="flex flex-col gap-1.5 px-1 py-1" role="status" aria-busy="true" aria-label={t('chat.list.loading')}>
        {[70, 55, 80, 45].map((w, i) => (
          <div key={i} className="h-7 animate-pulse rounded-lg bg-hover/70" style={{ width: `${w}%` }} />
        ))}
      </div>
    )
  }
  // Escritorio: fila de herramientas con el título de la vista y el botón «Archivadas» (ícono con contador), como en Overdrive.
  const archivedCount = archived?.length ?? 0
  const toolsRow =
    onToggleArchived && !isRemoteSurface() && (archivedCount > 0 || showArchived) ? (
      <div className="mb-1 flex items-center gap-1 px-1">
        <span className="min-w-0 flex-1 truncate text-meta text-subtle">
          {showArchived ? t('chat.list.archived') : t('chat.list.title')}
        </span>
        <button
          type="button"
          aria-pressed={showArchived}
          title={showArchived ? t('chat.list.backToChats') : t('chat.list.showArchived')}
          aria-label={showArchived ? t('chat.list.backToChats') : t('chat.list.showArchived')}
          onClick={onToggleArchived}
          className={`no-drag relative flex size-7 items-center justify-center rounded-ctl-sm ${showArchived ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}
        >
          <Archive size={14} strokeWidth={1.75} />
          {archivedCount > 0 && !showArchived && (
            <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-hover px-1 text-[9px] desk:text-meta leading-3.5 text-muted">
              {archivedCount}
            </span>
          )}
        </button>
      </div>
    ) : null
  const shown = showArchived ? (archived ?? []) : sessions
  if (shown.length === 0) {
    const text = showArchived ? t('chat.list.emptyArchived') : (emptyText ?? t('chat.list.emptyDefault'))
    if (!isRemoteSurface())
      return (
        <>
          {toolsRow}
          <SidebarEmpty icon={<MessagesSquare size={18} strokeWidth={1.75} />} text={text} hint={showArchived ? false : 'chat'} />
        </>
      )
    return (
      <div className="mx-1 mt-6 flex flex-col items-center gap-2 px-4 text-center">
        <MessagesSquare size={18} className="text-subtle" />
        <span className="text-xs text-subtle">{text}</span>
      </div>
    )
  }
  const q = filter.trim().toLowerCase()
  const visible = q ? shown.filter((s) => (s.title || '').toLowerCase().includes(q)) : shown
  const groups: { label: string; items: Session[] }[] = []
  // «Fijadas» arriba (solo en la vista normal); el resto sigue agrupado por fecha.
  const pinnedItems = !showArchived && pinnedIds ? visible.filter((s) => pinnedIds.has(s.id)) : []
  if (pinnedItems.length > 0) groups.push({ label: t('chat.group.pinned'), items: pinnedItems })
  for (const s of pinnedItems.length > 0 ? visible.filter((x) => !pinnedIds!.has(x.id)) : visible) {
    const label = groupLabel(s.time.updated)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(s)
    else groups.push({ label, items: [s] })
  }
  return (
    <div className="flex flex-col gap-4">
      {toolsRow}
      {shown.length > 8 && (
        <div className="mx-0.5 flex items-center gap-2 rounded-lg border border-transparent bg-hover/60 px-2.5 py-1 transition-colors focus-within:border-accent/40 focus-within:bg-elevated">
          <Search size={13} className="shrink-0 text-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder={t('chat.list.search')}
            aria-label={t('chat.list.searchLabel')}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label={t('chat.list.clearSearch')}
              className="text-subtle hover:text-fg"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      {q && groups.length === 0 && <div className="px-2.5 text-xs text-subtle">{t('chat.list.noMatches')}</div>}
      {groups.map((g) => (
        <div key={g.label} role={tree ? 'group' : undefined} aria-label={tree ? g.label : undefined}>
          <div
            aria-hidden={tree ? true : undefined}
            className="px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase desk:flex desk:h-7 desk:items-end desk:px-2.5 desk:pb-0.5 desk:text-meta desk:font-normal desk:tracking-normal desk:normal-case"
          >
            {g.label}
          </div>
          <div className="flex flex-col gap-px desk:gap-0.5">
            {g.items.map((s) => (
              <Row
                key={s.id}
                session={s}
                active={s.id === activeId}
                busy={busyIds?.has(s.id) ?? false}
                showTime={showTime}
                onSelect={() => onSelect(s.id)}
                onRename={(title) => void onRename(s.id, title)}
                onDelete={() => void onDelete(s.id)}
                pinned={pinnedIds?.has(s.id) ?? false}
                archivedView={showArchived}
                onTogglePin={onTogglePin ? () => onTogglePin(s.id) : undefined}
                onArchive={onArchive ? () => void onArchive(s.id) : undefined}
                onRestore={onRestore ? () => void onRestore(s.id) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
      <LoadMoreSessions visible={!!hasMore && !q && !showArchived} onClick={() => onLoadMore?.(false)} />
    </div>
  )
}
