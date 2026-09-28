/**
 * Preload MÍNIMO de Quick Entry: solo enviar/ocultar y el aviso de "ventana mostrada".
 * Sin imports en tiempo de ejecución salvo `electron` (los preloads con sandbox no pueden cargar
 * chunks compartidos). Main además restringe los canales de esta ventana (ipc/schemas.ts).
 */
import { contextBridge, ipcRenderer } from 'electron'

type Result = { ok: true; data: unknown } | { ok: false; error: string }

const INVOKE = new Set(['extras:quickSubmit', 'extras:quickHide'])
const EVENTS = new Set(['extras:quick-shown'])

contextBridge.exposeInMainWorld('api', {
  extras: {
    invoke: async (channel: string, req?: unknown): Promise<unknown> => {
      if (!INVOKE.has(channel)) throw new Error(`Canal IPC no permitido: ${channel}`)
      const result = (await ipcRenderer.invoke(channel, req)) as Result
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    on: (channel: string, listener: () => void): (() => void) => {
      if (!EVENTS.has(channel)) throw new Error(`Evento IPC no permitido: ${channel}`)
      const wrapped = (): void => listener()
      ipcRenderer.on(channel, wrapped)
      return () => {
        ipcRenderer.removeListener(channel, wrapped)
      }
    }
  }
})
