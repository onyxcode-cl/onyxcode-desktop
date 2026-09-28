import { useEffect } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { IconButton } from '../components/IconButton'
import { SettingsView } from '../features/settings'
import { onOpencodeEvent, useServer } from '../stores/server'
import { useSessions } from '../stores/sessions'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { initExtrasPrefs } from '../features/settings/impl/extras'
import { newChat, sendChatMessage } from '../features/chat/actions'
import { MODES_BY_ID } from './modes'
import { ServerBanner } from './ServerBanner'
import { Sidebar } from './Sidebar'
import { useTheme } from './useTheme'

export function App(): React.JSX.Element {
  const mode = useUi((s) => s.mode)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const toggleSidebar = useUi((s) => s.toggleSidebar)

  useTheme()

  useEffect(() => {
    const offSettings = useSettings.getState().init()
    const offServer = useServer.getState().init()
    // Todos los eventos de OpenCode alimentan el store genérico de sesiones.
    const offEvents = onOpencodeEvent((event) => useSessions.getState().applyEvent(event))
    return () => {
      offEvents()
      offServer()
      offSettings()
    }
  }, [])

  // Quick Entry, bandeja del sistema y preferencias extra.
  useEffect(() => {
    const offPrefs = initExtrasPrefs()
    const x = window.api.extras
    const waitClient = (): Promise<void> =>
      new Promise<void>((resolve) => {
        if (useServer.getState().client) return resolve()
        const un = useServer.subscribe((s) => {
          if (s.client) {
            un()
            resolve()
          }
        })
      })
    const offQuick = x.onQuickPrompt(({ text }) => {
      useUi.getState().openSettings(false)
      useUi.getState().setMode('chat')
      newChat()
      void waitClient().then(() => sendChatMessage(text))
    })
    const offNew = x.onNewConversation(() => {
      useUi.getState().openSettings(false)
      useUi.getState().setMode('chat')
      newChat()
    })
    const offOpenSettings = x.onOpenSettings(() => useUi.getState().openSettings(true))
    return () => {
      offPrefs()
      offQuick()
      offNew()
      offOpenSettings()
    }
  }, [])

  const View = MODES_BY_ID[mode].View

  return (
    <div className="flex h-full">
      {!collapsed && <Sidebar />}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {collapsed && (
          <div className="absolute top-2 left-20 z-10">
            <IconButton label="Mostrar barra lateral" onClick={toggleSidebar}>
              <PanelLeftOpen size={16} />
            </IconButton>
          </div>
        )}
        <ServerBanner />
        <div className="min-h-0 flex-1">{settingsOpen ? <SettingsView /> : <View key={mode} />}</div>
      </main>
    </div>
  )
}
