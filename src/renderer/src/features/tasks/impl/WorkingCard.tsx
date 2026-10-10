/** Tarjeta de «trabajo en curso»: la gema con su chispa, lo que hace el agente en palabras llanas, el avance del plan y el tiempo. */
import { useEffect, useState } from 'react'
import { useT } from '../../../lib/i18n'
import type { MessageEntry } from '../../../lib/session-reducer'
import { LogoMark } from '../../../components/Logo'
import { useTasks } from './store'
import { friendlyTool } from './util'
import { formatElapsed, workProgress } from './work-progress'
import { useShowPath } from './conn-paths'

export function WorkingCard({ entries }: { entries: MessageEntry[] }): React.JSX.Element {
  const t = useT()
  const showPath = useShowPath()
  const { tool, done, total, startedAt } = workProgress(entries)
  // El reloj arranca al montar (no en el render): el marcado estático de las pruebas no depende de la hora.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  // Con el modo control activo la tarjeta lo dice con el mismo vocabulario que el distintivo del encabezado.
  const using = useTasks((s) => now !== null && !!s.lastAction && now - s.lastAction.at < 15_000 && s.conn?.fullAccess === true)
  const current = tool ? friendlyTool(tool, showPath) : null
  const headline = current ? `${current.verb} ${current.detail}`.trim() : t('tasks.conv.thinking')
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="working-card"
      className="animate-rise-in rounded-card border border-accent/25 bg-gradient-to-br from-accent-soft/50 to-transparent p-3.5 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <LogoMark size={30} animated />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">
            {headline}
            <span className="work-dots" aria-hidden />
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-meta text-muted tabular-nums">
            {total > 0 && <span>{t('tasks.work.step', { done: Math.min(done + 1, total), total })}</span>}
            {total > 0 && startedAt !== null && now !== null && <span aria-hidden>·</span>}
            {startedAt !== null && now !== null && <span>{formatElapsed(now - startedAt)}</span>}
            {using && (
              <>
                <span aria-hidden>·</span>
                <span className="font-medium text-warning">{t('tasksComputer.chip.using')}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-hover" aria-hidden>
        <div
          className={`work-bar h-full rounded-full ${pct === null ? 'work-bar-indeterminate w-1/3' : ''}`}
          style={pct === null ? undefined : { width: `${Math.max(pct, 6)}%` }}
        />
      </div>
    </div>
  )
}
