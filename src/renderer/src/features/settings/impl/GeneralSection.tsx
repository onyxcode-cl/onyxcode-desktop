import { Monitor, Moon, RotateCw, Sun } from 'lucide-react'
import type { ThemePreference } from '@shared/types'
import { Button } from '../../../components/Button'
import { useServer } from '../../../stores/server'
import { useSettings } from '../../../stores/settings'
import { useExtrasPrefs } from './extras'
import { Badge, Card, ErrorText, Row, SectionHeader, Select, SubTitle, Toggle } from './ui'

const THEMES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'system', label: 'Sistema', icon: Monitor },
  { id: 'light', label: 'Claro', icon: Sun },
  { id: 'dark', label: 'Oscuro', icon: Moon }
]

const STATE: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'muted' }> = {
  stopped: { label: 'Detenido', tone: 'muted' },
  starting: { label: 'Iniciando…', tone: 'warn' },
  ready: { label: 'Conectado', tone: 'ok' },
  error: { label: 'Error', tone: 'error' }
}

export function GeneralSection(): React.JSX.Element {
  const { settings, update } = useSettings()
  const { status, connection, restart } = useServer()
  const showTray = useExtrasPrefs((s) => s.prefs.showTray)
  const updatePrefs = useExtrasPrefs((s) => s.update)
  const st = STATE[status.state] ?? STATE.stopped

  return (
    <div>
      <SectionHeader title="General" description="Apariencia, idioma y servidor local de OpenCode." />

      <h3 className="mb-3 text-sm font-semibold">Tema</h3>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => void update({ theme: id })}
            aria-pressed={settings.theme === id}
            className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${settings.theme === id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-hover'}`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>

      <SubTitle>Preferencias</SubTitle>
      <Card>
        <Row label="Idioma" description="La interfaz está disponible sólo en español por ahora.">
          <Select value="es" disabled className="w-40">
            <option value="es">Español</option>
          </Select>
        </Row>
        <Row label="Icono en la barra de menús" description="Acceso rápido a nueva conversación, Quick Entry y salir.">
          <Toggle checked={showTray} onChange={(v) => void updatePrefs({ showTray: v })} label="Icono en la barra de menús" />
        </Row>
      </Card>

      <SubTitle>Servidor OpenCode</SubTitle>
      <Card>
        <Row
          label={
            <span className="flex items-center gap-2">
              Estado <Badge tone={st.tone}>{st.label}</Badge>
            </span>
          }
          description={
            <>
              {status.version && <span>v{status.version}</span>}
              {connection && <span className="ml-2 font-mono">{connection.baseUrl}</span>}
              {status.restarts > 0 && <span className="ml-2">· {status.restarts} reinicio(s) automáticos</span>}
            </>
          }
        >
          <Button onClick={() => void restart()}>
            <RotateCw size={14} /> Reiniciar
          </Button>
        </Row>
      </Card>
      {status.error && (
        <div className="mt-3">
          <ErrorText>{status.error}</ErrorText>
        </div>
      )}
    </div>
  )
}
