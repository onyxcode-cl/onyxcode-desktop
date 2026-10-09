/**
 * Cola de memoria/skills que una RUTINA propuso (ejecución desatendida, nadie mirando en el momento): vive
 * en `userData/memoria/pendientes.json`, al lado del resto de memoria aprendida. `enqueueFromRoutine` la
 * llena al terminar una rutina (`scheduler/service.ts`); `acceptPending*`/`discardPending*` las resuelve el
 * dueño después, desde la pantalla de revisión. Revalida TODO otra vez (nunca confía en lo guardado a
 * ciegas ni en lo que mande el renderer): la carpeta se vuelve a validar con `assertFolder` (normalmente
 * `tasks.assertInsideApproved`), y la escritura la hacen `acceptLearnedMemory`/`writeApprovedSkill`, que ya
 * revalidan secretos y topes por su cuenta.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LearnedMemoryProposal, PendingAcceptMemoryResult, PendingAcceptSkillResult } from '@shared/ipc-tasks'
import {
  ackDropped,
  buildPendingItem,
  collectRoutineProposals,
  discardAll,
  discardOne,
  enqueue,
  EMPTY_PENDING_STATE,
  normalizeForDedupe,
  resolvePart,
  type PendingLearnedItem,
  type PendingLearnedState
} from '@shared/learned-pending'
import { acceptLearnedMemory, getLearnedMemory, memoriaDir } from './learned-memory'
import { skillAlreadyExists, writeApprovedSkill } from './learned-skills'

function pendingPath(): string {
  return join(memoriaDir(), 'pendientes.json')
}

function readState(): PendingLearnedState {
  try {
    const raw = JSON.parse(readFileSync(pendingPath(), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || (raw as { items?: unknown }).items === undefined) return EMPTY_PENDING_STATE
    const r = raw as { dropped?: unknown; items?: unknown }
    const items = Array.isArray(r.items) ? (r.items as PendingLearnedItem[]) : []
    const dropped = typeof r.dropped === 'number' ? r.dropped : 0
    return { version: 1, dropped, items }
  } catch {
    return EMPTY_PENDING_STATE
  }
}

function writeState(state: PendingLearnedState): void {
  const file = pendingPath()
  mkdirSync(join(memoriaDir()), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function listPending(): PendingLearnedState {
  return readState()
}

/**
 * Filtra las propuestas de memoria de una rutina: fuera las que ya están guardadas, o ya pendientes para
 * el mismo alcance+carpeta (mismo texto normalizado). Nunca filtra por el `flag` (dato personal/inyección):
 * eso solo avisa en la revisión, no decide solo.
 */
function dedupeMemoryProposals(
  proposals: LearnedMemoryProposal[] | undefined,
  folder: string,
  alreadyPending: PendingLearnedItem[]
): LearnedMemoryProposal[] | undefined {
  if (!proposals || proposals.length === 0) return undefined
  const saved = getLearnedMemory(folder)
  const savedNorm = new Set([...saved.usuario, ...saved.proyecto].map((e) => normalizeForDedupe(e.texto)))
  const pendingNorm = new Set(
    alreadyPending.flatMap((i) =>
      i.folder === folder ? (i.proposals ?? []).map((p) => `${p.alcance}\0${normalizeForDedupe(p.texto)}`) : []
    )
  )
  const out = proposals.filter((p) => {
    const norm = normalizeForDedupe(p.texto)
    if (savedNorm.has(norm)) return false
    if (pendingNorm.has(`${p.alcance}\0${norm}`)) return false
    return true
  })
  return out.length > 0 ? out : undefined
}

/** Al terminar una rutina: extrae lo que propuso y lo encola (filtrando duplicados). `enqueued: false` si no había nada nuevo. */
export function enqueueFromRoutine(args: {
  text: string
  routineId: string
  routineName: string
  runId: string
  folder: string
  sessionId?: string
  messageId?: string
}): { enqueued: boolean; dropped: number } {
  const collected = collectRoutineProposals(args.text)
  const state = readState()
  const proposals = dedupeMemoryProposals(collected.proposals, args.folder, state.items)
  const skill =
    collected.skill &&
    !skillAlreadyExists(args.folder, collected.skill.name) &&
    !state.items.some((i) => i.folder === args.folder && i.skill?.name === collected.skill!.name)
      ? collected.skill
      : undefined
  const item = buildPendingItem({ proposals, skill }, args)
  const next = enqueue(state, item)
  if (item) writeState(next)
  return { enqueued: item !== null, dropped: next.dropped }
}

/**
 * Aprueba (parcial o total) la memoria de un ítem pendiente. Un ítem puede traer también una skill: si es
 * así, solo se resuelve la parte de memoria (`resolvePart`) y la skill sigue pendiente de revisar aparte.
 */
export function acceptPendingMemory(
  id: string,
  proposals: LearnedMemoryProposal[],
  assertFolder: (folder: string) => string
): PendingAcceptMemoryResult {
  const state = readState()
  const item = state.items.find((i) => i.id === id)
  if (!item) return { ok: false, reason: 'no-encontrado' }
  const needsFolder = proposals.some((p) => p.alcance === 'proyecto')
  let folder: string | null = null
  if (needsFolder) {
    try {
      folder = assertFolder(item.folder)
    } catch {
      return { ok: false, reason: 'carpeta-no-aprobada' }
    }
  }
  const { savedCount, bundle } = acceptLearnedMemory(folder, proposals)
  writeState(resolvePart(state, id, 'proposals'))
  return { ok: true, savedCount, bundle }
}

/**
 * Aprueba la skill de un ítem pendiente. Si `writeApprovedSkill` falla (p. ej. `ya-existe`), el ítem SIGUE
 * pendiente entero. Si tiene también memoria, solo se resuelve la parte de la skill (`resolvePart`).
 */
export function acceptPendingSkill(
  id: string,
  skill: { name: string; description: string; body: string },
  assertFolder: (folder: string) => string
): PendingAcceptSkillResult {
  const state = readState()
  const item = state.items.find((i) => i.id === id)
  if (!item) return { ok: false, reason: 'no-encontrado' }
  let folder: string
  try {
    folder = assertFolder(item.folder)
  } catch {
    return { ok: false, reason: 'carpeta-no-aprobada' }
  }
  const result = writeApprovedSkill(folder, skill)
  if (result.ok) writeState(resolvePart(state, id, 'skill'))
  return result
}

export function discardPending(id: string): void {
  writeState(discardOne(readState(), id).state)
}

export function discardAllPending(): void {
  writeState(discardAll(readState()))
}

export function ackPendingDropped(): void {
  writeState(ackDropped(readState()))
}
