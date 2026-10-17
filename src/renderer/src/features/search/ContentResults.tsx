/**
 * Resultados de la búsqueda por contenido dentro de la paleta: agrupados por conversación, con el fragmento resaltado y la
 * fecha. Solo dibuja; la selección con flechas y Enter la lleva la paleta (que conoce también los comandos).
 */
import { useT, dateLocale } from '../../lib/i18n'
import { GROUP_LABEL } from '../../components/surfaces'
import { MODES_BY_ID } from '../../app/modes'
import type { SearchGroup, SearchHit } from './search-index'

export interface ContentItem {
  group: SearchGroup
  /** Sin `hit`: la conversación solo coincide por su nombre. */
  hit?: SearchHit
}

/** Una entrada seleccionable por coincidencia (o una por conversación que solo coincide por el nombre). */
export function flattenGroups(groups: SearchGroup[]): ContentItem[] {
  return groups.flatMap((group) => (group.hits.length ? group.hits.map((hit) => ({ group, hit })) : [{ group }]))
}

export function contentItemId(item: ContentItem): string {
  return `palette-hit-${item.group.sessionId}-${item.hit?.messageId ?? 'title'}`
}

export function Highlight({ text, ranges }: { text: string; ranges: Array<[number, number]> }): React.JSX.Element {
  const out: React.ReactNode[] = []
  let at = 0
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s))
    out.push(
      <mark key={i} className="rounded-[3px] bg-accent-soft px-px text-fg">
        {text.slice(s, e)}
      </mark>
    )
    at = e
  })
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function ContentResults({
  groups,
  startIndex,
  activeIndex,
  onHover,
  onPick
}: {
  groups: SearchGroup[]
  /** Posición del primer resultado en la lista completa de la paleta (los comandos van antes). */
  startIndex: number
  activeIndex: number
  onHover: (index: number) => void
  onPick: (item: ContentItem) => void
}): React.JSX.Element | null {
  const t = useT()
  if (groups.length === 0) return null
  let i = startIndex
  return (
    <div>
      <div className={GROUP_LABEL}>{t('search.group.messages')}</div>
      {groups.map((group) => {
        const ModeIcon = MODES_BY_ID[group.mode].icon
        return (
          <div key={group.sessionId} role="group" aria-label={group.title}>
            <div className="flex h-7 items-center gap-2 px-2 pt-1.5 text-meta text-muted">
              <ModeIcon size={14} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate font-medium text-fg">{group.title}</span>
              <span className="shrink-0">· {t(group.mode === 'chat' ? 'search.mode.chat' : 'search.mode.code')}</span>
              <span className="ml-auto shrink-0">{formatDate(group.updated)}</span>
            </div>
            {(group.hits.length ? group.hits : [undefined]).map((hit) => {
              const item: ContentItem = { group, hit }
              const idx = i++
              const active = idx === activeIndex
              const role = hit ? t(hit.role === 'user' ? 'search.role.user' : 'search.role.assistant') : ''
              return (
                <button
                  key={hit?.messageId ?? 'title'}
                  type="button"
                  id={contentItemId(item)}
                  role="option"
                  aria-selected={active}
                  aria-label={
                    hit ? t('search.hitAria', { role, date: formatDate(hit.at), snippet: hit.snippet, title: group.title }) : group.title
                  }
                  data-index={idx}
                  data-testid="search-hit"
                  onMouseMove={() => onHover(idx)}
                  onClick={() => onPick(item)}
                  className={`flex w-full items-start gap-2 rounded-ctl py-1.5 pr-2 pl-7 text-left text-sm ${active ? 'bg-active text-fg' : 'text-fg'}`}
                >
                  {hit ? (
                    <>
                      <span className="mt-px w-7 shrink-0 text-meta text-subtle">{role}</span>
                      <span className="min-w-0 flex-1 break-words text-muted [overflow-wrap:anywhere]">
                        <Highlight text={hit.snippet} ranges={hit.ranges} />
                      </span>
                      <span className="mt-px shrink-0 text-meta text-subtle">{formatDate(hit.at)}</span>
                    </>
                  ) : (
                    <span className="text-meta text-subtle">{t('search.titleMatch')}</span>
                  )}
                </button>
              )
            })}
            {group.total > group.hits.length && group.hits.length > 0 && (
              <div className="pr-2 pl-9 pb-1 text-meta text-subtle">{t('search.more', { count: group.total - group.hits.length })}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
