import { useEffect, useMemo, useRef, useState } from 'react'
import '../../../app/mobile/switch.css'
import {
  BarChart3,
  Blocks,
  Compass,
  Cpu,
  Globe,
  Download,
  Info,
  Search,
  BrainCircuit,
  NotebookPen,
  Keyboard,
  LifeBuoy,
  MonitorCog,
  Settings2,
  Smartphone,
  SlidersHorizontal,
  Users,
  X,
  Zap
} from 'lucide-react'
import { t } from '@shared/i18n'
import { MODE_LABELS, UI_LABELS } from '@shared/labels'
import { ErrorBoundary } from '../../../components/ErrorBoundary'
import { IconButton } from '../../../components/IconButton'
import { ConnectionCard } from '../../../app/mobile/ConnectionCard'
import { ListGroup, ListRow } from '../../../components/mobile/List'
import { useT } from '../../../lib/i18n'
import { isMacPlatform, isRemoteSurface, platformCaps } from '../../../lib/platform'
import { useUi } from '../../../stores/ui'
import { AboutSection } from './AboutSection'
import { AutoModeSection } from './AutoModeSection'
import { BrowserSection } from './BrowserSection'
import { ComputerSection } from './ComputerSection'
import { DiagnosticsSection } from './DiagnosticsSection'
import { TasksSection } from './TasksSection'
import { initExtrasPrefs } from './extras'
import { GeneralSection } from './GeneralSection'
import { InstructionsSection } from './InstructionsSection'
import { MemorySection } from './MemorySection'
import { McpSection } from './McpSection'
import { ModelsSection } from './ModelsSection'
import { NetworkSection } from './NetworkSection'
import { LEGACY_MODE } from '../../../../../main/migrations/legacy-names'
import { RemoteSection } from './RemoteSection'
import { ShortcutsSection } from './ShortcutsSection'
import { UsageSection } from './UsageSection'
import { ImportSection } from './ImportSection'
import { buildSearchIndex, findAnchorElement, highlightParts, searchSettings, type SearchEntry } from './search-index'
import { getLang } from '@shared/i18n'

export type SettingsSectionId =
  | 'general'
  | 'instructions'
  | 'memory'
  | 'models'
  | 'mcp'
  | 'import'
  | 'tasks'
  | 'network'
  | 'computer'
  | 'automode'
  | 'browser'
  | 'remote'
  | 'usage'
  | 'shortcuts'
  | 'diagnostics'
  | 'about'

/** Etiqueta calculada al pintar (sigue al idioma activo). */
const lazy = (key: Parameters<typeof t>[0]) => (): string => t(key)

type SettingsGroupId = 'app' | 'agents' | 'connections' | 'help'

/** Grupos de la navegación (F8-B96), en orden; el encabezado solo se pinta en escritorio. */
const GROUPS: { id: SettingsGroupId; label: () => string }[] = [
  { id: 'app', label: lazy('settings.group.app') },
  { id: 'agents', label: lazy('settings.group.agents') },
  { id: 'connections', label: lazy('settings.group.connections') },
  { id: 'help', label: lazy('settings.group.help') }
]

/** Lo que reciben las secciones (la mayoría no lo usa): saltar a otra sección. */
export interface SectionProps {
  goTo?: (id: SettingsSectionId) => void
}

