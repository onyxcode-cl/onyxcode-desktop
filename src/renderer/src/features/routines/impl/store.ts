/** Estado del modo Rutinas (lista, historial, edición). */
import { create } from 'zustand'
import type { RoutineInput, RoutineRunRecord, ScheduledRoutine } from '@shared/ipc-cowork'
import { cw, onCowork } from '../../cowork/impl/bridge'

interface RoutinesState {
  routines: ScheduledRoutine[]
  history: RoutineRunRecord[]
  loading: boolean
  error: string | null
  /** Rutina en edición (sin id = nueva) o null. */
  editing: RoutineInput | null
  selectedId: string | null
}

export const useRoutines = create<RoutinesState>(() => ({
  routines: [],
  history: [],
  loading: false,
  error: null,
  editing: null,
  selectedId: null
}))

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function loadRoutines(): Promise<void> {
  useRoutines.setState({ loading: true, error: null })
  try {
    const [routines, history] = await Promise.all([cw('routines:list'), cw('routines:history', { limit: 100 })])
    useRoutines.setState({ routines, history, loading: false })
  } catch (err) {
    useRoutines.setState({ loading: false, error: msg(err) })
  }
}

/** Suscripción a cambios push desde main. Devuelve la función para desuscribir. */
export function subscribeRoutines(): () => void {
  const off1 = onCowork('routines:changed', (routines) => useRoutines.setState({ routines }))
  const off2 = onCowork('routines:run', (run) =>
    useRoutines.setState((s) => {
      const idx = s.history.findIndex((h) => h.id === run.id)
      const history = idx >= 0 ? s.history.map((h, i) => (i === idx ? run : h)) : [run, ...s.history]
      return { history: history.slice(0, 200) }
    })
  )
  return () => {
    off1()
    off2()
  }
}

export async function saveRoutine(input: RoutineInput): Promise<ScheduledRoutine> {
  const saved = await cw('routines:save', input)
  useRoutines.setState({ editing: null, selectedId: saved.id })
  return saved
}

export async function deleteRoutine(id: string): Promise<void> {
  await cw('routines:delete', { id })
  useRoutines.setState((s) => ({ selectedId: s.selectedId === id ? null : s.selectedId }))
}

export async function toggleRoutine(id: string, enabled: boolean): Promise<void> {
  try {
    await cw('routines:toggle', { id, enabled })
  } catch (err) {
    useRoutines.setState({ error: msg(err) })
  }
}

export async function runRoutineNow(id: string): Promise<void> {
  try {
    await cw('routines:runNow', { id })
  } catch (err) {
    useRoutines.setState({ error: msg(err) })
  }
}
