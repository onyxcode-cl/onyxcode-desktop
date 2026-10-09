/**
 * Cola de memoria/skills PROPUESTAS por una ejecución DESATENDIDA (Rutina): nadie está mirando para
 * aprobar en el momento, así que la propuesta queda pendiente de revisión para cuando el dueño vuelva a
 * abrir la app (decisión del dueño, 2026-10-07). Vive en `userData/memoria/pendientes.json`
 * (`src/main/tasks/learned-pending.ts` la lee/escribe); este módulo es la parte PURA: sin Electron ni
 * node:fs, para poder probarla sin la app.
 *
 * Un ítem = lo que propuso UNA ejecución de rutina (a lo sumo un bloque de memoria con hasta 5 hechos, y/o
 * un bloque de skill). Los secretos ya se descartan al extraer (`extractMemoryProposals`/
 * `extractSkillProposal`): nunca llegan aquí, ni siquiera a la cola.
 */
import { randomUUID } from 'node:crypto'
import { extractMemoryProposals, type MemoryProposal } from './memory-proposal'
import { extractSkillProposal, type SkillProposal } from './skill-proposal'

export const MAX_PENDING_ITEMS = 30

export interface PendingLearnedItem {
  id: string
  createdAt: number
  routineId: string
  routineName: string
  runId: string
  folder: string
  sessionId?: string
  messageId?: string
  /** Hasta 5 hechos propuestos (bloque `lazunox-memoria`), si hubo. */
  proposals?: MemoryProposal[]
  /** La skill propuesta (bloque `lazunox-skill`), si hubo. */
  skill?: SkillProposal
}

export interface PendingLearnedState {
  version: 1
  /** Cuántos ítems se descartaron por llegar al tope (nunca su contenido). */
  dropped: number
  items: PendingLearnedItem[]
}

export const EMPTY_PENDING_STATE: PendingLearnedState = { version: 1, dropped: 0, items: [] }

/** Texto normalizado para comparar duplicados: minúsculas, sin tildes, espacios colapsados. */
export function normalizeForDedupe(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Extrae lo que propuso el texto final de una ejecución (memoria y/o skill), sin aplicar ningún criterio
 * de "ya existe" o "ya está pendiente" (eso lo decide quien llama, que sí puede leer disco). `undefined`
 * en cada campo si no hubo nada publicable (bloque ausente, roto, o sin ninguna propuesta válida).
 */
export function collectRoutineProposals(text: string): { proposals?: MemoryProposal[]; skill?: SkillProposal } {
  const mem = extractMemoryProposals(text)
  const sk = extractSkillProposal(text)
  return {
    ...(mem.proposals.length > 0 ? { proposals: mem.proposals } : {}),
    ...(sk?.proposal ? { skill: sk.proposal } : {})
  }
}

/** Arma el ítem nuevo, o `null` si no hay nada que encolar. */
export function buildPendingItem(
  collected: { proposals?: MemoryProposal[]; skill?: SkillProposal },
  meta: { routineId: string; routineName: string; runId: string; folder: string; sessionId?: string; messageId?: string },
  now: () => number = Date.now
): PendingLearnedItem | null {
  if (!collected.proposals && !collected.skill) return null
  return {
    id: randomUUID(),
    createdAt: now(),
    routineId: meta.routineId,
    routineName: meta.routineName,
    runId: meta.runId,
    folder: meta.folder,
    ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
    ...(meta.messageId ? { messageId: meta.messageId } : {}),
    ...(collected.proposals ? { proposals: collected.proposals } : {}),
    ...(collected.skill ? { skill: collected.skill } : {})
  }
}

/**
 * Agrega `item` al estado, respetando el tope: si al agregarlo se pasa de `max`, se descartan los más
 * viejos (FIFO) hasta volver a entrar, y se suma a `dropped`. `null` no cambia nada (quien llama ya decidió
 * que no había nada que encolar).
 */
export function enqueue(state: PendingLearnedState, item: PendingLearnedItem | null, max: number = MAX_PENDING_ITEMS): PendingLearnedState {
  if (!item) return state
  const items = [...state.items, item]
  const over = Math.max(0, items.length - max)
  return { version: 1, dropped: state.dropped + over, items: items.slice(over) }
}

/** Quita un ítem por id. `removed: false` si no estaba (no cambia nada). */
export function discardOne(state: PendingLearnedState, id: string): { state: PendingLearnedState; removed: boolean } {
  const items = state.items.filter((i) => i.id !== id)
  return { state: { ...state, items }, removed: items.length !== state.items.length }
}

/**
 * Resuelve solo UNA parte de un ítem (memoria o skill): un ítem puede traer ambas a la vez (una rutina cuyo
 * prompt pedía las dos cosas en el mismo turno). Si al quitar esa parte no le queda ninguna otra, el ítem
 * sale entero de la cola; si no, se queda con la parte restante pendiente de revisar.
 */
export function resolvePart(state: PendingLearnedState, id: string, part: 'proposals' | 'skill'): PendingLearnedState {
  const items: PendingLearnedItem[] = []
  for (const item of state.items) {
    if (item.id !== id) {
      items.push(item)
      continue
    }
    const next = { ...item }
    delete next[part]
    if (!next.proposals && !next.skill) continue
    items.push(next)
  }
  return { ...state, items }
}

/** Vacía toda la cola de ítems (no toca `dropped`: es un contador histórico aparte). */
export function discardAll(state: PendingLearnedState): PendingLearnedState {
  return { ...state, items: [] }
}

/** "Entendido" sobre el aviso de descartados: vuelve `dropped` a 0. */
export function ackDropped(state: PendingLearnedState): PendingLearnedState {
  return { ...state, dropped: 0 }
}
