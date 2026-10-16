/**
 * Campos editables de una propuesta de skill (nombre/descripción/contenido), compartidos por
 * `SkillProposalCard` (tarea interactiva) y `PendingLearnedReview` (rutina desatendida). Controlado:
 * el padre guarda el estado.
 */
import type { MsgKey } from '@shared/i18n'
import type { SkillProposal, SkillProposalFlag } from '@shared/skill-proposal'
import { useT } from '../../../lib/i18n'

const FLAG_LABEL: Partial<Record<SkillProposalFlag, MsgKey>> = {
  personal: 'tasks.skill.flag.personal',
  inyeccion: 'tasks.skill.flag.inyeccion'
}

export function SkillProposalFields({
  draft,
  onChange
}: {
  draft: SkillProposal
  onChange: (patch: Partial<SkillProposal>) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-2.5">
      <div>
        <label className="text-[11px] desk:text-meta font-medium text-subtle">{t('tasks.skill.nameLabel')}</label>
        <input
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value.slice(0, 64) })}
          className="mt-0.5 w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm outline-none focus:border-border-strong"
        />
      </div>
      <div>
        <label className="text-[11px] desk:text-meta font-medium text-subtle">{t('tasks.skill.descriptionLabel')}</label>
        <textarea
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value.slice(0, 1024) })}
          rows={2}
          className="mt-0.5 w-full resize-y rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-border-strong"
        />
      </div>
      <div>
        <label className="text-[11px] desk:text-meta font-medium text-subtle">{t('tasks.skill.bodyLabel')}</label>
        <textarea
          value={draft.body}
          onChange={(e) => onChange({ body: e.target.value.slice(0, 20_000) })}
          rows={8}
          className="mt-0.5 w-full resize-y rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-border-strong"
        />
      </div>
      {draft.flag && FLAG_LABEL[draft.flag] && <p className="text-xs text-warning">{t(FLAG_LABEL[draft.flag]!)}</p>}
    </div>
  )
}
