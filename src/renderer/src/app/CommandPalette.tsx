/**
 * Paleta de comandos (⌘K / ⌘⇧P): ir a un modo, crear algo nuevo, abrir Ajustes, cambiar el tema
 * y saltar a una conversación reciente. Con 2 letras o más busca además DENTRO de los mensajes de Chat y Code
 * (`features/search`, índice local solo en memoria). Solo navegación y acciones ya existentes: no toca stores ajenos.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { useLang, useT } from '../lib/i18n'
import { isSubmitKey } from '../lib/textarea'
import {
  BarChart3,
  Blocks,
  CornerDownLeft,
  Monitor,
  MessageSquare,
  Moon,
  Plus,
  Search,
  SearchX,
  Settings,
  Sun,
  type LucideIcon
} from 'lucide-react'
import { DialogScrim } from '../components/Dialog'
import { GROUP_LABEL } from '../components/surfaces'
import { openChatSession } from '../features/chat/actions'
import { useServer } from '../stores/server'
import { useSessions } from '../stores/sessions'
import { selectSessionsForDirectory } from '../lib/session-reducer'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { MODES, MODES_BY_ID } from './modes'
import { hintText, useEffectiveBindings } from '../keybindings/bindings'
import { Spinner } from '../components/Spinner'
import { ContentResults, contentItemId, flattenGroups, type ContentItem } from '../features/search/ContentResults'
import { MIN_QUERY, fold } from '../features/search/search-index'
import { clearSearchIndex, ensureSearchIndex, MAX_CONVERSATIONS, searchContent, useSearchStatus } from '../features/search/search-service'
import { openSearchHit } from '../features/search/open-hit'

interface Command {
  id: string
  group: string
  label: string
  icon: LucideIcon
  /** Texto extra para la búsqueda (no se muestra). */
  keywords?: string
  /** Texto secundario a la derecha. */
  hint?: string
  /** `keys` (por defecto): el texto es un atajo y se dibuja como tecla; `badge`: una etiqueta («Actual»). */
  hintKind?: 'keys' | 'badge'
  run: () => void
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

function useCommands(): Command[] {
  const mode = useUi((s) => s.mode)
  const connection = useServer((s) => s.connection)
  const allSessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const updateSettings = useSettings((s) => s.update)
  const lang = useLang((s) => s.lang)
  const bindings = useEffectiveBindings()

  return useMemo(() => {
    void lang // las etiquetas se calculan con el idioma activo: recalcular al cambiarlo
    const ui = useUi.getState()
    const list: Command[] = []

    const newAction = MODES_BY_ID[mode].newAction
    if (newAction) {
      list.push({
        id: 'new',
        group: t('app.palette.group.actions'),
        label: newAction.label,
        icon: Plus,
        hint: hintText(bindings['conversation.new']) || undefined,
        keywords: t('app.palette.kw.new'),
        run: () => {
          ui.openSettings(false)
          newAction.run()
        }
      })
    }

    for (const m of MODES) {
      list.push({
        id: `mode:${m.id}`,
        group: t('app.palette.group.goto'),
        label: m.label,
        icon: m.icon,
        keywords: t('app.palette.kw.mode'),
        hint: m.id === mode ? t('app.palette.current') : undefined,
        hintKind: 'badge',
        run: () => ui.setMode(m.id)
      })
    }

    list.push({
      id: 'settings',
      group: t('app.palette.group.goto'),
      label: t('app.palette.settings'),
      icon: Settings,
      hint: hintText(bindings['settings.toggle']) || undefined,
      keywords: t('app.palette.kw.settings'),
      run: () => ui.openSettings(true)
    })

    list.push({
      id: 'personalization',
      group: t('app.palette.group.goto'),
      label: t('app.palette.personalization'),
      icon: Blocks,
      keywords: t('app.palette.kw.personalization'),
      run: () => ui.openPersonalization(true)
    })

    list.push({
      id: 'usage',
      group: t('app.palette.group.goto'),
      label: t('app.palette.usage'),
      icon: BarChart3,
      keywords: t('app.palette.kw.usage'),
      run: () => {
        try {
          localStorage.setItem('settings.section', 'usage')
        } catch {
          // sin storage: se abre en la sección que estuviera
        }
        // Reabrir Ajustes para que lea la sección aunque ya estuvieran abiertos.
        ui.openSettings(false)
        setTimeout(() => ui.openSettings(true), 0)
      }
    })

    const themes: [string, string, LucideIcon][] = [
      ['system', t('app.palette.theme.system'), Monitor],
      ['light', t('app.palette.theme.light'), Sun],
      ['dark', t('app.palette.theme.dark'), Moon]
    ]
    for (const [value, label, icon] of themes) {
      list.push({
        id: `theme:${value}`,
        group: t('app.palette.group.appearance'),
        label,
        icon,
        keywords: t('app.palette.kw.theme'),
        run: () => void updateSettings({ theme: value as 'system' | 'light' | 'dark' })
      })
    }

    if (connection) {
      const recents = selectSessionsForDirectory({ sessions: allSessions, sessionSource, directorySource }, connection.chatDirectory)
        .slice()
        .sort((a, b) => b.time.updated - a.time.updated)
        .slice(0, 8)
      for (const s of recents) {
        list.push({
          id: `chat:${s.id}`,
          group: t('app.palette.group.recent'),
          label: s.title || t('app.palette.untitled'),
          icon: MessageSquare,
          keywords: t('app.palette.kw.recent'),
          run: () => {
            ui.setMode('chat')
            void openChatSession(s.id)
          }
        })
      }
    }
    return list
  }, [mode, connection, allSessions, sessionSource, directorySource, updateSettings, lang, bindings])
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useUi((s) => s.paletteOpen)
  if (!open) return null
  return <PaletteDialog />
}

