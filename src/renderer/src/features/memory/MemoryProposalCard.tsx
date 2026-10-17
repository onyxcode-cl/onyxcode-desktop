/**
 * «La IA propone recordar esto»: tarjeta de aprobación de memoria para Chat y Code (la misma idea que la de Overdrive).
 * El modelo nunca escribe memoria: termina su turno con un bloque ```lazunox-memoria``` y esta tarjeta deja a la persona
 * elegir, editar o descartar. Sin carpeta de proyecto (Chat) solo existe el alcance «para todo»: las propuestas de
 * proyecto se descartan antes de mostrarlas porque no hay dónde guardarlas.
 */
import { useEffect, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { Button } from '../../components/Button'
import { useT } from '../../lib/i18n'
import { lastAssistantEntry, lastAssistantText, type ConversationEntry } from '../../lib/conversation/entries'
import { extractMemoryProposals } from '@shared/memory-proposal'
import { type Draft, LearnedProposalList } from '../tasks/impl/LearnedProposalList'
import { useUi } from '../../stores/ui'
import { saveApprovedMemory } from './memory-client'

/** `undefined` si no hay nada que pintar. Sin `allowProject`, descarta de entrada las propuestas de proyecto. */
export function draftsFrom(messages: ConversationEntry[], allowProject = false): Draft[] | undefined {
  const last = lastAssistantEntry(messages)
  if (!last) return undefined
  const { proposals } = extractMemoryProposals(lastAssistantText(messages))
  const usable = proposals.filter((p) => allowProject || p.alcance === 'usuario')
  if (usable.length === 0) return undefined
  return usable.map((p) => ({ ...p, selected: !p.flag }))
}

export function MemoryProposalCard({
  sessionId,
  messages,
  folder,
  onSaved
}: {
  sessionId: string
  messages: ConversationEntry[]
  /** Carpeta del proyecto de Code; ausente en Chat. */
  folder?: string | null
  onSaved?: () => void
}): React.JSX.Element | null {
  const t = useT()
  const allowProject = !!folder
  const last = lastAssistantEntry(messages)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Draft[] | undefined>(() => draftsFrom(messages, allowProject))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(draftsFrom(messages, allowProject))
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
      await saveApprovedMemory(chosen, folder)
      discard()
      onSaved?.()
    } catch {
      setError(t('tasks.learn.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="memory-proposal-card" className="rounded-xl border border-accent/30 bg-accent-soft/20 p-3.5 desk:rounded-card">
      <div className="flex items-start gap-3 desk:gap-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent desk:h-9 desk:w-9 desk:rounded-[10px]">
          <BrainCircuit size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold desk:text-title-sm">{t('memory.card.title')}</p>
          <p className="mt-0.5 text-xs text-muted">{t('memory.card.hint')}</p>

          <div className="mt-3">
            <LearnedProposalList drafts={drafts} onUpdate={update} scopes={allowProject ? ['usuario', 'proyecto'] : ['usuario']} />
          </div>

          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void save()} disabled={busy}>
              {busy ? t('tasks.learn.saving') : t('tasks.learn.save')}
            </Button>
            <Button variant="ghost" onClick={discard} disabled={busy}>
              {t('tasks.learn.discard')}
            </Button>
            <Button variant="ghost" onClick={() => useUi.getState().openSettingsAt('memory')} disabled={busy}>
              {t('memory.open')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
