/**
 * Puente IPC común para los builders de `window.api` (solo bundle `index.js`).
 * NO importar desde quick/overlay/pill/assist/browser-host: son autocontenidos a propósito.
 * Solo `import type` de electron: el ipc se pasa por parámetro (testeable con un falso).
 */
import type { IpcRenderer, IpcRendererEvent } from 'electron'
import type { IpcResult } from '@shared/ipc'

export interface Bridge<I extends string, E extends string> {
  /** Devuelve el resultado envuelto tal cual; canal no permitido → `{ ok:false, code:'ERROR' }`. */
  invokeRaw(channel: I, ...args: unknown[]): Promise<IpcResult<unknown>>
  /** Desenvuelve: `ok` → data; error o canal no permitido → rechaza con `Error`. */
  invokeUnwrap(channel: I, ...args: unknown[]): Promise<unknown>
  /** Suscribe; canal no permitido → lanza. Devuelve la des-suscripción. */
  on(channel: E, listener: (payload: unknown) => void): () => void
}

export function makeBridge<I extends string, E extends string>(
  ipc: IpcRenderer,
  o: { invoke: readonly I[]; events: readonly E[] }
): Bridge<I, E> {
  const invokeAllowed = new Set<string>(o.invoke)
  const eventAllowed = new Set<string>(o.events)

  return {
    invokeRaw(channel, ...args) {
      if (!invokeAllowed.has(channel)) {
        return Promise.resolve({
          ok: false,
          code: 'FORBIDDEN',
          error: `Canal IPC no permitido: ${channel}`
        })
      }
      return ipc.invoke(channel, ...args) as Promise<IpcResult<unknown>>
    },
    async invokeUnwrap(channel, ...args) {
      if (!invokeAllowed.has(channel)) throw new Error(`Canal IPC no permitido: ${channel}`)
      const result = (await ipc.invoke(channel, ...args)) as {
        ok: boolean
        data?: unknown
        error?: string
      }
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    on(channel, listener) {
      if (!eventAllowed.has(channel)) throw new Error(`Evento IPC no permitido: ${channel}`)
      const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipc.on(channel, wrapped)
      return () => {
        ipc.removeListener(channel, wrapped)
      }
    }
  }
}
