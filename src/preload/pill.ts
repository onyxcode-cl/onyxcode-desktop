/**
 * Preload MÍNIMO de la píldora "La IA está controlando tu Mac": recibe `computer:overlay` y solo
 * puede invocar `computer:stop` y `computer:respondAccess` (resolver una tarjeta pendiente sin
 * activar la ventana principal, ver `computer/overlay.ts`). Sin imports en tiempo de ejecución
 * salvo `electron`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const ALLOWED_INVOKE = new Set(['computer:stop', 'computer:respondAccess'])

contextBridge.exposeInMainWorld('api', {
  cowork: {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
      if (!ALLOWED_INVOKE.has(channel)) {
        return Promise.resolve({ ok: false, code: 'FORBIDDEN', error: `Canal IPC no permitido: ${channel}` })
      }
      return ipcRenderer.invoke(channel, ...args)
    },
    on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
      if (channel !== 'computer:overlay') throw new Error(`Evento IPC no permitido: ${channel}`)
      const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(channel, wrapped)
      return () => {
        ipcRenderer.removeListener(channel, wrapped)
      }
    }
  }
})
