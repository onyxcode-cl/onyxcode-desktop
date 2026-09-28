import { useEffect, useState } from 'react'
import { Monitor, Moon, RotateCw, Sun } from 'lucide-react'
import type { ThemePreference } from '@shared/types'
import { Button } from '../../../components/Button'
import { cw, hasCoworkBridge } from '../../cowork/impl/bridge'
import { useServer } from '../../../stores/server'
import { useSettings } from '../../../stores/settings'
import { useExtrasPrefs } from './extras'
import { Badge, Card, ErrorText, Row, SectionHeader, Select, SubTitle, Toggle } from './ui'

/** Fila "Mantener el Mac despierto mientras corren tareas de Cowork" (powerSaveBlocker en main). */
function KeepAwakeRow(): React.JSX.Element | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!hasCoworkBridge()) return
    cw('cowork:keepAwakeState')
      .then((st) => setEnabled(st.enabled))
      .catch(() => undefined)
  }, [])

  if (!hasCoworkBridge() || enabled === null) return null

  return (
    <Row
      label="Mantener el Mac despierto"
      description="Evita que el equipo entre en reposo mientras hay tareas de Cowork trabajando en segundo plano."
    >
      <Toggle
        checked={enabled}
        onChange={(v) => {
          setEnabled(v)
          void cw('cowork:keepAwakeSetting', { enabled: v }).catch(() => undefined)
        }}
        label="Mantener el Mac despierto mientras corren tareas"
      />
    </Row>
  )
}

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

/** Mini-maqueta de la ventana en cada tema (colores literales: deben verse aunque el tema activo sea otro). */
function ThemePreview({ kind }: { kind: ThemePreference }): React.JSX.Element {
  const light = { bg: '#f7f8fb', side: '#eff1f6', line: '#dde2ee', accent: '#2c4fd8', bubble: '#e8ecf8' }
  const dark = { bg: '#11131a', side: '#0c0e14', line: '#292e3c', accent: '#7d97ff', bubble: '#1e2331' }
  const pane = (c: typeof light): React.JSX.Element => (
    <div className="flex h-full w-full" style={{ background: c.bg }}>
      <div className="flex w-[30%] flex-col gap-1 p-1.5" style={{ background: c.side }}>
        <div className="h-1.5 w-3 rounded-full" style={{ background: c.accent }} />
        <div className="h-1 w-full rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-3/4 rounded-full" style={{ background: c.line }} />
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1 p-1.5">
        <div className="ml-auto h-2 w-1/2 rounded" style={{ background: c.bubble }} />
        <div className="h-1 w-3/4 rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: c.line }} />
      </div>
    </div>
  )
  return (
    <div className="relative h-16 w-full overflow-hidden rounded-lg border border-border/70">
      {kind === 'dark' ? pane(dark) : pane(light)}
      {kind === 'system' && (
        <div className="absolute inset-0" style={{ clipPath: 'polygon(55% 0, 100% 0, 100% 100%, 45% 100%)' }}>
          {pane(dark)}
        </div>
      )}
    </div>
  )
}

/** Instrucciones globales de Cowork (item 1): se añaden a todas las tareas, junto con las de cada proyecto. */
function CoworkInstructionsRow(): React.JSX.Element {
  const globalInstructions = useSettings((s) => s.settings.coworkGlobalInstructions)
  const update = useSettings((s) => s.update)
  const [value, setValue] = useState(globalInstructions)
  const [saved, setSaved] = useState(false)

  useEffect(() => setValue(globalInstructions), [globalInstructions])

  const save = (): void => {
    if (value === globalInstructions) return
    void update({ coworkGlobalInstructions: value }).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    })
  }

  return (
    <Row
      label="Instrucciones globales de Cowork"
      description="Se aplican a todas las tareas de Cowork, además de las instrucciones de cada proyecto (carpeta)."
    >
      <div className="w-full max-w-md">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          maxLength={20_000}
          placeholder="Ej.: escribe siempre en tono formal; usa formato de fecha es-CL…"
          className="min-h-20 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle"
        />
        {saved && <p className="mt-1 text-xs text-accent">Guardado</p>}
      </div>
    </Row>
  )
}

export function GeneralSection(): React.JSX.Element {
  const { settings, update } = useSettings()
  const { status, connection, restart } = useServer()
  const showTray = useExtrasPrefs((s) => s.prefs.showTray)
  const notificationsEnabled = useExtrasPrefs((s) => s.prefs.notificationsEnabled)
  const soundEnabled = useExtrasPrefs((s) => s.prefs.soundEnabled)
  const updatePrefs = useExtrasPrefs((s) => s.update)
  const st = STATE[status.state] ?? STATE.stopped

  return (
    <div>
      <SectionHeader title="General" description="Apariencia, idioma y servidor local de OpenCode." />

      <h3 className="mb-3 text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">Tema</h3>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => void update({ theme: id })}
            aria-pressed={settings.theme === id}
            className={`group flex flex-col gap-2 rounded-xl border p-2 text-sm transition-[border-color,box-shadow,background-color] ${settings.theme === id ? 'border-accent bg-accent-soft/50 shadow-[0_0_0_3px_var(--accent-ring)]' : 'border-border hover:border-border-strong hover:bg-hover/50'}`}
          >
            <ThemePreview kind={id} />
            <span className="flex items-center justify-center gap-1.5 pb-0.5">
              <Icon size={14} className={settings.theme === id ? 'text-accent' : 'text-muted'} />
              {label}
            </span>
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
        <Row
          label="Notificaciones"
          description="Avisos nativos cuando una sesión de Code o una tarea de Cowork termina o necesita tu aprobación, con badge en el Dock."
        >
          <Toggle checked={notificationsEnabled} onChange={(v) => void updatePrefs({ notificationsEnabled: v })} label="Notificaciones" />
        </Row>
        <Row label="Sonido" description="Reproduce el sonido del sistema al mostrar una notificación.">
          <Toggle
            checked={soundEnabled}
            onChange={(v) => void updatePrefs({ soundEnabled: v })}
            label="Sonido"
            disabled={!notificationsEnabled}
          />
        </Row>
        <KeepAwakeRow />
      </Card>

      <SubTitle>Cowork</SubTitle>
      <Card>
        <CoworkInstructionsRow />
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
