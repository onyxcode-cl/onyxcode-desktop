/** Panel «Resumen» de Code: las mismas tarjetas que el de Overdrive (Ficha del proyecto, Plan, Contexto y Cambios) para el proyecto abierto. */
import { ChevronRight, Gauge, GitCompare, ListChecks } from 'lucide-react'
import { UsageMeter } from '../../../components/UsageMeter'
import { useT } from '../../../lib/i18n'
import { useModeModel } from '../../settings/impl/extras'
import { ProjectCard } from '../../project-profile/ProjectCard'
import { useLinkedFolders } from '../../project-profile/useLinkedFolders'
import { PlanCard } from './PlanCard'
import { useCodeAiGate } from './ComposerControls'
import { useCode } from './store'

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
  const messages = useCode((s) => (sessionID ? s.messages[sessionID] : undefined))
  const model = useCode((s) => s.model)
  const modeModel = useModeModel('code')
  const gate = useCodeAiGate()
  const effective = gate.effective ?? model ?? modeModel
  const togglePanel = useCode((s) => s.togglePanel)
  const hasPlan = useCode((s) => !!(sessionID && s.todos[sessionID]?.length))
  return (
    <div className="h-full overflow-y-auto py-1" data-testid="code-summary">
      {/* En Code el nivel «Total» no se ofrece: el control del equipo es cosa de Tareas. */}
      <ProjectCard folder={directory} full={false} branch={branch} folders={folders} />
      <section className={card}>
        <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
          <ListChecks size={15} className="text-muted" aria-hidden />
          {t('tasks.prog.plan')}
        </h3>
        {sessionID && hasPlan ? <PlanCard sessionID={sessionID} /> : <p className="text-xs text-subtle">{t('tasks.prog.planNone')}</p>}
      </section>
      <section className={card}>
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <Gauge size={15} className="text-muted" aria-hidden />
          {t('tasks.prog.ctxWindow')}
          <span className="ml-auto">
            <UsageMeter messages={messages ?? []} model={effective} directory={directory} />
          </span>
        </h3>
        <p className="mt-1 text-xs text-subtle">{t('tasks.prog.ctxWindow.help')}</p>
      </section>
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
    </div>
  )
}
