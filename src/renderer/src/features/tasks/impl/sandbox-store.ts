/** Estado del entorno aislado de Tareas en la interfaz (`tasks:sandbox:*`). El avance llega por el evento de `main`. */
import { create } from 'zustand'
import type { TasksSandboxStatus } from '@shared/ipc-tasks'
import { platformCaps } from '../../../lib/platform'
import { cw, hasTasksBridge, onTasks } from './bridge'

interface SandboxStore {
  status: TasksSandboxStatus | null
  /** `force` salta la caché de 5 s de main (el botón «Volver a comprobar»); sin él, el sondeo automático usa la caché. */
  refresh: (force?: boolean) => Promise<void>
  setup: () => Promise<void>
  cancel: () => Promise<void>
}

/** Un fallo al preguntar NO inventa un estado «listo»: se queda en `null` («comprobando») y el siguiente intento lo reintenta. */
export const useSandbox = create<SandboxStore>((set) => ({
  status: null,
  refresh: async (force = false) => {
    if (!hasTasksBridge()) return
    try {
      set({ status: await cw('tasks:sandbox:status', force ? { force: true } : undefined) })
    } catch {
      // sin respuesta: se mantiene lo último que se supo (o «comprobando»)
    }
  },
  setup: async () => {
    try {
      set({ status: await cw('tasks:sandbox:setup') })
    } catch {
      // main lo rechazó (p. ej. ya no hacía falta): el estado real llegará con la próxima lectura
      await useSandbox.getState().refresh()
    }
  },
  cancel: async () => {
    try {
      set({ status: await cw('tasks:sandbox:cancel') })
    } catch {
      await useSandbox.getState().refresh()
    }
  }
}))

/**
 * Suscribe la interfaz al avance de `main` y lee el estado. Solo hace algo si el aislamiento es el de Windows (`wsl`):
 * en macOS no hay nada que preparar y no se pide nada. Devuelve la función para desuscribir.
 */
export function initSandbox(): () => void {
  if (platformCaps().tasksSandbox !== 'wsl') return () => undefined
  const off = onTasks('tasks:sandbox:progress', (status) => useSandbox.setState({ status }))
  void useSandbox.getState().refresh()
  return off
}

/** ¿Hay que impedir que se envíen tareas? (Windows y el entorno no está listo; nunca en macOS.) */
export function sandboxBlocksStart(status: TasksSandboxStatus | null): boolean {
  if (platformCaps().tasksSandbox !== 'wsl') return false
  return status?.state !== 'ready' || status.setup?.running === true
}
