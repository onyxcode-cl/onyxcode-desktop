/** Control segmentado visible: "Solo carpeta (sandbox)" / "Control total del Mac". */
import { Loader2, MonitorCog, Shield } from 'lucide-react'
import { setAccessMode } from './actions'
import { useCowork } from './store'

export function AccessSegmented({ disabled, compact }: { disabled?: boolean; compact?: boolean }): React.JSX.Element {
  const conn = useCowork((s) => s.conn)
  const phase = useCowork((s) => s.phase)
  const requested = useCowork((s) => s.fullAccess)
  const folder = useCowork((s) => s.folder)
  const full = conn ? conn.fullAccess : requested
  const starting = phase === 'starting'
  const off = disabled || starting || !folder

  const pick = (fullAccess: boolean): void => {
    if (off || (fullAccess === full && phase === 'ready')) return
    void setAccessMode(fullAccess)
  }

  const base =
    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed'
  return (
    <div
      role="radiogroup"
      aria-label="Modo de acceso"
      title={
        !folder
          ? 'Elige una carpeta primero'
          : disabled
            ? 'Espera a que termine la tarea para cambiar el modo de acceso'
            : undefined
      }
      className={`inline-flex items-center gap-0.5 rounded-full border border-border bg-hover/60 p-0.5 ${off ? 'opacity-70' : ''}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={!full}
        disabled={off}
        onClick={() => pick(false)}
        title="Lee y escribe solo dentro de la carpeta elegida (sandbox de macOS). Recomendado."
        className={`${base} ${!full ? 'bg-elevated text-accent shadow-sm' : 'text-muted hover:text-fg'}`}
      >
        {starting && !requested ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
        {compact ? 'Sandbox' : 'Solo carpeta (sandbox)'}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={full}
        disabled={off}
        onClick={() => pick(true)}
        title="Sin sandbox: puede usar ratón, teclado y pantalla, y modificar archivos en cualquier lugar."
        className={`${base} ${full ? 'bg-amber-500/15 text-amber-600 shadow-sm [[data-theme=dark]_&]:text-amber-400' : 'text-muted hover:text-fg'}`}
      >
        {starting && requested ? <Loader2 size={12} className="animate-spin" /> : <MonitorCog size={12} />}
        {compact ? 'Control total' : 'Control total del Mac'}
      </button>
    </div>
  )
}
