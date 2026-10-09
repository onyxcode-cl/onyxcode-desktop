/**
 * Pendientes de revisar (decisión del dueño, 2026-10-07): lo que una RUTINA propuso en una ejecución
 * desatendida (nadie mirando en el momento) queda acá hasta que el dueño lo revise. Mismo patrón que
 * `MemoryProposalCard`/`SkillProposalCard` (nunca se guarda sin aprobar), reutilizando sus piezas editables.
 * Un ítem puede traer memoria y skill a la vez: cada parte se aprueba o descarta por separado.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, BrainCircuit, Inbox, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import type { PendingLearnedItem } from '@shared/learned-pending'
import { type Draft, LearnedProposalList } from '../../tasks/impl/LearnedProposalList'
import { SkillProposalFields } from '../../tasks/impl/SkillProposalFields'
import type { SkillProposal } from '@shared/skill-proposal'
import { fullDate } from './schedule'
import {
  acceptPendingMemory,
  acceptPendingSkill,
  ackPendingDropped,
  discardAllPendingItems,
  discardPendingItem,
  loadPendingLearned,
  subscribePendingLearned,
  usePendingLearned
} from './pending-store'

function MemoryPart({ item }: { item: PendingLearnedItem }): React.JSX.Element | null {
  const t = useT()
  const [drafts, setDrafts] = useState<Draft[]>(() => (item.proposals ?? []).map((p) => ({ ...p, selected: !p.flag })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!item.proposals || item.proposals.length === 0) return null

  const update = (i: number, patch: Partial<Draft>): void => setDrafts((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))

  const save = async (): Promise<void> => {
    const chosen = drafts.filter((d) => d.selected && d.texto.trim()).map(({ selected: _s, flag: _f, ...p }) => p)
    if (chosen.length === 0) {
      await discardPendingItem(item.id)
      return
    }
    setBusy(true)
    setError(null)
    const ok = await acceptPendingMemory(item.id, chosen)
    setBusy(false)
    if (!ok) setError(t('tasks.learn.saveFailed'))
  }

  return (
    <div className="mt-3 border-t border-border pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
        <BrainCircuit size={13} /> {t('routines.pending.memoryTitle')}
      </p>
      <div className="mt-2">
        <LearnedProposalList drafts={drafts} onUpdate={update} />
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void save()} disabled={busy}>
          {busy ? t('tasks.learn.saving') : t('tasks.learn.save')}
        </Button>
        <Button variant="ghost" onClick={() => void discardPendingItem(item.id)} disabled={busy}>
          {t('tasks.learn.discard')}
        </Button>
      </div>
    </div>
  )
}

function SkillPart({ item }: { item: PendingLearnedItem }): React.JSX.Element | null {
  const t = useT()
  const [draft, setDraft] = useState<SkillProposal | undefined>(item.skill)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!item.skill || !draft) return null

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await acceptPendingSkill(item.id, { name: draft.name, description: draft.description, body: draft.body })
    setBusy(false)
    if (res.ok) return
    if (res.reason === 'ya-existe') setError(t('tasks.skill.alreadyExists'))
    else if (res.reason === 'nombre-invalido') setError(t('tasks.skill.invalidName'))
    else if (res.reason === 'carpeta-no-aprobada') setError(t('routines.pending.folderGone'))
    else setError(t('tasks.skill.saveFailed'))
  }

  return (
    <div className="mt-3 border-t border-border pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
        <Sparkles size={13} /> {t('routines.pending.skillTitle')}
      </p>
      <div className="mt-2">
        <SkillProposalFields draft={draft} onChange={(patch) => setDraft((d) => d && { ...d, ...patch })} />
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void save()} disabled={busy || !draft.name.trim()}>
          {busy ? t('tasks.skill.saving') : t('tasks.skill.save')}
        </Button>
        <Button variant="ghost" onClick={() => void discardPendingItem(item.id)} disabled={busy}>
          {t('tasks.skill.discard')}
        </Button>
      </div>
    </div>
  )
}

function PendingItemCard({ item }: { item: PendingLearnedItem }): React.JSX.Element {
  const t = useT()
  return (
    <li className="rounded-lg border border-border bg-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted">{t('routines.pending.from', { name: item.routineName, when: fullDate(item.createdAt) })}</p>
        <button
          type="button"
          onClick={() => void discardPendingItem(item.id)}
          aria-label={t('tasks.learn.discard')}
          className="shrink-0 rounded-md p-1 text-subtle hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <MemoryPart item={item} />
      <SkillPart item={item} />
    </li>
  )
}

export function PendingLearnedReview(): React.JSX.Element | null {
  const t = useT()
  const state = usePendingLearned((s) => s.state)

  useEffect(() => {
    void loadPendingLearned()
    return subscribePendingLearned()
  }, [])

  if (state.items.length === 0 && state.dropped === 0) return null

  return (
    <div className="mx-auto mb-5 max-w-5xl rounded-xl border border-accent/30 bg-accent-soft/20 p-3.5 desk:max-w-[760px] desk:rounded-card">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Inbox size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t('routines.pending.heading', { count: state.items.length })}</p>
            {state.items.length > 0 && (
              <button
                type="button"
                onClick={() => void discardAllPendingItems()}
                className="flex items-center gap-1 text-xs font-medium text-muted hover:text-danger"
              >
                <Trash2 size={12} /> {t('routines.pending.discardAll')}
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">{t('routines.pending.hint')}</p>

          {state.dropped > 0 && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
              <AlertTriangle size={13} className="shrink-0" />
              <span className="min-w-0 flex-1">{t('routines.pending.droppedWarn', { count: state.dropped })}</span>
              <button type="button" className="shrink-0 font-medium underline" onClick={() => void ackPendingDropped()}>
                {t('routines.pending.ackDropped')}
              </button>
            </div>
          )}

          {state.items.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {state.items.map((item) => (
                <PendingItemCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