const SECTIONS: {
  id: SettingsSectionId
  group: SettingsGroupId
  label: () => string
  icon: typeof Cpu
  View: (props: SectionProps) => React.JSX.Element
  /** Prefijos de claves i18n que pintan la sección: de aquí sale el índice del buscador (sin copiar textos). */
  keys: readonly string[]
}[] = [
  {
    id: 'general',
    group: 'app',
    label: lazy('settings.nav.general'),
    icon: SlidersHorizontal,
    View: GeneralSection,
    keys: ['settings.general.', 'tasks.learn.', 'settings.extras.']
  },
  {
    id: 'instructions',
    group: 'app',
    label: lazy('settings.nav.instructions'),
    icon: NotebookPen,
    View: InstructionsSection,
    keys: ['instr.']
  },
  { id: 'memory', group: 'app', label: lazy('settings.nav.memory'), icon: BrainCircuit, View: MemorySection, keys: ['memory.'] },
  { id: 'models', group: 'app', label: lazy('settings.nav.models'), icon: Cpu, View: ModelsSection, keys: ['models.'] },
  { id: 'usage', group: 'app', label: lazy('settings.nav.usage'), icon: BarChart3, View: UsageSection, keys: ['settings.usage.'] },
  {
    id: 'shortcuts',
    group: 'app',
    label: lazy('settings.nav.shortcuts'),
    icon: Keyboard,
    View: ShortcutsSection,
    keys: ['settings.shortcuts.']
  },
  { id: 'tasks', group: 'agents', label: () => MODE_LABELS.tasks, icon: Users, View: TasksSection, keys: ['tasksSettings.'] },
  { id: 'network', group: 'agents', label: () => UI_LABELS.network, icon: Globe, View: NetworkSection, keys: ['misc.net.'] },
  { id: 'automode', group: 'agents', label: () => UI_LABELS.autoMode, icon: Zap, View: AutoModeSection, keys: ['misc.auto.'] },
  { id: 'computer', group: 'agents', label: () => UI_LABELS.computer, icon: MonitorCog, View: ComputerSection, keys: ['misc.computer.'] },
  { id: 'browser', group: 'agents', label: lazy('settings.nav.browser'), icon: Compass, View: BrowserSection, keys: ['misc.browser.'] },
  {
    id: 'mcp',
    group: 'agents',
    label: lazy('settings.nav.mcp'),
    icon: Blocks,
    View: McpSection,
    keys: ['mcp.header.', 'mcp.form.', 'mcp.catalog.', 'mcp.flags.', 'mcp.note.', 'mcp.badge.', 'mcp.add', 'mcp.refresh', 'mcp.viewFile']
  },
  {
    id: 'import',
    group: 'agents',
    label: lazy('settings.nav.import'),
    icon: Download,
    View: ImportSection,
    keys: ['import.title', 'import.intro', 'import.source.', 'import.guarantee.']
  },
  {
    id: 'remote',
    group: 'connections',
    label: lazy('remote.nav'),
    icon: Smartphone,
    View: RemoteSection,
    keys: ['remote.devices.', 'remote.qr.', 'remote.conn.', 'remote.travel.', 'remote.state.', 'remote.activity.', 'remote.title']
  },
  {
    id: 'diagnostics',
    group: 'help',
    label: lazy('settings.nav.diagnostics'),
    icon: LifeBuoy,
    View: DiagnosticsSection,
    keys: ['misc.diag.', 'settings.doctor.']
  },
  { id: 'about', group: 'help', label: lazy('settings.nav.about'), icon: Info, View: AboutSection, keys: ['settings.about.'] }
]

const KEY = 'settings.section'

function initialSection(): SettingsSectionId {
  try {
    const v = localStorage.getItem(KEY)
    if (SECTIONS.some((s) => s.id === v)) return v as SettingsSectionId
    if (v === LEGACY_MODE) return 'tasks'
  } catch {
    // sin storage
  }
  return 'general'
}

/** Vista de Ajustes: navegación lateral por secciones. */
export interface SettingsViewProps {
  initial?: SettingsSectionId
  /**
   * Interfaz del celular: una sola columna. Sin `initial` muestra la lista de secciones básicas (`onOpen` apila la elegida en la
   * navegación del shell); con `initial` muestra esa sección. Sin esta propiedad (escritorio) no cambia nada.
   */
  mobile?: { onOpen: (id: SettingsSectionId) => void }
}

export function SettingsView(props: SettingsViewProps = {}): React.JSX.Element {
  const t = useT()
  return (
    <ErrorBoundary label={t('settings.title')}>
      {props.mobile ? <MobileSettings initial={props.initial} onOpen={props.mobile.onOpen} /> : <SettingsPanel {...props} />}
    </ErrorBoundary>
  )
}

