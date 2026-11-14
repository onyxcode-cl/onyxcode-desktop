/** Panel «Resumen» de Code: las mismas tarjetas que el de Overdrive (Ficha del proyecto, Plan, Contexto y Cambios) para el proyecto abierto. */
import { useEffect, useRef } from 'react'
import { ChevronRight, Gauge, GitCompare, ListChecks } from 'lucide-react'
import { ContextDetail } from '../../../components/ContextDetail'
import { UsageMeter } from '../../../components/UsageMeter'
import { ReorderableCards } from '../../../components/ReorderableCards'
import { useT } from '../../../lib/i18n'
import { useModeModel } from '../../settings/impl/extras'
import { ProjectCard } from '../../project-profile/ProjectCard'
import { useLinkedFolders } from '../../project-profile/useLinkedFolders'
import { PlanCard } from './PlanCard'
import { useCodeAiGate } from './ComposerControls'
import { selectCodeRunOf, useCode } from './store'
import { CodeBackgroundJobs, useCodeBackgroundJobs } from './BackgroundJobsConnectors'

const card = 'mx-3 my-2 rounded-xl border border-border bg-elevated/60 p-3.5 text-sm text-fg'

export function CodeSummary({
  directory,
  branch,
  changes
}: {
  directory: string
  branch: string | null
  changes: number
}): React.JSX.Element {
  const t = useT()
  const folders = useLinkedFolders(directory)
  const sessionID = useCode((s) => s.activeSessionID)
  const run = useCode((s) => selectCodeRunOf(s, sessionID))
  const jobs = useCodeBackgroundJobs()
  const jobsRef = useRef<HTMLDivElement>(null)
  const focusRequest = jobs?.focusRequest ?? 0
  useEffect(() => {
    if (!focusRequest) return
    jobsRef.current?.scrollIntoView?.({ block: 'nearest' })
    jobsRef.current?.focus({ preventScroll: true })
  }, [focusRequest])
  const messages = useCode((s) => (sessionID ? s.messages[sessionID] : undefined))
  const model = useCode((s) => s.model)
  const modeModel = useModeModel('code')
  const gate = useCodeAiGate()
  const effective = gate.effective ?? model ?? modeModel
  const togglePanel = useCode((s) => s.togglePanel)
  const hasPlan = useCode((s) => !!(sessionID && s.todos[sessionID]?.length))
  return (
    <div className="h-full overflow-y-auto py-1" data-testid="code-summary">
      <ReorderableCards
        mode="code"
        cards={[
          {
            id: 'project',
            label: t('project.card.title'),
            content: <ProjectCard folder={directory} full={false} branch={branch} folders={folders} />
          },
          {
            id: 'plan',
            label: t('tasks.prog.plan'),
            content: (
              <section className={card}>
                <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
                  <ListChecks size={15} className="text-muted" aria-hidden />
                  {t('tasks.prog.plan')}
                </h3>
                {sessionID && hasPlan ? (
                  <PlanCard sessionID={sessionID} busy={run === 'busy' || run === 'retry'} />
                ) : (
                  <p className="text-xs text-subtle">{t('tasks.prog.planNone')}</p>
                )}
              </section>
            )
          },
          {
            id: 'background',
            label: t('helpers.backgroundCard.title'),
            content: (
              <div ref={jobsRef} tabIndex={-1} data-testid="code-summary-jobs" className="outline-none">
                <CodeBackgroundJobs />
              </div>
            )
          },
          {
            id: 'context',
            label: t('tasks.prog.ctxWindow'),
            content: (
              <section className={card}>
                <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                  <Gauge size={15} className="text-muted" aria-hidden />
                  {t('tasks.prog.ctxWindow')}
                  <span className="ml-auto">
                    <UsageMeter messages={messages ?? []} model={effective} />
                  </span>
                </h3>
                <p className="mt-1 text-xs text-subtle">{t('tasks.prog.ctxWindow.help')}</p>
                <ContextDetail messages={messages ?? []} model={effective} directory={directory} />
              </section>
            )
          },
          {
            id: 'changes',
            label: t('code.panel.changes'),
            content: (
              <button
                type="button"
                onClick={() => togglePanel('changes')}
                className={`no-drag ${card} flex w-[calc(100%-1.5rem)] items-center gap-2 text-left hover:bg-hover`}
              >
                <GitCompare size={15} className="text-muted" aria-hidden />
                <span className="text-[13px] font-semibold">{t('code.panel.changes')}</span>
                {changes > 0 && <span className="rounded-full bg-active px-1.5 text-meta font-medium tabular-nums">{changes}</span>}
                <ChevronRight size={14} className="ml-auto text-subtle" aria-hidden />
              </button>
            )
          }
        ]}
      />
    </div>
  )
}
