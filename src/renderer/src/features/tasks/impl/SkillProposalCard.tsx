/**
 * «La tarea propone una skill»: igual patrón que `MemoryProposalCard`, pero para skills (memoria
 * procedural). El agente nunca escribe `.opencode/skills/<nombre>/SKILL.md` él mismo: termina su turno
 * con un bloque ```lazunox-skill``` (ver `@shared/skill-proposal`); esta tarjeta lo muestra bajo el
 * último mensaje de una tarea terminada, editable, y solo escribe el archivo al aprobar.
 */
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '../../../components/Button'
import type { MsgKey } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import { extractSkillProposal, type SkillProposal, type SkillProposalFlag } from '@shared/skill-proposal'
import { cw } from './bridge'
import { lastAssistantEntry, lastAssistantText } from './EscalateCard'

const FLAG_LABEL: Partial<Record<SkillProposalFlag, MsgKey>> = {
  personal: 'tasks.skill.flag.personal',
  inyeccion: 'tasks.skill.flag.inyeccion'
}

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

  useEffect(() => {
    setDraft(draftFrom(entries))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.info.id])

  if (!taskId || !last || !folder || dismissed.has(last.info.id) || !draft) return null

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

          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-bg p-2.5">
            <div>
              <label className="text-[11px] font-medium text-subtle">{t('tasks.skill.nameLabel')}</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => d && { ...d, name: e.target.value.slice(0, 64) })}
                className="mt-0.5 w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm outline-none focus:border-border-strong"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-subtle">{t('tasks.skill.descriptionLabel')}</label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft((d) => d && { ...d, description: e.target.value.slice(0, 1024) })}
                rows={2}
                className="mt-0.5 w-full resize-y rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-border-strong"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-subtle">{t('tasks.skill.bodyLabel')}</label>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((d) => d && { ...d, body: e.target.value.slice(0, 20_000) })}
                rows={8}
                className="mt-0.5 w-full resize-y rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-border-strong"
              />
            </div>
            {draft.flag && FLAG_LABEL[draft.flag] && <p className="text-xs text-warning">{t(FLAG_LABEL[draft.flag]!)}</p>}
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
