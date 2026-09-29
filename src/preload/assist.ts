/**
 * Preload MÍNIMO de la ventana "assist" (globo de Teach mode y píldora de grabar una skill):
 * recibe `computer:assist` y solo puede invocar `computer:teachRespond` y `computer:record:stop`
 * (ver `src/main/computer/assist-window.ts`). Sin imports en tiempo de ejecución salvo `electron`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const ALLOWED_INVOKE = new Set(['computer:teachRespond', 'computer:record:stop'])

contextBridge.exposeInMainWorld('api', {
  tasks: {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
      if (!ALLOWED_INVOKE.has(channel)) {
        return Promise.resolve({ ok: false, code: 'FORBIDDEN', error: `Canal IPC no permitido: ${channel}` })
      }
      return ipcRenderer.invoke(channel, ...args)
    },
    on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
      if (channel !== 'computer:assist') throw new Error(`Evento IPC no permitido: ${channel}`)
      const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(channel, wrapped)
      return () => {
        ipcRenderer.removeListener(channel, wrapped)
      }
    }
  }
})
