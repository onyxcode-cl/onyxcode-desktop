import type { IpcRenderer } from 'electron'
import { makeBridge } from './bridge'
import {
  IPC_EXTRAS_EVENT_CHANNELS,
  IPC_EXTRAS_INVOKE_CHANNELS,
  type ArtifactPayload,
  type ExtrasApi,
  type IpcExtrasEventChannel,
  type IpcExtrasInvokeChannel,
  type QuickPromptEvent
} from '@shared/ipc-extras'

/** Construye `window.api.extras`. Uso en preload/index.ts: `extras: buildExtrasApi(ipcRenderer)`. */
export function buildExtrasApi(ipcRenderer: IpcRenderer): ExtrasApi {
  const bridge = makeBridge<IpcExtrasInvokeChannel, IpcExtrasEventChannel>(ipcRenderer, {
    invoke: IPC_EXTRAS_INVOKE_CHANNELS,
    events: IPC_EXTRAS_EVENT_CHANNELS
  })
  const invoke = bridge.invokeUnwrap
  const on = bridge.on

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
