/**
 * «Code aprendió algo»: igual patrón que `MemoryProposalCard` de Tareas, primera versión para Code
 * (decisión del dueño, 2026-10-07). SOLO alcance global: Code no tiene el concepto de carpeta aprobada de
 * Tareas, así que cualquier propuesta `alcance: 'proyecto'` se descarta antes de mostrarla (no hay dónde
 * validarla). El agente nunca escribe memoria: termina su turno con un bloque ```lazunox-memoria```.
 */
import { useEffect, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { lastAssistantEntry, lastAssistantText } from '../../../lib/conversation/entries'
import { extractMemoryProposals } from '@shared/memory-proposal'
import { type Draft, LearnedProposalList } from '../../tasks/impl/LearnedProposalList'
import { acceptCodeLearnedMemory } from './learned-memory-store'
import type { CodeMessage } from './types'

/** `undefined` si no hay nada que pintar. Descarta de entrada cualquier propuesta `proyecto`: Code v1 no las puede guardar. */
export function draftsFrom(messages: CodeMessage[]): Draft[] | undefined {
  const last = lastAssistantEntry(messages)
  if (!last) return undefined
  const { proposals } = extractMemoryProposals(lastAssistantText(messages))
  const usableOnly = proposals.filter((p) => p.alcance === 'usuario')
  if (usableOnly.length === 0) return undefined
  return usableOnly.map((p) => ({ ...p, selected: !p.flag }))
}

export function CodeMemoryProposalCard({ sessionId, messages }: { sessionId: string; messages: CodeMessage[] }): React.JSX.Element | null {
  const t = useT()
  const last = lastAssistantEntry(messages)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Draft[] | undefined>(() => draftsFrom(messages))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(draftsFrom(messages))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.info.id])

  if (!sessionId || !last || dismissed.has(last.info.id) || !drafts || drafts.length === 0) return null

  const update = (i: number, patch: Partial<Draft>): void => setDrafts((ds) => ds?.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))

  const discard = (): void => setDismissed((s) => new Set(s).add(last.info.id))

  const save = async (): Promise<void> => {
    const chosen = drafts.filter((d) => d.selected && d.texto.trim()).map(({ selected: _s, flag: _f, ...p }) => p)
    if (chosen.length === 0) {
      discard()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await acceptCodeLearnedMemory(chosen)
      discard()
    } catch {
      setError(t('tasks.learn.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft/20 p-3.5 desk:rounded-card">
      <div className="flex items-start gap-3 desk:gap-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent desk:h-9 desk:w-9 desk:rounded-[10px]">
          <BrainCircuit size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold desk:text-title-sm">{t('tasks.learn.cardTitle')}</p>
          <p className="mt-0.5 text-xs text-muted">{t('tasks.learn.cardHint')}</p>

          <div className="mt-3">
            <LearnedProposalList drafts={drafts} onUpdate={update} />
          </div>

          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void save()} disabled={busy}>
              {busy ? t('tasks.learn.saving') : t('tasks.learn.save')}
            </Button>
            <Button variant="ghost" onClick={discard} disabled={busy}>
              {t('tasks.learn.discard')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
