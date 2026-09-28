/**
 * Preload MÍNIMO de la píldora "La IA está controlando tu Mac": recibe `computer:overlay` y solo
 * puede invocar `computer:stop`. Sin imports en tiempo de ejecución salvo `electron`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('api', {
  cowork: {
    invoke: (channel: string): Promise<unknown> => {
      if (channel !== 'computer:stop') {
        return Promise.resolve({ ok: false, code: 'FORBIDDEN', error: `Canal IPC no permitido: ${channel}` })
      }
      return ipcRenderer.invoke(channel)
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
