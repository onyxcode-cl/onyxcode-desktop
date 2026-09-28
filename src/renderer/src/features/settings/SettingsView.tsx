import { Monitor, Moon, RotateCw, Sun, X } from 'lucide-react'
import type { ThemePreference } from '@shared/types'
import { Button } from '../../components/Button'
import { IconButton } from '../../components/IconButton'
import { useServer } from '../../stores/server'
import { useSettings } from '../../stores/settings'
import { useUi } from '../../stores/ui'

const THEMES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'system', label: 'Sistema', icon: Monitor },
  { id: 'light', label: 'Claro', icon: Sun },
  { id: 'dark', label: 'Oscuro', icon: Moon }
]

const STATE_LABEL = { stopped: 'Detenido', starting: 'Iniciando…', ready: 'Conectado', error: 'Error' } as const

/** Ajustes (provisorio): apariencia y estado del servidor. Modelos/MCP en fase 3. */
export function SettingsView(): React.JSX.Element {
  const close = useUi((s) => s.openSettings)
  const { settings, update } = useSettings()
  const { status, connection, restart } = useServer()

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-medium">Ajustes</span>
        <IconButton label="Cerrar ajustes" onClick={() => close(false)}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-8 overflow-y-auto px-6 py-8">
        <section>
          <h3 className="mb-3 text-sm font-semibold">Apariencia</h3>
          <div className="flex gap-2">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => void update({ theme: id })}
                className={`flex flex-1 flex-col items-center gap-2 rounded-xl border px-4 py-3 text-sm ${settings.theme === id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-hover'}`}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold">Servidor OpenCode</h3>
          <div className="space-y-1 rounded-xl border border-border p-4 text-sm">
            <div>
              Estado: <span className="font-medium">{STATE_LABEL[status.state]}</span>
              {status.version && <span className="text-muted"> · v{status.version}</span>}
            </div>
            {connection && <div className="font-mono text-xs text-muted">{connection.baseUrl}</div>}
            {status.error && <div className="text-xs whitespace-pre-wrap text-danger">{status.error}</div>}
            <div className="pt-2">
              <Button onClick={() => void restart()}>
                <RotateCw size={14} /> Reiniciar servidor
              </Button>
            </div>
          </div>
        </section>
        <p className="text-xs text-subtle">Modelos, proveedores y servidores MCP: próximamente.</p>
      </div>
    </div>
  )
}
