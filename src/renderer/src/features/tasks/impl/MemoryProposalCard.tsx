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
import type { MsgKey } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import type { LearnedMemoryProposal, LearnedMemoryScope, LearnedMemoryType } from '@shared/ipc-tasks'
import { extractMemoryProposals, type MemoryProposal, type MemoryProposalFlag } from '@shared/memory-proposal'
import { cw } from './bridge'
import { lastAssistantEntry, lastAssistantText } from './EscalateCard'
import { loadProjectAndMemory } from './store'

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

  // Un mensaje nuevo (tarea distinta, o la misma con otra respuesta): recalcula desde cero.
  useEffect(() => {
    setDrafts(draftsFrom(entries))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.info.id])

  if (!taskId || !last || dismissed.has(last.info.id) || !drafts || drafts.length === 0) return null

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

          <ul className="mt-3 flex flex-col gap-2">
            {drafts.map((d, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-border bg-bg p-2.5">
                <input
                  type="checkbox"
                  checked={d.selected}
                  onChange={(e) => update(i, { selected: e.target.checked })}
                  className="mt-1 shrink-0"
                  aria-label={t('tasks.learn.saveOne')}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={d.alcance}
                      onChange={(e) => update(i, { alcance: e.target.value as LearnedMemoryScope })}
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
                      onChange={(e) => update(i, { tipo: e.target.value as LearnedMemoryType })}
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
                    onChange={(e) => update(i, { texto: e.target.value.slice(0, 300) })}
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
