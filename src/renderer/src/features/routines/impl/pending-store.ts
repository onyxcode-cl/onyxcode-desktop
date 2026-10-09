/**
 * Cola de memoria/skills que una RUTINA propuso en una ejecución desatendida (decisión del dueño,
 * 2026-10-07): nadie estaba mirando para aprobar en el momento, así que queda pendiente de revisión acá
 * (`PendingLearnedReview`, montado arriba de la lista en `RoutinesView`).
 */
import { create } from 'zustand'
import type { LearnedMemoryProposal, PendingLearnedState } from '@shared/ipc-tasks'
import { cw, onTasks } from '../../tasks/impl/bridge'

const EMPTY: PendingLearnedState = { version: 1, dropped: 0, items: [] }

interface PendingLearnedStore {
  state: PendingLearnedState
  loading: boolean
  error: string | null
}

export const usePendingLearned = create<PendingLearnedStore>(() => ({ state: EMPTY, loading: false, error: null }))

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function loadPendingLearned(): Promise<void> {
  usePendingLearned.setState({ loading: true, error: null })
  try {
    const state = await cw('tasks:learn:pending:list')
    usePendingLearned.setState({ state, loading: false })
  } catch (err) {
    usePendingLearned.setState({ loading: false, error: msg(err) })
  }
}

/** Suscripción a cambios push desde main. Devuelve la función para desuscribir. */
export function subscribePendingLearned(): () => void {
  return onTasks('tasks:learn:pending:changed', (state) => usePendingLearned.setState({ state }))
}

export async function acceptPendingMemory(id: string, proposals: LearnedMemoryProposal[]): Promise<boolean> {
  const res = await cw('tasks:learn:pending:acceptMemory', { id, proposals })
  if (res.ok) return true
  usePendingLearned.setState({ error: res.reason })
  return false
}

export async function acceptPendingSkill(
  id: string,
  skill: { name: string; description: string; body: string }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const res = await cw('tasks:learn:pending:acceptSkill', { id, ...skill })
  if (!res.ok) usePendingLearned.setState({ error: res.reason })
  return res.ok ? { ok: true } : { ok: false, reason: res.reason }
}

export async function discardPendingItem(id: string): Promise<void> {
  const state = await cw('tasks:learn:pending:discard', { id })
  usePendingLearned.setState({ state })
}

export async function discardAllPendingItems(): Promise<void> {
  const state = await cw('tasks:learn:pending:discardAll')
  usePendingLearned.setState({ state })
}

export async function ackPendingDropped(): Promise<void> {
  const state = await cw('tasks:learn:pending:ackDropped')
  usePendingLearned.setState({ state })
}
