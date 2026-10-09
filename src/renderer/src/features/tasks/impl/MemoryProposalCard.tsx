/**
 * «La tarea aprendió algo»: el agente de Tareas no escribe memoria él mismo (ni la vieja ni la aprendida);
 * cuando quiere recordar algo, termina su turno con un bloque ```lazunox-memoria``` (ver
 * `@shared/memory-proposal`). Esta tarjeta lo muestra bajo el último mensaje de una tarea terminada: cada
 * propuesta es editable y con casilla, nada se guarda hasta pulsar «Guardar seleccionadas». Mismo patrón
 * que `EscalateCard`: nunca se guarda en silencio.
 */
import { useEffect, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import type { LearnedMemoryProposal } from '@shared/ipc-tasks'
import { extractMemoryProposals } from '@shared/memory-proposal'
import { loadPendingLearned, subscribePendingLearned, usePendingLearned } from '../../routines/impl/pending-store'
import { cw } from './bridge'
import { lastAssistantEntry, lastAssistantText } from './EscalateCard'
import { type Draft, LearnedProposalList } from './LearnedProposalList'
import { loadProjectAndMemory } from './store'

export type { Draft }

/** `undefined` si no hay (quien llama no pinta nada), para no confundirlo con "sin propuestas tras extraer". */
export function draftsFrom(entries: MessageEntry[]): Draft[] | undefined {
  const last = lastAssistantEntry(entries)
  if (!last) return undefined
  const { proposals } = extractMemoryProposals(lastAssistantText(entries))
  if (proposals.length === 0) return undefined
  // Nada preseleccionado si hay un aviso (dato personal o inyección): el usuario decide igual, pero mirando.
  return proposals.map((p) => ({ ...p, selected: !p.flag }))
}

export function MemoryProposalCard({
  taskId,
  entries,
  folder
}: {
  taskId: string
  entries: MessageEntry[]
  folder: string | null
}): React.JSX.Element | null {
  const t = useT()
  const last = lastAssistantEntry(entries)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Draft[] | undefined>(() => draftsFrom(entries))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Esta misma propuesta puede haber llegado por una rutina desatendida y ya estar en la cola de pendientes
  // de Rutinas (`PendingLearnedReview`): si es así, se revisa ahí y no acá dos veces.
  const alreadyPending = usePendingLearned(
    (s) => !!last && s.state.items.some((i) => i.sessionId === taskId && i.messageId === last.info.id && !!i.proposals)
  )

  // Un mensaje nuevo (tarea distinta, o la misma con otra respuesta): recalcula desde cero.
  useEffect(() => {
    setDrafts(draftsFrom(entries))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.info.id])

  useEffect(() => {
    void loadPendingLearned()
    return subscribePendingLearned()
  }, [])

  if (!taskId || !last || dismissed.has(last.info.id) || !drafts || drafts.length === 0 || alreadyPending) return null

  const update = (i: number, patch: Partial<Draft>): void => setDrafts((ds) => ds?.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))

  const discard = (): void => setDismissed((s) => new Set(s).add(last.info.id))

  const save = async (): Promise<void> => {
    const chosen: LearnedMemoryProposal[] = drafts.filter((d) => d.selected && d.texto.trim()).map(({ selected: _s, flag: _f, ...p }) => p)
    if (chosen.length === 0) {
      discard()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await cw('tasks:learn:accept', { folder: folder ?? undefined, proposals: chosen })
      if (folder) void loadProjectAndMemory(folder)
      discard()
    } catch (err) {
      setError(errorMessage(err))
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
