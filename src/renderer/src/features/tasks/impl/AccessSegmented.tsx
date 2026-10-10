/** Control segmentado visible: «Sandbox» / «Control total del Mac» (términos del glosario de Tareas). */
import { Loader2, MonitorCog, Shield } from 'lucide-react'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { useT } from '../../../lib/i18n'
import { platformCaps } from '../../../lib/platform'
import { setAccessMode } from './actions'
import { useTasks } from './store'

export function AccessSegmented({
  disabled,
  compact,
  list
}: {
  disabled?: boolean
  compact?: boolean
  /** Filas apiladas con una línea de explicación por modo (inicio de Tareas), en vez de la píldora compacta. */
  list?: boolean
}): React.JSX.Element | null {
  const t = useT()
  const conn = useTasks((s) => s.conn)
  const phase = useTasks((s) => s.phase)
  const requested = useTasks((s) => s.fullAccess)
  const folder = useTasks((s) => s.folder)
  const full = conn ? conn.fullAccess : requested
  const starting = phase === 'starting'
  // Control total no necesita carpeta (trabaja en la carpeta personal por defecto); Sandbox sí la pide al enviar.
  const off = disabled || starting
  // Sin Control del PC (Windows) solo existe el modo aislado: un selector de una sola opción no haría nada.
  if (!platformCaps().computer) return null

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

  if (list) {
    const row = (active: boolean, danger: boolean): string =>
      `flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition disabled:cursor-not-allowed ${
        active ? (danger ? 'border-warning/50 bg-warning/10' : 'border-accent/50 bg-accent-soft/50') : 'border-border hover:bg-hover'
      }`
    return (
      <div
        role="radiogroup"
        aria-label={t('tasksComputer.access.aria')}
        onKeyDown={onKey}
        title={disabled ? t('tasksComputer.access.waitTask') : undefined}
        className={`mx-auto grid w-full max-w-3xl gap-2 px-6 sm:grid-cols-2 ${off ? 'opacity-70' : ''}`}
      >
        <button
          type="button"
          role="radio"
          aria-checked={!full}
          tabIndex={!full ? 0 : -1}
          disabled={off}
          onClick={() => pick(false)}
          title={!folder ? t('tasksComputer.access.pickFolder') : t('tasksComputer.access.sandboxTitle', { name: TASKS_TERMS.sandbox })}
          className={row(!full, false)}
        >
          <span className={`mt-0.5 shrink-0 ${!full ? 'text-accent' : 'text-muted'}`}>
            {starting && !requested ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{TASKS_TERMS.sandbox}</span>
            <span className="block text-xs text-muted">{t('tasksComputer.access.sandboxDesc')}</span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={full}
          tabIndex={full ? 0 : -1}
          disabled={off}
          onClick={() => pick(true)}
          title={t('tasksComputer.access.fullTitle', { name: TASKS_TERMS.fullControl })}
          className={row(full, true)}
        >
          <span className="mt-0.5 shrink-0 text-warning">
            {starting && requested ? <Loader2 size={16} className="animate-spin" /> : <MonitorCog size={16} />}
          </span>
          <span className="min-w-0">
            <span className={`block text-sm font-medium ${full ? 'text-warning' : ''}`}>{TASKS_TERMS.fullControl}</span>
            <span className="block text-xs text-muted">{t('tasksComputer.access.fullDesc')}</span>
          </span>
        </button>
      </div>
    )
  }

  const base = 'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed'
  return (
    <div
      role="radiogroup"
      aria-label={t('tasksComputer.access.aria')}
      onKeyDown={onKey}
      title={disabled ? t('tasksComputer.access.waitTask') : undefined}
      className={`inline-flex items-center gap-0.5 rounded-full border border-border bg-hover/60 p-0.5 ${off ? 'opacity-70' : ''}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={!full}
        tabIndex={!full ? 0 : -1}
        disabled={off}
        onClick={() => pick(false)}
        title={!folder ? t('tasksComputer.access.pickFolder') : t('tasksComputer.access.sandboxTitle', { name: TASKS_TERMS.sandbox })}
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
        title={t('tasksComputer.access.fullTitle', { name: TASKS_TERMS.fullControl })}
        className={`${base} ${full ? 'bg-warning/15 text-warning shadow-sm' : 'text-muted hover:text-fg'}`}
      >
        {starting && requested ? <Loader2 size={12} className="animate-spin" /> : <MonitorCog size={12} />}
        {compact ? TASKS_TERMS.fullControlShort : TASKS_TERMS.fullControl}
      </button>
    </div>
  )
}
