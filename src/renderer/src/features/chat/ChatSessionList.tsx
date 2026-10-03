import { useEffect, useRef, useState } from 'react'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { Check, Loader2, MessagesSquare, MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react'
import { t as tr, localeTag } from '@shared/i18n'
import { useT } from '../../lib/i18n'
import { isSubmitKey } from '../../lib/textarea'
import { LoadMoreSessions } from '../../components/LoadMoreSessions'
import { PopoverPanel } from '../../components/PopoverPanel'

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

function Row({
  session,
  active,
  busy,
  onSelect,
  onRename,
  onDelete
}: {
  session: Session
  active: boolean
  busy: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useT()
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
    <div ref={rowRef} className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={`relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition-colors duration-150 ${active ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'} ${menu ? 'bg-hover' : ''}`}
      >
        {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden />}
        <span className="flex-1 truncate group-hover:pr-5">{session.title || t('chat.list.untitled')}</span>
        {busy && <Loader2 size={13} className="shrink-0 animate-spin text-accent group-hover:opacity-0" />}
      </button>
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-label={t('chat.list.options')}
        className={`absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted transition-opacity hover:bg-active hover:text-fg focus-visible:opacity-100 ${menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
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
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-hover"
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
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-danger hover:bg-danger/10"
          >
            <Trash2 size={14} /> {t('chat.list.delete')}
          </button>
        )}
      </PopoverPanel>
    </div>
  )
}

/** Lista de sesiones agrupada por fecha, con renombrar/eliminar. */
export function ChatSessionList({
  sessions,
  activeId,
  busyIds,
  loading,
  emptyText,
  onSelect,
  onRename,
  onDelete,
  hasMore,
  onLoadMore
}: Props): React.JSX.Element {
  const t = useT()
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
  if (sessions.length === 0) {
    return (
      <div className="mx-1 mt-6 flex flex-col items-center gap-2 px-4 text-center">
        <MessagesSquare size={18} className="text-subtle" />
        <span className="text-xs text-subtle">{emptyText ?? t('chat.list.emptyDefault')}</span>
      </div>
    )
  }
  const q = filter.trim().toLowerCase()
  const visible = q ? sessions.filter((s) => (s.title || '').toLowerCase().includes(q)) : sessions
  const groups: { label: string; items: Session[] }[] = []
  for (const s of visible) {
    const label = groupLabel(s.time.updated)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(s)
    else groups.push({ label, items: [s] })
  }
  return (
    <div className="flex flex-col gap-4">
      {sessions.length > 8 && (
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
        <div key={g.label}>
          <div className="px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{g.label}</div>
          <div className="flex flex-col gap-px">
            {g.items.map((s) => (
              <Row
                key={s.id}
                session={s}
                active={s.id === activeId}
                busy={busyIds?.has(s.id) ?? false}
                onSelect={() => onSelect(s.id)}
                onRename={(title) => void onRename(s.id, title)}
                onDelete={() => void onDelete(s.id)}
              />
            ))}
          </div>
        </div>
      ))}
      <LoadMoreSessions visible={!!hasMore && !q} onClick={() => onLoadMore?.(false)} />
    </div>
  )
}
