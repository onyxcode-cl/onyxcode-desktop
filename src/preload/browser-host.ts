/**
 * Preload de la ventana «Navegador» aparte (Lote D, B.10): solo `window.api.browser`, con el
 * mismo comportamiento que `browser-api.ts` (envoltura `{ok,data}`/`{ok,error}`, whitelist de
 * canales). Deliberadamente AUTOCONTENIDO (sin importar `@shared/ipc-browser` ni `browser-api.ts`):
 * es un preload con `sandbox:true` y, como `quick.ts`/`overlay.ts`/`pill.ts`/`assist.ts`, no debe
 * compartir módulos con `index.ts` para evitar que el empaquetador extraiga un fragmento común que
 * un preload en sandbox no podría cargar. Las listas de canales deben mantenerse iguales a las de
 * `src/shared/ipc-browser.ts` (`BROWSER_INVOKE_CHANNELS`/`BROWSER_EVENT_CHANNELS`); los que no tiene
 * permitidos esta ventana (Ajustes, `devServers`) los rechaza igualmente `guardInvoke` en main
 * (`CHANNEL_ROLES.browserHost`), esta lista es solo la primera barrera.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const ALLOWED_INVOKE = new Set([
  'browser:state',
  'browser:attach',
  'browser:detach',
  'browser:newTab',
  'browser:closeTab',
  'browser:selectTab',
  'browser:navigate',
  'browser:history',
  'browser:agent',
  'browser:pick',
  'browser:capture',
  'browser:toChat',
  'browser:respond',
  'browser:popOut',
  'browser:openExternal'
])

const ALLOWED_EVENTS = new Set([
  'browser:state',
  'browser:approval',
  'browser:approvalDone',
  'browser:picked',
  'browser:reveal',
  'browser:shortcut',
  'browser:toChat',
  'browser:sites'
])

contextBridge.exposeInMainWorld('api', {
  browser: {
    invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
      if (!ALLOWED_INVOKE.has(channel)) throw new Error(`Canal IPC no permitido: ${channel}`)
      const result = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; data: unknown } | { ok: false; error: string }
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
      if (!ALLOWED_EVENTS.has(channel)) throw new Error(`Evento IPC no permitido: ${channel}`)
      const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(channel, wrapped)
      return () => {
        ipcRenderer.removeListener(channel, wrapped)
      }
    }
  }
})
