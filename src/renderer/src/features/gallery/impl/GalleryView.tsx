/**
 * Modo «Lo que has creado»: tarjetas con miniatura de los archivos que la IA creó en Chat y en Overdrive. Filtros por tipo, fecha y origen,
 * buscador por nombre y las acciones de siempre («Ver aquí», «Abrir con tu programa», «Mostrar en la carpeta»), que reutilizan el panel y
 * los canales `extras:chatFile:*` (main revalida cada ruta). Los estados vacío, cargando y error siguen las maquetas aprobadas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe,
  LayoutGrid,
  MessageSquare,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  SquareArrowOutUpRight,
  X,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { ChatFileInfo, GalleryItem, GalleryThumbResult, GalleryType } from '@shared/ipc-extras'
import type { MsgKey } from '@shared/i18n'
import { getLang } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { Chip } from '../../../components/Chip'
import { PageHeader } from '../../../components/PageHeader'
import { Select } from '../../../components/Input'
import { getExtras } from '../../../lib/extrasApi'
import { requestViewChatFile } from '../../../lib/chatFileView'
import { formatFileSize } from '../../../lib/chatDocSize'
import { useT } from '../../../lib/i18n'
import { setDraft } from '../../../stores/drafts'
import { useUi } from '../../../stores/ui'
import { newChat } from '../../chat/actions'
import { chatFileActions } from '../../chat/ChatFiles'
import {
  NO_FILTERS,
  filterItems,
  groupItems,
  typeChips,
  whenText,
  type DateFilter,
  type GalleryFilters,
  type OriginFilter
} from './gallery-logic'

const ICON: Record<GalleryType, LucideIcon> = {
  document: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  web: Globe,
  pdf: FileText,
  image: FileImage,
  text: File
}

/** Colores de la miniatura dibujada por tipo (los tokens de la interfaz, nada de imágenes externas). */
const TONE: Record<GalleryType, string> = {
  document: 'text-accent',
  sheet: 'text-success',
  slides: 'text-warning',
  web: 'text-accent',
  pdf: 'text-danger',
  image: 'text-muted',
  text: 'text-muted'
}

const BTN =
  'no-drag inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-ctl border px-2.5 text-ui font-medium whitespace-nowrap transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: GalleryItem[]; truncated: boolean; at: number }

/** Pide la lista a main (reconstruye el índice y comprueba qué archivos siguen existiendo). */
export function useGallery(): { state: Load; reload: () => void; remove: (path: string) => void } {
  const [state, setState] = useState<Load>({ status: 'loading' })
  const alive = useRef(true)
  const reload = useCallback(() => {
    const extras = getExtras()
    setState({ status: 'loading' })
    if (!extras) {
      setState({ status: 'error' })
      return
    }
    extras
      .invoke('extras:gallery:list')
      .then((r) => alive.current && setState({ status: 'ready', items: r.items, truncated: r.truncated, at: Date.now() }))
      .catch(() => alive.current && setState({ status: 'error' }))
  }, [])
  useEffect(() => {
    alive.current = true
    reload()
    return () => {
      alive.current = false
    }
  }, [reload])
  const remove = useCallback((path: string) => {
    void getExtras()
      ?.invoke('extras:gallery:remove', { path })
      .catch(() => undefined)
    setState((s) => (s.status === 'ready' ? { ...s, items: s.items.filter((i) => i.path !== path) } : s))
  }, [])
  return { state, reload, remove }
}

const thumbCache = new Map<string, GalleryThumbResult>()
/** Solo pruebas. */
export function clearThumbCache(): void {
  thumbCache.clear()
}

