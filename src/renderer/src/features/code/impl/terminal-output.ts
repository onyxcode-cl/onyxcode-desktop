import { create } from 'zustand'
import { AUTO_SHARE_DEFAULT } from '@shared/terminal-capture'

/**
 * Estado de renderer de la salida de la terminal que la IA puede ver:
 * - `useShareCommandOutput`: ajuste «La IA ve la salida de los comandos que ejecutas con ▶» (por defecto encendido; se recuerda en este equipo).
 * - `usePendingTerminalOutput`: pastilla «Salida … · N líneas · sin claves» que se ADJUNTA al siguiente mensaje (camino alternativo
 *   cuando el envío automático está apagado, y botón «Preguntar a la IA sobre esto» de la cabecera de la terminal).
 */
const KEY = 'lazunox.code.shareCommandOutput'

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    return v === null ? AUTO_SHARE_DEFAULT : v === '1'
  } catch {
    return AUTO_SHARE_DEFAULT
  }
}

export const useShareCommandOutput = create<{ on: boolean; set: (v: boolean) => void }>((set) => ({
  on: read(),
  set: (v) => {
    try {
      localStorage.setItem(KEY, v ? '1' : '0')
    } catch {
      // sin almacenamiento: solo vale en esta sesión
    }
    set({ on: v })
  }
}))

export interface PendingTerminalOutput {
  /** Mensaje completo (intro + bloque ```text```), ya limpio y sin claves. */
  text: string
  lineCount: number
  source: 'command' | 'terminal'
}

export const usePendingTerminalOutput = create<{
  byDir: Record<string, PendingTerminalOutput | undefined>
  setPending: (dir: string, item: PendingTerminalOutput) => void
  clear: (dir: string) => void
}>((set) => ({
  byDir: {},
  setPending: (dir, item) => set((s) => ({ byDir: { ...s.byDir, [dir]: item } })),
  clear: (dir) => set((s) => ({ byDir: { ...s.byDir, [dir]: undefined } }))
}))
