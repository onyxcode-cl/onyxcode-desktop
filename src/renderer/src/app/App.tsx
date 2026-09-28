import { useEffect } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { ConfirmDialogHost } from '../components/ConfirmDialog'
import { IconButton } from '../components/IconButton'
import { SettingsView } from '../features/settings'
import { onOpencodeEvent, useServer } from '../stores/server'
import { useSessions } from '../stores/sessions'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { initExtrasPrefs } from '../features/settings/impl/extras'
import { newChat, sendChatMessage } from '../features/chat/actions'
import { useCode } from '../features/code/impl/store'
import { clearUnseen, connectFolder, loadTask, useCowork } from '../features/cowork/impl/store'
import { initAttentionBadge } from '../lib/attention'
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

  // Badge combinado del Dock (Code + Cowork: sesiones/tareas esperando o sin ver).
  useEffect(() => initAttentionBadge(), [])

  // Clic en una notificación nativa (o "abrir" desde el Dock): cambia de modo y selecciona.
  useEffect(() => {
    return window.api.on('app:openTarget', (target) => {
      useUi.getState().openSettings(false)
      if (target.mode === 'code') {
        useUi.getState().setMode('code')
        void (async () => {
          const code = useCode.getState()
          if (target.directory && code.directory !== target.directory) await code.openProject(target.directory)
          await useCode.getState().selectSession(target.id)
        })()
      } else {
        useUi.getState().setMode('cowork')
        void (async () => {
          const cowork = useCowork.getState()
          if (target.directory && cowork.folder !== target.directory) await connectFolder(target.directory)
          useCowork.setState({ activeTaskId: target.id })
          await loadTask(target.id)
          clearUnseen(target.id)
        })()
      }
    })
  }, [])

  // Atajos de la ventana: ⌘\ barra lateral, ⌘, ajustes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key === '\\') {
        e.preventDefault()
        useUi.getState().toggleSidebar()
      } else if (e.key === ',') {
        e.preventDefault()
        const ui = useUi.getState()
        ui.openSettings(!ui.settingsOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const View = MODES_BY_ID[mode].View

  return (
    <div className="flex h-full bg-bg">
      <ConfirmDialogHost />
      <div
        className={`h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${collapsed ? 'w-0' : 'w-[var(--sidebar-width)]'}`}
        inert={collapsed}
      >
        <Sidebar />
      </div>
      <main className="relative flex min-w-0 flex-1 flex-col">
        {collapsed && (
          <div className="absolute top-2 left-20 z-10 animate-fade-in">
            <IconButton label="Mostrar barra lateral (⌘\)" onClick={toggleSidebar}>
              <PanelLeftOpen size={16} />
            </IconButton>
          </div>
        )}
        <ServerBanner />
        <div className="min-h-0 flex-1">
          {settingsOpen ? (
            <div key="settings" className="h-full animate-fade-in">
              <SettingsView />
            </div>
          ) : (
            <div key={mode} className="h-full animate-fade-in">
              <View />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
