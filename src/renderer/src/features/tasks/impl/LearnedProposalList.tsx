/**
 * Lista editable de propuestas de memoria (casilla + alcance/tipo + texto), compartida por `MemoryProposalCard`
 * (tarea interactiva) y `PendingLearnedReview` (rutina desatendida). Controlado: el padre guarda el estado y
 * decide qué hacer con lo elegido.
 */
import type { MsgKey } from '@shared/i18n'
import type { LearnedMemoryScope, LearnedMemoryType } from '@shared/ipc-tasks'
import type { MemoryProposal, MemoryProposalFlag } from '@shared/memory-proposal'
import { useT } from '../../../lib/i18n'

const TYPES: LearnedMemoryType[] = ['preferencia', 'convencion', 'decision', 'solucion']
const SCOPES: LearnedMemoryScope[] = ['usuario', 'proyecto']
const SCOPE_LABEL: Record<LearnedMemoryScope, MsgKey> = { usuario: 'tasks.learn.scope.usuario', proyecto: 'tasks.learn.scope.proyecto' }
const TYPE_LABEL: Record<LearnedMemoryType, MsgKey> = {
  preferencia: 'tasks.learn.type.preferencia',
  convencion: 'tasks.learn.type.convencion',
  decision: 'tasks.learn.type.decision',
  solucion: 'tasks.learn.type.solucion'
}
/** `secreto` nunca llega a la tarjeta (se descarta al extraer, ver `memory-proposal.ts`): sin texto propio. */
const FLAG_LABEL: Partial<Record<MemoryProposalFlag, MsgKey>> = {
  personal: 'tasks.learn.flag.personal',
  inyeccion: 'tasks.learn.flag.inyeccion'
}

export interface Draft extends MemoryProposal {
  selected: boolean
}

export function LearnedProposalList({
  drafts,
  onUpdate
}: {
  drafts: Draft[]
  onUpdate: (i: number, patch: Partial<Draft>) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((d, i) => (
        <li key={i} className="flex items-start gap-2 rounded-lg border border-border bg-bg p-2.5">
          <input
            type="checkbox"
            checked={d.selected}
            onChange={(e) => onUpdate(i, { selected: e.target.checked })}
            className="mt-1 shrink-0"
            aria-label={t('tasks.learn.saveOne')}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={d.alcance}
                onChange={(e) => onUpdate(i, { alcance: e.target.value as LearnedMemoryScope })}
                className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] text-subtle"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {t(SCOPE_LABEL[s])}
                  </option>
                ))}
              </select>
              <select
                value={d.tipo}
                onChange={(e) => onUpdate(i, { tipo: e.target.value as LearnedMemoryType })}
                className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] text-subtle"
              >
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(TYPE_LABEL[ty])}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={d.texto}
              onChange={(e) => onUpdate(i, { texto: e.target.value.slice(0, 300) })}
              maxLength={300}
              rows={2}
              className="mt-1.5 w-full resize-y rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-border-strong"
            />
            {d.porque && <p className="mt-1 text-xs text-subtle">{d.porque}</p>}
            {d.flag && FLAG_LABEL[d.flag] && <p className="mt-1 text-xs text-warning">{t(FLAG_LABEL[d.flag]!)}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}
