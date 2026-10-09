/**
 * «La tarea propone una skill»: igual patrón que `MemoryProposalCard`, pero para skills (memoria
 * procedural). El agente nunca escribe `.opencode/skills/<nombre>/SKILL.md` él mismo: termina su turno
 * con un bloque ```lazunox-skill``` (ver `@shared/skill-proposal`); esta tarjeta lo muestra bajo el
 * último mensaje de una tarea terminada, editable, y solo escribe el archivo al aprobar.
 */
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import { extractSkillProposal, type SkillProposal } from '@shared/skill-proposal'
import { loadPendingLearned, subscribePendingLearned, usePendingLearned } from '../../routines/impl/pending-store'
import { cw } from './bridge'
import { lastAssistantEntry, lastAssistantText } from './EscalateCard'
import { SkillProposalFields } from './SkillProposalFields'

/** `undefined` si no hay nada que pintar (sin bloque, o bloque roto/rechazado: se pierde en silencio, igual que un turno sin memoria). */
export function draftFrom(entries: MessageEntry[]): SkillProposal | undefined {
  const last = lastAssistantEntry(entries)
  if (!last) return undefined
  const extracted = extractSkillProposal(lastAssistantText(entries))
  return extracted?.proposal ?? undefined
}

export function SkillProposalCard({
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
  const [draft, setDraft] = useState<SkillProposal | undefined>(() => draftFrom(entries))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Igual que en `MemoryProposalCard`: si una rutina desatendida ya encoló esta misma propuesta, se revisa
  // desde `PendingLearnedReview` y no acá dos veces.
  const alreadyPending = usePendingLearned(
    (s) => !!last && s.state.items.some((i) => i.sessionId === taskId && i.messageId === last.info.id && !!i.skill)
  )

  useEffect(() => {
    setDraft(draftFrom(entries))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.info.id])

  useEffect(() => {
    void loadPendingLearned()
    return subscribePendingLearned()
  }, [])

  if (!taskId || !last || !folder || dismissed.has(last.info.id) || !draft || alreadyPending) return null

  const discard = (): void => setDismissed((s) => new Set(s).add(last.info.id))

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await cw('tasks:skill:accept', { folder, name: draft.name, description: draft.description, body: draft.body })
      if (res.ok) {
        discard()
      } else if (res.reason === 'ya-existe') {
        setError(t('tasks.skill.alreadyExists'))
      } else if (res.reason === 'nombre-invalido') {
        setError(t('tasks.skill.invalidName'))
      } else {
        setError(t('tasks.skill.saveFailed'))
      }
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
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold desk:text-title-sm">{t('tasks.skill.cardTitle')}</p>
          <p className="mt-0.5 text-xs text-muted">{t('tasks.skill.cardHint')}</p>

          <div className="mt-3">
            <SkillProposalFields draft={draft} onChange={(patch) => setDraft((d) => d && { ...d, ...patch })} />
          </div>

          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void save()} disabled={busy || !draft.name.trim()}>
              {busy ? t('tasks.skill.saving') : t('tasks.skill.save')}
            </Button>
            <Button variant="ghost" onClick={discard} disabled={busy}>
              {t('tasks.skill.discard')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
