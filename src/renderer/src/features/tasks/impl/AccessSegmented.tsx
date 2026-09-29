/** Control segmentado visible: «Sandbox» / «Control total del Mac» (términos del glosario de Tareas). */
import { Loader2, MonitorCog, Shield } from 'lucide-react'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { setAccessMode } from './actions'
import { useTasks } from './store'

export function AccessSegmented({ disabled, compact }: { disabled?: boolean; compact?: boolean }): React.JSX.Element {
  const conn = useTasks((s) => s.conn)
  const phase = useTasks((s) => s.phase)
  const requested = useTasks((s) => s.fullAccess)
  const folder = useTasks((s) => s.folder)
  const full = conn ? conn.fullAccess : requested
  const starting = phase === 'starting'
  const off = disabled || starting || !folder

  const pick = (fullAccess: boolean): void => {
    if (off || (fullAccess === full && phase === 'ready')) return
    void setAccessMode(fullAccess)
  }

  // Flechas izquierda/derecha cambian de opción, como en cualquier grupo de radio.
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      pick(false)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      pick(true)
    }
  }

  const base = 'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed'
  return (
    <div
      role="radiogroup"
      aria-label="Modo de acceso"
      onKeyDown={onKey}
      title={!folder ? 'Elige una carpeta primero' : disabled ? 'Espera a que termine la tarea para cambiar el modo de acceso' : undefined}
      className={`inline-flex items-center gap-0.5 rounded-full border border-border bg-hover/60 p-0.5 ${off ? 'opacity-70' : ''}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={!full}
        tabIndex={!full ? 0 : -1}
        disabled={off}
        onClick={() => pick(false)}
        title={`${TASKS_TERMS.sandbox}: lee y escribe solo dentro de la carpeta elegida y de las carpetas adicionales (sandbox de macOS). Recomendado.`}
        className={`${base} ${!full ? 'bg-elevated text-accent shadow-sm' : 'text-muted hover:text-fg'}`}
      >
        {starting && !requested ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
        {TASKS_TERMS.sandbox}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={full}
        tabIndex={full ? 0 : -1}
        disabled={off}
        onClick={() => pick(true)}
        title={`${TASKS_TERMS.fullControl}: sin sandbox; puede usar ratón, teclado y pantalla, y modificar archivos en cualquier lugar.`}
        className={`${base} ${full ? 'bg-warning/15 text-warning shadow-sm' : 'text-muted hover:text-fg'}`}
      >
        {starting && requested ? <Loader2 size={12} className="animate-spin" /> : <MonitorCog size={12} />}
        {compact ? TASKS_TERMS.fullControlShort : TASKS_TERMS.fullControl}
      </button>
    </div>
  )
}
