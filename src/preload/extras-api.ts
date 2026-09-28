import type { IpcRenderer, IpcRendererEvent } from 'electron'
import {
  IPC_EXTRAS_EVENT_CHANNELS,
  IPC_EXTRAS_INVOKE_CHANNELS,
  type ArtifactPayload,
  type ExtrasApi,
  type IpcExtrasEventChannel,
  type IpcExtrasInvokeChannel,
  type IpcExtrasResult,
  type QuickPromptEvent
} from '@shared/ipc-extras'

const invokeAllowed = new Set<string>(IPC_EXTRAS_INVOKE_CHANNELS)
const eventAllowed = new Set<string>(IPC_EXTRAS_EVENT_CHANNELS)

/** Construye `window.api.extras`. Uso en preload/index.ts: `extras: buildExtrasApi(ipcRenderer)`. */
export function buildExtrasApi(ipcRenderer: IpcRenderer): ExtrasApi {
  const invoke = async (channel: IpcExtrasInvokeChannel, ...args: unknown[]): Promise<unknown> => {
    if (!invokeAllowed.has(channel)) throw new Error(`Canal IPC no permitido: ${channel}`)
    const result = (await ipcRenderer.invoke(channel, ...args)) as IpcExtrasResult<unknown>
    if (!result.ok) throw new Error(result.error)
    return result.data
  }

  const on = (channel: IpcExtrasEventChannel, listener: (payload?: unknown) => void): (() => void) => {
    if (!eventAllowed.has(channel)) throw new Error(`Evento IPC no permitido: ${channel}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }

  return {
    invoke: invoke as ExtrasApi['invoke'],
    on: on as ExtrasApi['on'],
    openArtifact: (payload: ArtifactPayload) => invoke('extras:openArtifact', payload) as Promise<void>,
    onQuickPrompt: (listener: (event: QuickPromptEvent) => void) => {
      let active = true
      const off = on('extras:quick-prompt', (p) => listener(p as QuickPromptEvent))
      // Recoge un prompt que llegó mientras la ventana cargaba.
      void (invoke('extras:takePendingPrompt') as Promise<QuickPromptEvent | null>)
        .then((pending) => {
          if (active && pending) listener(pending)
        })
        .catch(() => undefined)
      return () => {
        active = false
        off()
      }
    },
    onNewConversation: (listener: () => void) => on('extras:new-conversation', () => listener()),
    onOpenSettings: (listener: () => void) => on('extras:open-settings', () => listener())
  }
}
