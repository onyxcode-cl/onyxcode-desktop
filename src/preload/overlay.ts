/**
 * Preload MÍNIMO del overlay de control a pantalla completa: solo recibe `computer:overlay`
 * (no puede invocar nada). Sin imports en tiempo de ejecución salvo `electron`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('api', {
  cowork: {
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
