/** Tarjeta de «trabajo en curso»: la gema con su chispa, lo que hace el agente en palabras llanas, el avance del plan y el tiempo. */
import { useEffect, useMemo, useState } from 'react'
import { useT } from '../../../lib/i18n'
import type { MessageEntry } from '../../../lib/session-reducer'
import { LogoMark } from '../../../components/Logo'
import { useTasks } from './store'
import { buildContext, friendlyTool } from './util'
import { formatElapsed, turnEntries, workProgress, type WorkPhase } from './work-progress'
import { useShowPath } from './conn-paths'

const PHASES: WorkPhase[] = ['gather', 'create', 'review']

export function WorkingCard({ entries }: { entries: MessageEntry[] }): React.JSX.Element {
  const t = useT()
  const showPath = useShowPath()
  // Todo se calcula solo del turno actual: un plan de una petición anterior no cuenta.
  const w = workProgress(entries)
  const { tool, total, startedAt, steps, currentIdx, partial, toolCount, activity, target, phase } = w
  const sessionID = entries[0]?.info.sessionID
  const created = useTasks((s) => (sessionID ? s.deliverables[sessionID] : undefined))
  const ctx = useMemo(() => buildContext(turnEntries(entries)), [entries])
  // El reloj arranca al montar (no en el render): el marcado estático de las pruebas no depende de la hora.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  // Con el modo control activo la tarjeta lo dice con el mismo vocabulario que el distintivo del encabezado.
  const using = useTasks((s) => now !== null && !!s.lastAction && now - s.lastAction.at < 15_000 && s.conn?.fullAccess === true)
  const hasPlan = total > 0
  const createdCount = Math.max(ctx.filesWritten.length, startedAt === null ? 0 : (created ?? []).filter((f) => f.mtime >= startedAt).length)
  // Título = lo que hace ahora; sin herramienta, el paso en curso del plan; si no, «Pensando».
  let headline: string
  if (activity === 'read') headline = target ? t('tasks.work.reading', { name: target }) : t('tasks.work.readingMany')
  else if (activity === 'write') headline = target ? t('tasks.work.writing', { name: target }) : t('tasks.work.writingDoc')
  else if (activity === 'verify') headline = t('tasks.work.verifying')
  else if (activity === 'web') headline = t('tasks.work.web')
  else if (tool) {
    const f = friendlyTool(tool, showPath)
    headline = `${f.verb} ${f.detail}`.trim()
  } else headline = currentIdx >= 0 ? steps[currentIdx]!.content : t('tasks.conv.thinking')
  // Sin puntos finales propios: la tarjeta anima los suyos.
  headline = headline.replace(/[….\s]+$/, '')
  const sub: string[] = []
  if (hasPlan) {
    const doneN = steps.filter((x) => x.status === 'completed').length
    sub.push(t('tasks.work.stepOf', { n: Math.min((currentIdx >= 0 ? currentIdx : doneN) + 1, total), total }))
    if (toolCount > 0) sub.push(t(toolCount === 1 ? 'tasks.work.actions.one' : 'tasks.work.actions.many', { n: toolCount }))
  } else {
    if (toolCount > 0) sub.push(t(toolCount === 1 ? 'tasks.work.actions.one' : 'tasks.work.actions.many', { n: toolCount }))
    const r = ctx.filesRead.length
    if (r > 0) sub.push(t(r === 1 ? 'tasks.work.filesRead.one' : 'tasks.work.filesRead.many', { n: r }))
    if (createdCount > 0) sub.push(t(createdCount === 1 ? 'tasks.work.filesCreated.one' : 'tasks.work.filesCreated.many', { n: createdCount }))
  }
  if (startedAt !== null && now !== null) sub.push(formatElapsed(now - startedAt))
  const phaseIdx = PHASES.indexOf(phase)
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
          <p className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-meta text-muted tabular-nums">
            <span className="min-w-0 truncate">{sub.join(' · ')}</span>
            {using && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 font-medium text-warning">{t('tasksComputer.chip.using')}</span>
              </>
            )}
          </p>
        </div>
      </div>
      {hasPlan ? (
        <>
          <div className="mt-3 flex gap-1" aria-hidden data-testid="work-segments">
            {steps.map((st, i) => (
              <div key={i} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-hover">
                {st.status === 'completed' ? (
                  <div className="h-full w-full rounded-full bg-success" />
                ) : i === currentIdx && partial > 0 ? (
                  <div className="work-bar h-full rounded-full" style={{ width: `${Math.round(partial * 100)}%` }} />
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-2 truncate whitespace-nowrap text-meta text-muted" aria-label={t('tasks.work.stepsLabel')}>
            {steps.map((st, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden> · </span>}
                <span className={i === currentIdx ? 'font-medium text-fg' : ''}>{st.content}</span>
                {st.status === 'completed' && <span aria-hidden> ✓</span>}
              </span>
            ))}
          </p>
        </>
      ) : (
        <>
          {toolCount > 0 && (
            <div className="mt-3 flex gap-1.5 overflow-hidden whitespace-nowrap" aria-label={t('tasks.work.phasesLabel')}>
              {PHASES.map((ph, i) => (
                <span
                  key={ph}
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-meta ${
                    i === phaseIdx
                      ? 'border-accent/40 bg-accent-soft font-medium text-fg'
                      : i < phaseIdx
                        ? 'border-success/40 text-success'
                        : 'border-border text-muted'
                  }`}
                >
                  {i < phaseIdx && <span aria-hidden>✓ </span>}
                  {t(`tasks.work.phase.${ph}` as const)}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-hover" aria-hidden>
            <div className="work-bar work-bar-indeterminate h-full w-1/3 rounded-full" />
          </div>
        </>
      )}
    </div>
  )
}
