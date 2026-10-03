/**
 * `window.api` del celular: el MISMO objeto que arma el preload de escritorio (`buildWindowApi`, que a su vez usa
 * `makeBridge` y los `build*Api` de `src/preload`), pero sobre un `ipcRenderer` falso que habla por el puente:
 *  - cada `invoke(canal, req)` → trama `call{ch,p}`; la respuesta vuelve envuelta como `IpcResult` (`{ok,data}` o
 *    `{ok:false, code, error}`), igual que `ipcRenderer.invoke` de Electron, para que `call()`/`unwrap()` y los `invokeUnwrap`
 *    de los builders funcionen sin cambios;
 *  - cada `on(evento)` → oyente del bus de eventos remoto (`ev.ch` del motor `main`).
 * La lista de canales permitidos sigue siendo la de `src/shared/ipc*.ts` (la valida `makeBridge`); lo que el celular puede
 * REALMENTE hacer lo decide el Mac (política «celular»). Los fallos del puente llegan como errores tipados (`RemoteLinkError`)
 * convertidos al `IpcResult` de error con un texto legible y un código IPC equivalente.
 */
import type { IpcRenderer } from 'electron'
import type { IpcErrorCode, IpcResult, WindowApi } from '@shared/ipc'
import { isAbortError, isRemoteLinkError, toLinkError, type LinkErrorCode, type RemoteLink } from '@shared/remote/link'
import { buildWindowApi } from '../../preload/window-api'
import type { EventsHub } from './events-hub'

/** Plataforma que declara la PWA completa (`window.api.platform`): activa la superficie `remote` de `platform-caps`. */
export const REMOTE_PLATFORM = 'remote'

const IPC_CODE: Partial<Record<LinkErrorCode, IpcErrorCode>> = {
  forbidden: 'FORBIDDEN',
  locked: 'FORBIDDEN',
  denied: 'FORBIDDEN',
  expired: 'FORBIDDEN',
  busy: 'BUSY',
  'rate-limited': 'BUSY',
  unsupported: 'PLATFORM_UNSUPPORTED'
}

export interface IpcShimOptions {
  link: RemoteLink
  events: EventsHub
  text: (code: LinkErrorCode) => string
  /** Cada fallo del puente (para mostrarlo en el estado de conexión). */
  onError?: (e: Error) => void
}

type Listener = (event: unknown, payload: unknown) => void

/** `ipcRenderer` mínimo (lo que usan `makeBridge` y los builders) sobre el puente. */
export function createRemoteIpcRenderer(o: IpcShimOptions): IpcRenderer {
  const offs = new Map<string, Map<Listener, () => void>>()
  const ipc = {
    async invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
      try {
        const data = await o.link.call(channel, args[0])
        return { ok: true, data }
      } catch (e) {
        if (isAbortError(e)) return { ok: false, code: 'ERROR', error: 'aborted' }
        const err = toLinkError(e, o.text)
        o.onError?.(err)
        if (!isRemoteLinkError(err)) return { ok: false, code: 'ERROR', error: err.message }
        // Un `failed` trae el mensaje (ya recortado y sin secretos) del canal del Mac: es más útil que el genérico.
        const error = err.code === 'failed' && err.detail ? err.detail : err.message
        return { ok: false, code: IPC_CODE[err.code] ?? 'ERROR', error }
      }
    },
    on(channel: string, listener: Listener): unknown {
      const off = o.events.onChannel(channel, (payload) => listener({}, payload))
      let m = offs.get(channel)
      if (!m) offs.set(channel, (m = new Map()))
      m.set(listener, off)
      return ipc
    },
    removeListener(channel: string, listener: Listener): unknown {
      const m = offs.get(channel)
      const off = m?.get(listener)
      if (off) {
        m?.delete(listener)
        off()
      }
      return ipc
    }
  }
  return ipc as unknown as IpcRenderer
}

/** `window.api` completo de la PWA (misma forma que el del preload de escritorio). */
export function buildRemoteWindowApi(o: IpcShimOptions): WindowApi {
  return buildWindowApi(createRemoteIpcRenderer(o), REMOTE_PLATFORM)
}
