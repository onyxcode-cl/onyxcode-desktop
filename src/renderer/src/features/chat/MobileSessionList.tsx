import { useEffect, useState } from 'react'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { Loader2, MessagesSquare, MoreHorizontal, Pencil, Search, SquarePen, Trash2, X } from 'lucide-react'
import { t as tr, localeTag } from '@shared/i18n'
import { useT } from '../../lib/i18n'
import { LoadMoreSessions } from '../../components/LoadMoreSessions'
import { confirmDialog, promptDialog } from '../../components/ConfirmDialog'
import { Sheet } from '../../components/mobile/Sheet'
import { MobileSkeleton } from '../../components/mobile/Skeleton'
import { SwipeRow, useLongPress } from '../../components/mobile/SwipeRow'
import { SheetAction } from '../code/impl/SheetAction'
import { DETAIL_SCREEN, useMobileNavStore } from '../../app/mobile/nav'
import { timeAgo } from '../code/impl/ui'
import { newChat } from './actions'

interface Props {
  sessions: Session[]
  busyIds?: Set<string>
  loading?: boolean
  emptyText?: string
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  hasMore?: boolean
  onLoadMore?: (all: boolean) => void
}

function groupLabel(ts: number): string {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfDay) return tr('chat.group.today')
  if (ts >= startOfDay - 86_400_000) return tr('chat.group.yesterday')
  if (ts >= startOfDay - 7 * 86_400_000) return tr('chat.group.last7')
  if (ts >= startOfDay - 30 * 86_400_000) return tr('chat.group.last30')
  return new Date(ts).toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' })
}

function MobileRow({
  session,
  busy,
  onSelect,
  onRename,
  onDelete
}: {
  session: Session
  busy: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useT()
  const [sheet, setSheet] = useState(false)
  const title = session.title || t('chat.list.untitled')
  const press = useLongPress(() => setSheet(true))

  const rename = (): void => {
    void promptDialog({ title: t('mobile.list.renameTitle'), defaultValue: session.title, confirmLabel: t('chat.list.rename') }).then(
      (next) => {
        const v = next?.trim()
        if (v && v !== session.title) onRename(v)
      }
    )
  }
  // Nunca se borra con un gesto: tanto el deslizamiento como la hoja pasan por esta confirmación.
  const remove = (): void => {
    void confirmDialog({
      title: t('mobile.list.deleteTitle'),
      message: t('mobile.list.deleteMessage', { title }),
      confirmLabel: t('mobile.list.deleteConfirm'),
      danger: true
    }).then((ok) => {
      if (ok) onDelete()
    })
  }

  return (
    <SwipeRow
      actions={[
        { label: t('chat.list.rename'), tone: 'accent', icon: <Pencil size={18} />, onClick: rename },
        { label: t('chat.list.delete'), tone: 'danger', icon: <Trash2 size={18} />, onClick: remove }
      ]}
    >
      <div className="relative after:absolute after:right-0 after:bottom-0 after:left-4 after:h-px after:bg-[var(--m-hairline)]">
        <div className="flex min-h-[var(--m-row)] items-center">
          <button
            type="button"
            onClick={onSelect}
            className="flex min-h-[var(--m-row)] min-w-0 flex-1 flex-col justify-center px-4 text-left"
            {...press}
          >
            <span className="truncate text-[16px] leading-6 font-medium text-fg">{title}</span>
            <span className="truncate text-[13px] leading-4 text-subtle">{timeAgo(session.time.updated)}</span>
          </button>
          {busy && <Loader2 size={15} className="shrink-0 animate-spin text-accent" aria-hidden="true" />}
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-label={t('chat.list.options')}
            aria-haspopup="dialog"
            className="flex h-11 w-11 shrink-0 items-center justify-center text-muted active:bg-hover"
          >
            <MoreHorizontal size={19} />
          </button>
        </div>
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title={title} size="half">
        <SheetAction
          icon={<Pencil size={19} />}
          label={t('chat.list.rename')}
          onClick={() => {
            setSheet(false)
            rename()
          }}
        />
        <SheetAction
          danger
          icon={<Trash2 size={19} />}
          label={t('chat.list.delete')}
          onClick={() => {
            setSheet(false)
            remove()
          }}
        />
      </Sheet>
    </SwipeRow>
  )
}

/** Lista de conversaciones del celular: búsqueda siempre visible, cabeceras de grupo fijas, filas de 56 px. */
export function MobileSessionList({
  sessions,
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
  const filtering = filter.trim().length > 0
  useEffect(() => {
    if (filtering && hasMore) onLoadMore?.(true)
  }, [filtering, hasMore, onLoadMore])

  if (loading && sessions.length === 0) return <MobileSkeleton rows={6} label={t('chat.list.loading')} />
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center px-8 pt-16 text-center" data-m="empty-state">
        <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-accent-soft text-accent">
          <MessagesSquare size={28} aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-display text-[17px] leading-6 font-semibold">{emptyText ?? t('chat.list.emptyDefault')}</h2>
        <p className="mt-1 max-w-[30ch] text-[15px] leading-snug text-muted">{t('mobile.list.emptyBody')}</p>
        <button
          type="button"
          onClick={() => {
            newChat()
            useMobileNavStore.getState().push(DETAIL_SCREEN)
          }}
          className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-medium text-accent-fg active:opacity-80"
        >
          <SquarePen size={18} aria-hidden="true" /> {t('mobile.list.new')}
        </button>
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
    <div>
      <div className="sticky top-0 z-10 bg-bg px-4 pt-2 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-inset px-3 focus-within:ring-2 focus-within:ring-accent/40">
          <Search size={16} className="shrink-0 text-subtle" aria-hidden="true" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder={t('chat.list.search')}
            aria-label={t('chat.list.searchLabel')}
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label={t('chat.list.clearSearch')}
              className="flex h-11 w-9 shrink-0 items-center justify-center text-subtle"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      {q && groups.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-8 pt-10 text-[15px] text-muted">
          <Search size={20} aria-hidden="true" />
          {t('chat.list.noMatches')}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="sticky top-[60px] z-[5] bg-bg/95 px-4 pt-3 pb-1.5 text-[13px] leading-4 font-semibold text-muted">{g.label}</h2>
          {g.items.map((s) => (
            <MobileRow
              key={s.id}
              session={s}
              busy={busyIds?.has(s.id) ?? false}
              onSelect={() => onSelect(s.id)}
              onRename={(title) => void onRename(s.id, title)}
              onDelete={() => void onDelete(s.id)}
            />
          ))}
        </section>
      ))}
      <LoadMoreSessions visible={!!hasMore && !q} onClick={() => onLoadMore?.(false)} />
    </div>
  )
}
