import { useEffect, useState } from 'react'
import {
  BarChart3,
  Blocks,
  Compass,
  Cpu,
  Globe,
  Info,
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
import { ListGroup, ListRow } from '../../../components/mobile/List'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface, platformCaps } from '../../../lib/platform'
import { useUi } from '../../../stores/ui'
import { AboutSection } from './AboutSection'
import { AutoModeSection } from './AutoModeSection'
import { BrowserSection } from './BrowserSection'
import { ComputerSection } from './ComputerSection'
import { DiagnosticsSection } from './DiagnosticsSection'
import { TasksSection } from './TasksSection'
import { initExtrasPrefs } from './extras'
import { GeneralSection } from './GeneralSection'
import { McpSection } from './McpSection'
import { ModelsSection } from './ModelsSection'
import { NetworkSection } from './NetworkSection'
import { LEGACY_MODE } from '../../../../../main/migrations/legacy-names'
import { RemoteSection } from './RemoteSection'
import { ShortcutsSection } from './ShortcutsSection'
import { UsageSection } from './UsageSection'

export type SettingsSectionId =
  | 'general'
  | 'models'
  | 'mcp'
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

const SECTIONS: {
  id: SettingsSectionId
  group: SettingsGroupId
  label: () => string
  icon: typeof Cpu
  View: () => React.JSX.Element
}[] = [
  { id: 'general', group: 'app', label: lazy('settings.nav.general'), icon: SlidersHorizontal, View: GeneralSection },
  { id: 'models', group: 'app', label: lazy('settings.nav.models'), icon: Cpu, View: ModelsSection },
  { id: 'usage', group: 'app', label: lazy('settings.nav.usage'), icon: BarChart3, View: UsageSection },
  { id: 'shortcuts', group: 'app', label: lazy('settings.nav.shortcuts'), icon: Keyboard, View: ShortcutsSection },
  { id: 'tasks', group: 'agents', label: () => MODE_LABELS.tasks, icon: Users, View: TasksSection },
  { id: 'network', group: 'agents', label: () => UI_LABELS.network, icon: Globe, View: NetworkSection },
  { id: 'automode', group: 'agents', label: () => UI_LABELS.autoMode, icon: Zap, View: AutoModeSection },
  { id: 'computer', group: 'agents', label: () => UI_LABELS.computer, icon: MonitorCog, View: ComputerSection },
  { id: 'browser', group: 'agents', label: lazy('settings.nav.browser'), icon: Compass, View: BrowserSection },
  { id: 'mcp', group: 'agents', label: lazy('settings.nav.mcp'), icon: Blocks, View: McpSection },
  { id: 'remote', group: 'connections', label: lazy('remote.nav'), icon: Smartphone, View: RemoteSection },
  { id: 'diagnostics', group: 'help', label: lazy('settings.nav.diagnostics'), icon: LifeBuoy, View: DiagnosticsSection },
  { id: 'about', group: 'help', label: lazy('settings.nav.about'), icon: Info, View: AboutSection }
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
    <div className="px-[var(--m-gutter)] py-4" data-m="settings-list">
      <ListGroup footer={t('mobile.settings.moreOnMac')}>
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
  // Tareas, su red/modo auto y Control del PC solo donde existen (macOS).
  const caps = platformCaps()
  const sections = SECTIONS.filter(
    (s) =>
      (!['tasks', 'network', 'automode'].includes(s.id) || caps.tasks) &&
      (s.id !== 'computer' || caps.computer) &&
      (s.id !== 'remote' || caps.remote) &&
      // PWA del celular: MCP, navegador integrado, atajos de teclado y diagnóstico son del Mac (prohibidos o sin sentido en el celular).
      (!isRemoteSurface() || !['mcp', 'browser', 'shortcuts', 'diagnostics'].includes(s.id))
  )
  const section: SettingsSectionId = sections.some((s) => s.id === chosen) ? chosen : 'general'

  useEffect(() => initExtrasPrefs(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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

  const Current = sections.find((s) => s.id === section)?.View ?? GeneralSection

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-border/70 pr-3 pl-4 desk:border-b-0 desk:pl-[calc(var(--header-inset,0px)+16px)]">
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
          {GROUPS.map((g) => {
            const inGroup = sections.filter((x) => x.group === g.id)
            if (inGroup.length === 0) return null // un grupo vacío no pinta encabezado
            return (
              <div key={g.id} role="group" aria-label={g.label()} className="space-y-0.5">
                <div
                  aria-hidden
                  className="hidden px-3 pt-4 pb-1 text-[11.5px] font-medium text-subtle first:pt-0 desk:flex desk:h-7 desk:items-end desk:px-2 desk:pt-2 desk:pb-0 desk:text-[11px] desk:leading-4 desk:font-semibold desk:tracking-[0.02em]"
                >
                  {g.label()}
                </div>
                {inGroup.map(({ id, label, icon: Icon }) => {
                  const active = section === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => select(id)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13.5px] transition-colors duration-150 desk:h-8 desk:py-0 desk:gap-2 desk:px-2 desk:text-sm ${active ? 'bg-elevated font-medium text-fg shadow-xs ring-1 ring-border/70 desk:bg-active desk:shadow-none desk:ring-0' : 'text-muted hover:bg-hover hover:text-fg'}`}
                    >
                      <Icon size={15} className={active ? 'shrink-0 text-accent desk:size-4' : 'shrink-0 desk:size-4'} />
                      {label()}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div
            key={section}
            className="mx-auto w-full max-w-2xl animate-rise-in px-8 py-8 desk:max-w-[640px] desk:px-8 desk:pt-7 desk:pb-12"
          >
            <Current />
          </div>
        </div>
      </div>
    </div>
  )
}
