// Ganchos de test SOLO en DEV (cargado desde main.tsx con onyx.e2e=1). Sin IPC nuevo.
import { useServer } from './stores/server'
import { useSessions } from './stores/sessions'
import { useSettings } from './stores/settings'
import { useProviders } from './stores/providers'
import { useUi } from './stores/ui'
import { useChat } from './features/chat/store'
import { openChatSession, newChat } from './features/chat/actions'
import { useCode } from './features/code/impl/store'
import { useCowork } from './features/cowork/impl/store'
import { setFault, type FaultMode } from './e2e-fault'

const hooks = {
  useSessions,
  useCode,
  useCowork,
  useUi,
  useServer,
  useChat,
  useSettings,
  useProviders,
  openChatSession,
  newChat,
  /** Hace que la vista `mode` ('chat' | 'code' | 'tasks' | '*') lance al renderizar; null lo limpia. */
  throwIn: (mode: FaultMode): void => setFault(mode)
}

declare global {
  interface Window {
    __onyxE2E?: object
  }
}

window.__onyxE2E = hooks
