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
  UserRound,
  MonitorCog,
  Settings2,
  SlidersHorizontal,
  Users,
  X,
  Zap
} from 'lucide-react'
import { t } from '@shared/i18n'
import { MODE_LABELS, UI_LABELS } from '@shared/labels'
import { ErrorBoundary } from '../../../components/ErrorBoundary'
import { IconButton } from '../../../components/IconButton'
import { useT } from '../../../lib/i18n'
import { useAccountState } from '../../../lib/use-account-state'
import { platformCaps } from '../../../lib/platform'
import { useUi } from '../../../stores/ui'
import { AboutSection } from './AboutSection'
import { AccountSection } from './AccountSection'
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
import { ShortcutsSection } from './ShortcutsSection'
import { UsageSection } from './UsageSection'

export type SettingsSectionId =
  | 'general'
  | 'account'
  | 'models'
  | 'mcp'
  | 'tasks'
  | 'network'
  | 'computer'
  | 'automode'
  | 'browser'
  | 'usage'
  | 'shortcuts'
  | 'diagnostics'
  | 'about'

/** Etiqueta calculada al pintar (sigue al idioma activo). */
const lazy = (key: Parameters<typeof t>[0]) => (): string => t(key)

const SECTIONS: { id: SettingsSectionId; label: () => string; icon: typeof Cpu; View: () => React.JSX.Element }[] = [
  { id: 'general', label: lazy('settings.nav.general'), icon: SlidersHorizontal, View: GeneralSection },
  { id: 'account', label: lazy('settings.nav.account'), icon: UserRound, View: AccountSection },
  { id: 'models', label: lazy('settings.nav.models'), icon: Cpu, View: ModelsSection },
  { id: 'mcp', label: lazy('settings.nav.mcp'), icon: Blocks, View: McpSection },
  { id: 'tasks', label: () => MODE_LABELS.tasks, icon: Users, View: TasksSection },
  { id: 'network', label: () => UI_LABELS.network, icon: Globe, View: NetworkSection },
  { id: 'computer', label: () => UI_LABELS.computer, icon: MonitorCog, View: ComputerSection },
  { id: 'automode', label: () => UI_LABELS.autoMode, icon: Zap, View: AutoModeSection },
  { id: 'browser', label: lazy('settings.nav.browser'), icon: Compass, View: BrowserSection },
  { id: 'usage', label: lazy('settings.nav.usage'), icon: BarChart3, View: UsageSection },
  { id: 'shortcuts', label: lazy('settings.nav.shortcuts'), icon: Keyboard, View: ShortcutsSection },
  { id: 'diagnostics', label: lazy('settings.nav.diagnostics'), icon: LifeBuoy, View: DiagnosticsSection },
  { id: 'about', label: lazy('settings.nav.about'), icon: Info, View: AboutSection }
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
export function SettingsView(props: { initial?: SettingsSectionId } = {}): React.JSX.Element {
  const t = useT()
  return (
    <ErrorBoundary label={t('settings.title')}>
      <SettingsPanel {...props} />
    </ErrorBoundary>
  )
}

function SettingsPanel({ initial }: { initial?: SettingsSectionId } = {}): React.JSX.Element {
  const t = useT()
  const close = useUi((s) => s.openSettings)
  const [chosen, setSection] = useState<SettingsSectionId>(initial ?? initialSection)
  const [account] = useAccountState()
  // «Cuenta» solo si la app exige cuenta; Tareas, su red/modo auto y Control del PC solo donde existen (macOS).
  const caps = platformCaps()
  const sections = SECTIONS.filter(
    (s) =>
      (s.id !== 'account' || account?.required === true) &&
      (!['tasks', 'network', 'automode'].includes(s.id) || caps.tasks) &&
      (s.id !== 'computer' || caps.computer)
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
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-border/70 pr-3 pl-4">
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
          className="w-52 shrink-0 space-y-0.5 overflow-y-auto border-r border-border/70 bg-sidebar/50 p-3"
          aria-label={t('settings.navAria')}
        >
          {sections.map(({ id, label, icon: Icon }) => {
            const active = section === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => select(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13.5px] transition-colors duration-150 ${active ? 'bg-elevated font-medium text-fg shadow-xs ring-1 ring-border/70' : 'text-muted hover:bg-hover hover:text-fg'}`}
              >
                <Icon size={15} className={active ? 'text-accent' : ''} />
                {label()}
              </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div key={section} className="mx-auto w-full max-w-2xl animate-rise-in px-8 py-8">
            <Current />
          </div>
        </div>
      </div>
    </div>
  )
}
