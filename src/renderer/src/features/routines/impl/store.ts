/** Estado del modo Rutinas (lista, historial, edición). */
import { create } from 'zustand'
import type { RoutineInboxAction, RoutineInboxItem, RoutineInput, RoutineRunRecord, ScheduledRoutine } from '@shared/ipc-tasks'
import { cw, hasTasksBridge, onTasks } from '../../tasks/impl/bridge'

interface RoutinesState {
  routines: ScheduledRoutine[]
  history: RoutineRunRecord[]
  loading: boolean
  error: string | null
  /** Rutina en edición (sin id = nueva) o null. */
  editing: RoutineInput | null
  /** Aviso a mostrar en el editor (p. ej. al partir de una plantilla). */
  editingHint: string | null
  selectedId: string | null
  /** Bandeja «Resultados por revisar» (todos los elementos; los pendientes cuentan en la barra lateral). */
  inbox: RoutineInboxItem[]
}

export const useRoutines = create<RoutinesState>(() => ({
  routines: [],
  history: [],
  loading: false,
  error: null,
  editing: null,
  editingHint: null,
  selectedId: null,
  inbox: []
}))

/** Cantidad de elementos pendientes en la bandeja (contador de la barra lateral). */
export const selectInboxPending = (s: { inbox: RoutineInboxItem[] }): number => s.inbox.filter((i) => i.status === 'pending').length

export async function loadInbox(): Promise<void> {
  try {
    useRoutines.setState({ inbox: await cw('routines:inbox:list') })
  } catch {
    // sin puente o sin permiso: la bandeja queda vacía
  }
}

/** Carga la bandeja y escucha sus cambios (se usa también desde la barra lateral). Devuelve la función para desuscribir. */
export function syncInbox(): () => void {
  if (!hasTasksBridge()) return () => undefined
  void loadInbox()
  return onTasks('routines:inbox', (inbox) => useRoutines.setState({ inbox }))
}

export async function resolveInbox(id: string, action: RoutineInboxAction): Promise<void> {
  try {
    useRoutines.setState({ inbox: await cw('routines:inbox:resolve', { id, action }) })
  } catch (err) {
    useRoutines.setState({ error: msg(err) })
  }
}

export function openEditor(input: RoutineInput, hint: string | null = null): void {
  useRoutines.setState({ editing: input, editingHint: hint })
}

export function closeEditor(): void {
  useRoutines.setState({ editing: null, editingHint: null })
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function loadRoutines(): Promise<void> {
  useRoutines.setState({ loading: true, error: null })
  try {
    const [routines, history, inbox] = await Promise.all([
      cw('routines:list'),
      cw('routines:history', { limit: 100 }),
      cw('routines:inbox:list')
    ])
    useRoutines.setState({ routines, history, inbox, loading: false })
  } catch (err) {
    useRoutines.setState({ loading: false, error: msg(err) })
  }
}

/** Suscripción a cambios push desde main. Devuelve la función para desuscribir. */
export function subscribeRoutines(): () => void {
  const off1 = onTasks('routines:changed', (routines) => useRoutines.setState({ routines }))
  const off3 = onTasks('routines:inbox', (inbox) => useRoutines.setState({ inbox }))
  const off2 = onTasks('routines:run', (run) =>
    useRoutines.setState((s) => {
      const idx = s.history.findIndex((h) => h.id === run.id)
      const history = idx >= 0 ? s.history.map((h, i) => (i === idx ? run : h)) : [run, ...s.history]
      return { history: history.slice(0, 200) }
    })
  )
  return () => {
    off1()
    off2()
    off3()
  }
}

export async function saveRoutine(input: RoutineInput): Promise<ScheduledRoutine> {
  const saved = await cw('routines:save', input)
  useRoutines.setState({ editing: null, editingHint: null, selectedId: saved.id })
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
