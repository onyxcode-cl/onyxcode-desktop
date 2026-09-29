/**
 * Barra del agente (B.9): visible mientras el agente controla la pestaña o está en pausa.
 * Si el usuario toca la página durante una acción del agente, `userActive` lo indica y se
 * muestra "El agente espera" en vez de la barra normal, durante los ~3 s que dura la señal.
 */
import { Bot, Pause, Square } from 'lucide-react'
import type { BrowserOwnerState } from '@shared/ipc-browser'

export function AgentBar({
  control,
  agentLabel,
  userActive,
  onPause,
  onResume,
  onStop
}: {
  control: BrowserOwnerState['control']
  agentLabel: string | null
  userActive: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
}): React.JSX.Element | null {
  if (control === 'idle') return null

  if (control === 'paused') {
    return (
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-hover px-3 text-xs">
        <Bot size={13} className="shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 text-muted">Pausado</span>
        <button type="button" onClick={onResume} className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-accent-soft">
          Reanudar
        </button>
      </div>
    )
  }

  if (userActive) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 text-xs text-warning">
        <Bot size={13} className="shrink-0" />
        <span className="min-w-0 flex-1">Estás usando el navegador: el agente espera</span>
      </div>
    )
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-accent/30 bg-accent-soft/40 px-3 text-xs">
      <Bot size={13} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-fg/90">El agente está usando esta pestaña{agentLabel ? ` · ${agentLabel}` : ''}</span>
      <button
        type="button"
        onClick={onPause}
        title="Pausar"
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 font-medium text-muted hover:bg-hover hover:text-fg"
      >
        <Pause size={12} /> Pausar
      </button>
      <button
        type="button"
        onClick={onStop}
        title="Detener"
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 font-medium text-danger hover:bg-danger/10"
      >
        <Square size={10} fill="currentColor" /> Detener
      </button>
    </div>
  )
}