/** Secciones de Ajustes que se ofrecen en el celular (tema, idioma y modelos); lo demás se cambia desde el Mac. */
const MOBILE_SECTION_IDS: SettingsSectionId[] = ['general', 'models']

function MobileSettings({ initial, onOpen }: { initial?: SettingsSectionId; onOpen: (id: SettingsSectionId) => void }): React.JSX.Element {
  const t = useT()
  useEffect(() => initExtrasPrefs(), [])
  const sections = SECTIONS.filter((s) => MOBILE_SECTION_IDS.includes(s.id))
  const current = initial ? sections.find((s) => s.id === initial) : undefined
  if (current) {
    const Current = current.View
    return (
      <div className="px-[var(--m-gutter)] pt-2 pb-6">
        <Current />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6 px-[var(--m-gutter)] py-4" data-m="settings-list">
      <ConnectionCard />
      <ListGroup title={t('mobile.more.group.general')} footer={t('mobile.settings.moreOnMac')}>
        {sections.map(({ id, label, icon }) => (
          <ListRow key={id} icon={icon} label={label()} onClick={() => onOpen(id)} />
        ))}
      </ListGroup>
    </div>
  )
}

function SettingsPanel({ initial }: SettingsViewProps = {}): React.JSX.Element {
  const t = useT()
  const close = useUi((s) => s.openSettings)
  const [chosen, setSection] = useState<SettingsSectionId>(initial ?? initialSection)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  /** Opción a la que llevar tras abrir la sección elegida en la búsqueda (`anchor`: texto fijo de la opción). */
  const [target, setTarget] = useState<{ section: SettingsSectionId; anchor: string; nonce: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Tareas, su red/modo auto y Control del PC solo donde existen (macOS).
  const caps = platformCaps()
  const sections = SECTIONS.filter(
    (s) =>
      (!['tasks', 'network', 'automode'].includes(s.id) || caps.tasks) &&
      (s.id !== 'computer' || caps.computer) &&
      (s.id !== 'remote' || caps.remote) &&
      // PWA del celular: MCP, navegador integrado, atajos de teclado y diagnóstico son del Mac (prohibidos o sin sentido en el celular).
      (!isRemoteSurface() || !['mcp', 'import', 'browser', 'shortcuts', 'diagnostics'].includes(s.id))
  )
  const section: SettingsSectionId = sections.some((s) => s.id === chosen) ? chosen : 'general'

  useEffect(() => initExtrasPrefs(), [])

  // Índice del buscador: sale de las claves i18n de cada sección y sigue al idioma activo (`useT` re-renderiza al cambiarlo).
  const lang = getLang()
  const searchSections = sections.map((s) => ({ id: s.id, label: s.label(), prefixes: s.keys }))
  const sectionIds = sections.map((s) => s.id).join(',')
  const index = useMemo(
    () => buildSearchIndex(searchSections, lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionIds, lang]
  )
  const groups = useMemo(() => searchSettings(searchSections, index, query), [index, query, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Resultados planos en el orden en que se pintan (para el teclado). */
  const flat = useMemo(
    () =>
      groups.flatMap((g) => [
        ...(g.titleMatch ? [{ id: `${g.section}:title`, section: g.section, anchor: '', text: g.label }] : []),
        ...g.entries.map((e: SearchEntry<SettingsSectionId>) => ({
          id: `${g.section}:${e.key}`,
          section: g.section,
          anchor: e.anchor,
          text: e.text
        }))
      ]),
    [groups]
  )
  const searching = query.trim().length > 0

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // ⌘F / Ctrl+F dentro de Ajustes: enfoca el buscador (no abre el de la página).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        close(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const select = (id: SettingsSectionId): void => {
    setSection(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // ignorar
    }
  }

  const choose = (r: { section: SettingsSectionId; anchor: string }): void => {
    select(r.section)
    setQuery('')
    setTarget({ section: r.section, anchor: r.anchor, nonce: Date.now() })
  }

  // Lleva a la opción elegida: la sección puede cargar datos antes de pintarla, así que se reintenta unos instantes.
  useEffect(() => {
    if (!target || target.section !== section) return
    let tries = 0
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    let marked: HTMLElement | null = null
    const timer = setInterval(() => {
      tries++
      const root = contentRef.current
      const el = root && target.anchor ? findAnchorElement(root, target.anchor) : null
      if (el) {
        clearInterval(timer)
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
        const focusable = el.matches('button,input,select,textarea,a[href]')
          ? el
          : (el.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea,button,a[href]') ?? el)
        if (focusable === el && !el.matches('button,input,select,textarea,a[href]')) el.tabIndex = -1
        focusable.focus({ preventScroll: true })
        marked = el
        el.setAttribute('data-search-hit', '')
        flashTimer = setTimeout(() => el.removeAttribute('data-search-hit'), 2400)
      } else if (tries >= 12 || !target.anchor) {
        clearInterval(timer)
        contentRef.current?.parentElement?.scrollTo?.({ top: 0 })
      }
    }, 90)
    return () => {
      clearInterval(timer)
      if (flashTimer) clearTimeout(flashTimer)
      marked?.removeAttribute('data-search-hit')
    }
  }, [target, section])

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && flat.length > 0) {
      e.preventDefault()
      setActive((a) => (a + 1) % flat.length)
    } else if (e.key === 'ArrowUp' && flat.length > 0) {
      e.preventDefault()
      setActive((a) => (a - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault()
      choose(flat[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (searching) setQuery('')
      else close(false)
    }
  }

  const goTo = (id: SettingsSectionId): void => select(id)
  const Current = sections.find((s) => s.id === section)?.View ?? GeneralSection

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-border/70 pr-3 pl-4 desk:border-b-0 desk:pl-[calc(var(--header-inset,0px)+16px)] desk:pr-[calc(var(--controls-inset,0px)+12px)]">
        <span className="flex items-center gap-2 text-[13.5px] font-medium">
          <Settings2 size={15} className="text-accent" /> {t('settings.title')}
        </span>
        <span className="flex items-center gap-2">
          <kbd className="kbd">Esc</kbd>
          <IconButton label={t('settings.close')} onClick={() => close(false)}>
            <X size={16} />
          </IconButton>
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          className="w-52 shrink-0 space-y-0.5 overflow-y-auto desk:w-[232px] desk:xl:w-[232px] border-r border-border/70 bg-sidebar/50 p-3 desk:border-r-0 desk:bg-transparent desk:px-3 desk:py-2"
          aria-label={t('settings.navAria')}
        >
          <div className="relative mb-2" role="search">
            <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded={searching}
              aria-controls="settings-search-results"
              aria-activedescendant={searching && flat[active] ? `settings-hit-${active}` : undefined}
              aria-autocomplete="list"
              aria-label={t('settings.search.label')}
              placeholder={t('settings.search.label')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              autoComplete="off"
              spellCheck={false}
              data-testid="settings-search"
              className="h-8 w-full rounded-ctl border border-border-strong bg-elevated pr-14 pl-8 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-subtle hover:border-border-strong focus:border-accent focus:shadow-focus"
            />
            {searching ? (
              <button
                type="button"
                aria-label={t('settings.search.clear')}
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
                className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded text-muted hover:bg-hover hover:text-fg"
              >
                <X size={13} />
              </button>
            ) : (
              <kbd className="kbd pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">{isMacPlatform() ? '⌘F' : 'Ctrl+F'}</kbd>
            )}
          </div>
          {GROUPS.map((g) => {
            const inGroup = sections.filter((x) => x.group === g.id)
            if (inGroup.length === 0) return null // un grupo vacío no pinta encabezado
            return (
              <div key={g.id} role="group" aria-label={g.label()} className="space-y-0.5">
                <div
                  aria-hidden
                  className="hidden px-3 pt-4 pb-1 text-[11.5px] desk:text-meta font-medium text-subtle first:pt-0 desk:flex desk:h-7 desk:items-end desk:px-2 desk:pt-2 desk:pb-0 desk:text-[11px] desk:leading-4 desk:font-semibold desk:tracking-[0.02em]"
                >
                  {g.label()}
                </div>
                {inGroup.map(({ id, label, icon: Icon }) => {
                  const current = section === id && !searching
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setQuery('')
                        select(id)
                      }}
                      aria-current={current ? 'page' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13.5px] transition-colors duration-150 desk:h-8 desk:py-0 desk:gap-2 desk:px-2 desk:text-sm ${current ? 'bg-elevated font-medium text-fg shadow-xs ring-1 ring-border/70 desk:bg-active desk:shadow-none desk:ring-0' : 'text-muted hover:bg-hover hover:text-fg'}`}
                    >
                      <Icon size={15} className={current ? 'shrink-0 text-accent desk:size-4' : 'shrink-0 desk:size-4'} />
                      {label()}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {searching ? (
            <div
              className="mx-auto w-full max-w-2xl px-8 py-8 desk:max-w-[640px] desk:px-8 desk:pt-7 desk:pb-12"
              data-testid="settings-search-panel"
            >
              <p className="sr-only" role="status" aria-live="polite">
                {groups.length === 0
                  ? t('settings.search.empty', { query: query.trim() })
                  : t('settings.search.results', { count: groups.length })}
              </p>
              {groups.length === 0 ? (
                <div
                  className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center"
                  data-testid="settings-search-empty"
                >
                  <p className="text-sm font-medium">{t('settings.search.empty', { query: query.trim() })}</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">{t('settings.search.emptyHelp')}</p>
                </div>
              ) : (
                <div id="settings-search-results" role="listbox" aria-label={t('settings.search.listLabel')} className="space-y-5">
                  {(() => {
                    let n = -1
                    return groups.map((g) => {
                      const Icon = SECTIONS.find((s) => s.id === g.section)?.icon ?? Settings2
                      const rows = [
                        ...(g.titleMatch ? [{ id: `${g.section}:title`, anchor: '', text: g.label, title: true }] : []),
                        ...g.entries.map((e: SearchEntry<SettingsSectionId>) => ({
                          id: `${g.section}:${e.key}`,
                          anchor: e.anchor,
                          text: e.text,
                          title: false
                        }))
                      ]
                      return (
                        <section key={g.section} aria-label={g.label}>
                          <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold tracking-[0.02em] text-subtle">
                            <Icon size={13} aria-hidden /> {g.label}
                          </h3>
                          <ul className="overflow-hidden rounded-xl border border-border bg-elevated">
                            {rows.map((r) => {
                              n++
                              const i = n
                              return (
                                <li key={r.id} role="presentation" className="border-b border-border last:border-b-0">
                                  <button
                                    type="button"
                                    role="option"
                                    id={`settings-hit-${i}`}
                                    aria-selected={i === active}
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => choose({ section: g.section, anchor: r.anchor })}
                                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${i === active ? 'bg-active' : 'hover:bg-hover'}`}
                                  >
                                    <span className="line-clamp-2 min-w-0">
                                      {highlightParts(r.text, query).map((p, k) =>
                                        p.hit ? (
                                          <mark key={k} className="settings-mark">
                                            {p.text}
                                          </mark>
                                        ) : (
                                          <span key={k}>{p.text}</span>
                                        )
                                      )}
                                    </span>
                                    {r.title && <span className="shrink-0 text-xs text-subtle">{t('settings.search.sectionMatch')}</span>}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </section>
                      )
                    })
                  })()}
                </div>
              )}
            </div>
          ) : (
            <div
              ref={contentRef}
              key={section}
              className="mx-auto w-full max-w-2xl animate-rise-in px-8 py-8 desk:max-w-[640px] desk:px-8 desk:pt-7 desk:pb-12"
            >
              <Current goTo={goTo} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