function useThumb(item: GalleryItem): GalleryThumbResult | null {
  const wants = !item.missing && (item.type === 'image' || item.type === 'text' || item.type === 'web')
  const key = `${item.path}\0${item.createdAt}\0${item.bytes}`
  const [res, setRes] = useState<GalleryThumbResult | null>(() => (wants ? (thumbCache.get(key) ?? null) : null))
  useEffect(() => {
    if (!wants) return
    const cached = thumbCache.get(key)
    if (cached) {
      setRes(cached)
      return
    }
    let alive = true
    void getExtras()
      ?.invoke('extras:gallery:thumb', { path: item.path })
      .then((r) => {
        thumbCache.set(key, r)
        if (alive) setRes(r)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [wants, key, item.path])
  return res
}

/** Miniatura: imagen real reducida, primera línea de texto o un dibujo sencillo del tipo (Office y PDF no se renderizan). */
function Thumb({ item }: { item: GalleryItem }): React.JSX.Element {
  const res = useThumb(item)
  const Icon = ICON[item.type]
  if (item.missing) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-inset text-muted">
        <AlertTriangle size={28} aria-hidden="true" />
      </div>
    )
  }
  if (res?.kind === 'image') {
    return <img src={res.dataUrl} alt="" draggable={false} className="h-full w-full object-cover" />
  }
  const lines = res?.kind === 'text' ? res.text : ''
  return (
    <div className="flex h-full w-full items-center justify-center bg-inset p-3" aria-hidden="true">
      <div
        className={`relative flex h-full max-h-[8.5rem] w-[7rem] flex-col gap-1.5 overflow-hidden rounded-md border border-border bg-elevated p-2 shadow-xs ${item.type === 'slides' ? '!w-[11rem]' : ''}`}
      >
        <Icon size={16} className={TONE[item.type]} aria-hidden="true" />
        {lines ? (
          <span className="line-clamp-4 text-meta leading-snug break-words text-muted">{lines}</span>
        ) : (
          <>
            <span className="h-1.5 w-4/5 rounded-full bg-border-strong" />
            <span className="h-1.5 w-full rounded-full bg-border" />
            <span className="h-1.5 w-full rounded-full bg-border" />
            <span className="h-1.5 w-3/5 rounded-full bg-border" />
          </>
        )}
        {item.type === 'pdf' && (
          <span className="absolute right-1 bottom-1 rounded-sm bg-danger px-1 text-meta leading-4 font-semibold text-danger-fg">PDF</span>
        )}
      </div>
    </div>
  )
}

function toInfo(item: GalleryItem): ChatFileInfo {
  return { path: item.path, name: item.name, bytes: item.bytes, kind: item.kind, canView: item.canView, canOpen: item.canOpen }
}

/** «Ver aquí» abre el archivo en el panel del Chat (el mismo visor de siempre). */
export function viewInChat(item: GalleryItem): void {
  useUi.getState().setMode('chat')
  requestViewChatFile(toInfo(item))
}

export function GalleryCard({
  item,
  now,
  onRemove
}: {
  item: GalleryItem
  now: number
  onRemove: (path: string) => void
}): React.JSX.Element {
  const t = useT()
  const [failed, setFailed] = useState(false)
  const actions = chatFileActions(toInfo(item))
  const kind = t(`gallery.kind.${item.type}` as MsgKey)
  const meta = [kind, whenText(item.createdAt, now, getLang(), t), item.bytes > 0 ? formatFileSize(item.bytes, getLang()) : ''].filter(
    Boolean
  )
  const aria = (action: MsgKey): string => t('gallery.action.aria', { action: t(action), name: item.name })
  const run = (fn: () => Promise<void>): void => {
    setFailed(false)
    void fn().catch(() => setFailed(true))
  }
  return (
    <li
      data-gallery-card={item.type}
      data-missing={item.missing ? '' : undefined}
      className="group relative flex flex-col overflow-hidden rounded-card border border-border bg-elevated transition-colors duration-fast focus-within:border-accent hover:border-border-strong"
    >
      <div className="relative h-44 shrink-0 overflow-hidden border-b border-border bg-code">
        <Thumb item={item} />
        {!item.missing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-bg/80 p-4 opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            {item.canView && (
              <button
                type="button"
                onClick={() => viewInChat(item)}
                aria-label={aria('gallery.action.view')}
                className={`${BTN} border-transparent bg-accent text-accent-fg hover:bg-accent-hover`}
              >
                <Eye size={14} aria-hidden="true" />
                {t('gallery.action.view')}
              </button>
            )}
            {item.canOpen && (
              <button
                type="button"
                onClick={() => run(actions.open)}
                aria-label={aria('gallery.action.open')}
                className={`${BTN} border-border bg-elevated text-fg hover:bg-hover`}
              >
                <SquareArrowOutUpRight size={14} aria-hidden="true" />
                {t('gallery.action.open')}
              </button>
            )}
            <button
              type="button"
              onClick={() => run(actions.reveal)}
              aria-label={aria('gallery.action.reveal')}
              className={`${BTN} border-border bg-elevated text-fg hover:bg-hover`}
            >
              <FolderOpen size={14} aria-hidden="true" />
              {t('gallery.action.reveal')}
            </button>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <h3 className="truncate text-sm font-semibold text-fg" title={item.name}>
          {item.name}
        </h3>
        {item.missing ? (
          <>
            <p className="text-meta font-medium text-warning">{t('gallery.missing')}</p>
            <p className="text-meta text-muted">{t('gallery.missing.hint')}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-1 self-start"
              aria-label={aria('gallery.action.remove')}
              onClick={() => onRemove(item.path)}
            >
              <X size={14} aria-hidden="true" />
              {t('gallery.action.remove')}
            </Button>
          </>
        ) : (
          <>
            <p className="truncate text-meta text-muted">{meta.join(' · ')}</p>
            <p className="flex items-center gap-1 text-meta text-muted">
              {item.origin === 'chat' ? <MessageSquare size={12} aria-hidden="true" /> : <Zap size={12} aria-hidden="true" />}
              {t(item.origin === 'chat' ? 'gallery.createdIn.chat' : 'gallery.createdIn.overdrive')}
            </p>
          </>
        )}
        {failed && (
          <p role="status" className="text-meta text-danger">
            {t('gallery.actionFailed')}
          </p>
        )}
      </div>
    </li>
  )
}

function Skeletons(): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite" data-gallery-loading="">
      <span className="sr-only">{t('gallery.loading')}</span>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-4" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="overflow-hidden rounded-card border border-border bg-elevated">
            <div className="h-44 animate-pulse bg-inset" />
            <div className="flex flex-col gap-2 p-3">
              <div className="h-3.5 w-3/4 animate-pulse rounded-full bg-inset" />
              <div className="h-3 w-1/2 animate-pulse rounded-full bg-inset" />
              <div className="h-3 w-1/3 animate-pulse rounded-full bg-inset" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const STARTERS: { id: 'document' | 'sheet' | 'slides' | 'web'; icon: LucideIcon; tone: string }[] = [
  { id: 'document', icon: FileText, tone: 'bg-accent-soft text-accent' },
  { id: 'sheet', icon: FileSpreadsheet, tone: 'bg-inset text-success' },
  { id: 'slides', icon: Presentation, tone: 'bg-gold-soft text-gold-text' },
  { id: 'web', icon: Globe, tone: 'bg-inset text-warning' }
]

/** Lleva al Chat con el pedido ya escrito en la caja (la persona lo revisa y lo envía). */
export function startInChat(text: string): void {
  newChat()
  setDraft('chat:new', text)
  useUi.getState().setMode('chat')
}

export function GalleryEmpty(): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-8" data-gallery-empty="">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-2 pt-4 text-center">
        <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-inset text-muted">
          <LayoutGrid size={26} aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-fg">{t('gallery.empty.title')}</h2>
        <p className="text-ui leading-relaxed text-muted">{t('gallery.empty.body')}</p>
      </div>
      <section aria-labelledby="gallery-new">
        <h2 id="gallery-new" className="mb-3 text-meta font-semibold tracking-wider text-muted uppercase">
          {t('gallery.empty.new')}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))] gap-4">
          {STARTERS.map(({ id, icon: Icon, tone }) => {
            const example = t(`gallery.starter.${id}.example` as MsgKey)
            return (
              <li key={id} className="flex flex-col gap-3 rounded-card border border-border bg-elevated p-4">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <h3 className="text-sm font-semibold text-fg">{t(`gallery.starter.${id}.title` as MsgKey)}</h3>
                <p className="text-meta text-muted">{t(`gallery.starter.${id}.body` as MsgKey)}</p>
                <p className="rounded-ctl bg-inset px-2.5 py-2 text-meta text-muted">{t('gallery.starter.eg', { text: example })}</p>
                <Button variant="primary" size="sm" className="mt-auto self-start" onClick={() => startInChat(example)}>
                  <Plus size={14} aria-hidden="true" />
                  {t('gallery.empty.cta')}
                </Button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

export function GalleryError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-center gap-2 pt-16 text-center" data-gallery-error="">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-soft text-gold-text">
        <AlertTriangle size={26} aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-fg">{t('gallery.error.title')}</h2>
      <p className="text-ui leading-relaxed text-muted">{t('gallery.error.body')}</p>
      <Button variant="primary" size="md" className="mt-2" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" />
        {t('gallery.error.retry')}
      </Button>
    </div>
  )
}

/** Cuerpo con filtros, buscador y tarjetas (separado de la carga para probarlo con datos fijos). */
export function GalleryBody({
  items,
  truncated,
  now,
  onRemove,
  filters,
  setFilters
}: {
  items: GalleryItem[]
  truncated: boolean
  now: number
  onRemove: (path: string) => void
  filters: GalleryFilters
  setFilters: (f: GalleryFilters) => void
}): React.JSX.Element {
  const t = useT()
  const chips = useMemo(() => typeChips(items), [items])
  const shown = useMemo(() => filterItems(items, filters, now), [items, filters, now])
  const groups = useMemo(() => groupItems(shown, now, getLang(), t('gallery.group.week')), [shown, now, t])
  const filtered = filters.type !== 'all' || filters.date !== 'any' || filters.origin !== 'all' || filters.query.trim() !== ''
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('gallery.filters.aria')} className="flex flex-wrap items-center gap-2">
          <Chip selected={filters.type === 'all'} onClick={() => setFilters({ ...filters, type: 'all' })}>
            {t('gallery.type.all')}
            <span className="text-meta text-muted">{items.length}</span>
          </Chip>
          {chips.map(({ type }) => (
            <Chip key={type} selected={filters.type === type} onClick={() => setFilters({ ...filters, type })}>
              {t(`gallery.type.${type}` as MsgKey)}
            </Chip>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-muted">
            <Calendar size={14} aria-hidden="true" />
            <Select
              aria-label={t('gallery.date.aria')}
              value={filters.date}
              onChange={(e) => setFilters({ ...filters, date: e.target.value as DateFilter })}
              className="!w-auto"
            >
              {(['any', 'today', 'week', 'month'] as const).map((d) => (
                <option key={d} value={d}>
                  {t(`gallery.date.${d}` as MsgKey)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1.5 text-muted">
            <MessageSquare size={14} aria-hidden="true" />
            <Select
              aria-label={t('gallery.origin.aria')}
              value={filters.origin}
              onChange={(e) => setFilters({ ...filters, origin: e.target.value as OriginFilter })}
              className="!w-auto"
            >
              {(['all', 'chat', 'overdrive'] as const).map((o) => (
                <option key={o} value={o}>
                  {t(`gallery.origin.${o}` as MsgKey)}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <div role="status" className="flex flex-col items-center gap-3 py-16 text-center" data-gallery-nomatch="">
          <p className="text-ui text-muted">{t('gallery.results.none')}</p>
          {filtered && (
            <Button variant="secondary" size="sm" onClick={() => setFilters(NO_FILTERS)}>
              {t('gallery.results.clear')}
            </Button>
          )}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-label={g.label} className="flex flex-col gap-3">
            <h2 className="text-meta font-semibold tracking-wider text-muted uppercase">{g.label}</h2>
            <ul aria-label={t('gallery.list.aria')} className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-4">
              {g.items.map((i) => (
                <GalleryCard key={i.path} item={i} now={now} onRemove={onRemove} />
              ))}
            </ul>
          </section>
        ))
      )}
      {truncated && <p className="text-meta text-muted">{t('gallery.truncated')}</p>}
    </div>
  )
}

export function GalleryView(): React.JSX.Element {
  const t = useT()
  const { state, reload, remove } = useGallery()
  const [filters, setFilters] = useState<GalleryFilters>(NO_FILTERS)
  const now = state.status === 'ready' ? state.at : 0
  const empty = state.status === 'ready' && state.items.length === 0
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg" data-gallery="">
      <PageHeader
        title={t('gallery.title')}
        meta={<span className="hidden truncate text-meta text-muted min-[1100px]:inline">{t('gallery.subtitle')}</span>}
        actions={
          <label className="relative flex items-center">
            <Search size={14} className="pointer-events-none absolute left-2.5 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder={t('gallery.search.placeholder')}
              aria-label={t('gallery.search.aria')}
              maxLength={200}
              className="h-8 w-56 rounded-ctl border border-border bg-elevated pr-2 pl-8 text-ui text-fg placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
            />
          </label>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <Skeletons />}
        {state.status === 'error' && <GalleryError onRetry={reload} />}
        {empty && <GalleryEmpty />}
        {state.status === 'ready' && !empty && (
          <GalleryBody
            items={state.items}
            truncated={state.truncated}
            now={now}
            onRemove={remove}
            filters={filters}
            setFilters={setFilters}
          />
        )}
      </main>
    </div>
  )
}
