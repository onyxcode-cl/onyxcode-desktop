import { useEffect, useState } from 'react'
import { BarChart3, Blocks, Cpu, Info, Keyboard, SlidersHorizontal, X } from 'lucide-react'
import { IconButton } from '../../../components/IconButton'
import { useUi } from '../../../stores/ui'
import { AboutSection } from './AboutSection'
import { initExtrasPrefs } from './extras'
import { GeneralSection } from './GeneralSection'
import { McpSection } from './McpSection'
import { ModelsSection } from './ModelsSection'
import { ShortcutsSection } from './ShortcutsSection'
import { UsageSection } from './UsageSection'

export type SettingsSectionId = 'general' | 'models' | 'mcp' | 'usage' | 'shortcuts' | 'about'

const SECTIONS: { id: SettingsSectionId; label: string; icon: typeof Cpu; View: () => React.JSX.Element }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, View: GeneralSection },
  { id: 'models', label: 'Modelos', icon: Cpu, View: ModelsSection },
  { id: 'mcp', label: 'MCP', icon: Blocks, View: McpSection },
  { id: 'usage', label: 'Uso', icon: BarChart3, View: UsageSection },
  { id: 'shortcuts', label: 'Atajos', icon: Keyboard, View: ShortcutsSection },
  { id: 'about', label: 'Acerca de', icon: Info, View: AboutSection }
]

const KEY = 'settings.section'

function initialSection(): SettingsSectionId {
  try {
    const v = localStorage.getItem(KEY)
    if (SECTIONS.some((s) => s.id === v)) return v as SettingsSectionId
  } catch {
    // sin storage
  }
  return 'general'
}

/** Vista de Ajustes: navegación lateral por secciones. */
export function SettingsView({ initial }: { initial?: SettingsSectionId } = {}): React.JSX.Element {
  const close = useUi((s) => s.openSettings)
  const [section, setSection] = useState<SettingsSectionId>(initial ?? initialSection)

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

  const Current = SECTIONS.find((s) => s.id === section)?.View ?? GeneralSection

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-medium">Ajustes</span>
        <IconButton label="Cerrar ajustes (Esc)" onClick={() => close(false)}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 space-y-0.5 overflow-y-auto border-r border-border p-3" aria-label="Secciones de ajustes">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-current={section === id ? 'page' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm transition ${section === id ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-8 py-8">
            <Current />
          </div>
        </div>
      </div>
    </div>
  )
}