function PaletteDialog(): React.JSX.Element {
  const t = useT()
  const close = useUi((s) => s.setPaletteOpen)
  const commands = useCommands()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [cleared, setCleared] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const status = useSearchStatus()

  // Devolver el foco a donde estaba al cerrar.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => prev?.focus?.()
  }, [])

  // La primera vez que se abre la paleta se empieza a preparar la búsqueda en los mensajes (en segundo plano).
  useEffect(() => {
    ensureSearchIndex()
  }, [])

  const results = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean)
    if (words.length === 0) return commands
    return commands
      .map((c) => {
        const label = norm(c.label)
        const hay = `${label} ${norm(c.group)} ${norm(c.keywords ?? '')}`
        if (!words.every((w) => hay.includes(w))) return null
        return { c, score: label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2 }
      })
      .filter((x): x is { c: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c)
  }, [commands, query])

  // La búsqueda en mensajes sigue a lo que se escribe sin trabar la caja de texto.
  const deferred = useDeferredValue(query)
  const contentOn = fold(deferred.trim()).length >= MIN_QUERY
  const content = useMemo(
    () => (contentOn ? searchContent(deferred) : { groups: [], hitCount: 0 }),
    // `status.version` cambia cada vez que el índice recibe conversaciones nuevas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contentOn, deferred, status.version]
  )
  const contentItems = useMemo(() => flattenGroups(content.groups), [content])
  const total = results.length + contentItems.length

  useEffect(() => {
    setIndex(0)
    setCleared(false)
  }, [query])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (c: Command | undefined): void => {
    if (!c) return
    close(false)
    c.run()
  }
  const openContent = (item: ContentItem | undefined): void => {
    if (!item) return
    close(false)
    void openSearchHit(item.group, item.hit)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (total ? (i + 1) % total : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (total ? (i - 1 + total) % total : 0))
    } else if (isSubmitKey(e, { allowShift: true })) {
      // Enter sobre «Borrar lo leído» pulsa ese botón; en el resto ejecuta el resultado marcado.
      if ((e.target as HTMLElement).closest('[data-palette-clear]')) return
      e.preventDefault()
      if (index < results.length) run(results[index])
      else openContent(contentItems[index - results.length])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close(false)
    }
  }

  const activeItem = contentItems[index - results.length]
  const activeId =
    index < results.length ? (results[index] ? `palette-${results[index].id}` : undefined) : activeItem && contentItemId(activeItem)

  // Texto de estado de la búsqueda en mensajes (también lo lee el lector de pantalla).
  const building = status.phase === 'building'
  let statusText = ''
  if (cleared) statusText = t('search.cleared')
  else if (contentOn) {
    if (content.groups.length > 0) {
      statusText = t(content.groups.length === 1 ? 'search.countOneGroup' : 'search.count', {
        count: content.hitCount,
        groups: content.groups.length
      })
      if (building) statusText += ` ${t('search.partial')}`
    } else if (building) statusText = t('search.preparing', { done: status.done, total: status.total })
    else if (status.phase === 'error') statusText = t('search.error')
    else statusText = t('search.none', { query: deferred.trim() })
  } else if (building && query.trim()) statusText = t('search.preparing', { done: status.done, total: status.total })

  let lastGroup = ''
  return (
    <DialogScrim align="top" layer="palette" onDismiss={() => close(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('app.palette.title')}
        onKeyDown={onKeyDown}
        className="flex max-h-[min(540px,78vh)] w-[600px] max-w-full animate-pop-in flex-col overflow-hidden rounded-modal border-0 bg-elevated shadow-modal"
      >
        <div className="flex h-[52px] items-center gap-3 border-b border-border/60 px-4">
          <Search size={20} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('app.palette.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={activeId}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
        </div>

        <div
          role="status"
          aria-live="polite"
          data-testid="palette-search-status"
          className={statusText ? 'flex items-center gap-2 border-b border-border/60 px-4 py-1.5 text-meta text-subtle' : 'sr-only'}
        >
          {building && contentOn && content.groups.length === 0 && <Spinner size={12} />}
          <span>{statusText}</span>
        </div>

        <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-2">
          {total === 0 && !(contentOn && building) && (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center text-subtle">
              <SearchX size={20} aria-hidden />
              <p className="text-ui">{t('app.palette.empty', { query })}</p>
            </div>
          )}
          {results.map((c, i) => {
            const header = c.group !== lastGroup
            lastGroup = c.group
            const Icon = c.icon
            const active = i === index
            return (
              <div key={c.id}>
                {header && <div className={GROUP_LABEL}>{c.group}</div>}
                <button
                  type="button"
                  id={`palette-${c.id}`}
                  role="option"
                  aria-selected={active}
                  data-index={i}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(c)}
                  className={`flex h-8 w-full items-center gap-2 rounded-ctl px-2 text-left text-sm ${active ? 'bg-active text-fg' : 'text-fg'}`}
                >
                  <Icon size={16} className="text-muted" />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint &&
                    (c.hintKind === 'badge' ? (
                      <span className="shrink-0 rounded-full bg-active px-2 h-5 inline-flex items-center text-meta text-muted">
                        {c.hint}
                      </span>
                    ) : (
                      <kbd className="kbd shrink-0 border-0 bg-active text-muted">{c.hint}</kbd>
                    ))}
                </button>
              </div>
            )
          })}
          <ContentResults groups={content.groups} startIndex={results.length} activeIndex={index} onHover={setIndex} onPick={openContent} />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-1.5 text-meta text-subtle">
          <span className="min-w-0 flex-1">
            {t('search.scope', { total: MAX_CONVERSATIONS })}
            {status.failed > 0 && ` ${t('search.failedSome', { count: status.failed })}`}
          </span>
          <button
            type="button"
            data-palette-clear
            title={t('search.clearTitle')}
            onClick={() => {
              clearSearchIndex()
              setCleared(true)
            }}
            className="shrink-0 rounded-ctl-sm px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg"
          >
            {t('search.clear')}
          </button>
        </div>

        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border/60 bg-bg px-4 text-meta text-subtle">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="kbd border-0 bg-active text-muted">↑</kbd>
            <kbd className="kbd border-0 bg-active text-muted">↓</kbd> {t('app.palette.navigate')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="kbd border-0 bg-active text-muted">
              <CornerDownLeft size={10} />
            </kbd>
            {t('app.palette.run')}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <kbd className="kbd border-0 bg-active text-muted">Esc</kbd> {t('app.palette.close')}
          </span>
        </div>
      </div>
    </DialogScrim>
  )
}
