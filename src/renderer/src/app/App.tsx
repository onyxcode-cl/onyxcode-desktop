import { useEffect } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { ConfirmDialogHost } from '../components/ConfirmDialog'
import { IconButton } from '../components/IconButton'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { OnboardingGate } from '../features/onboarding'
import { SettingsView } from '../features/settings'
import { onOpencodeEvent, useServer } from '../stores/server'
import { routeEventToSessions } from '../stores/eventRouter'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { initExtrasPrefs } from '../features/settings/impl/extras'
import { newChat, sendChatMessage } from '../features/chat/actions'
import { ensureCodeSubscription, useCode } from '../features/code/impl/store'
import { openProjectTrusted } from '../features/code/impl/trust'
import { clearUnseen, connectFolder, loadTask, rememberFullAccess, useCowork } from '../features/cowork/impl/store'
import { initAttentionBadge } from '../lib/attention'
import { E2EFault } from './E2EFault'
import { CommandPalette } from './CommandPalette'
import { MODES, MODES_BY_ID } from './modes'
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
    // Eventos de OpenCode → store genérico de sesiones (Chat/Cowork), filtrados por directorio del sobre (6.5).
    const offEvents = onOpencodeEvent((event, dir) => routeEventToSessions(event, dir))
    return () => {
      offEvents()
      offServer()
      offSettings()
    }
  }, [])

  // Code suscrito a nivel de App (D3): avisos, cola y badge siguen vivos fuera de la vista Code.
  // Ref-count de ensureCodeSubscription: CodeWorkspace/CodeSidebar suman su propia referencia sin duplicar.
  useEffect(() => ensureCodeSubscription(), [])

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
          if (target.directory && code.directory !== target.directory && !(await openProjectTrusted(target.directory))) return
          await useCode.getState().selectSession(target.id)
        })()
      } else {
        useUi.getState().setMode('cowork')
        void (async () => {
          const cowork = useCowork.getState()
          // `fullAccess` viene del monitor de main: la tarea puede vivir en el servidor de Control total.
          const wanted = target.fullAccess
          if (target.directory && (cowork.folder !== target.directory || (wanted !== undefined && cowork.fullAccess !== wanted))) {
            if (wanted !== undefined) rememberFullAccess(target.directory, wanted)
            await connectFolder(target.directory, wanted)
          }
          useCowork.setState({ activeTaskId: target.id })
          await loadTask(target.id)
          clearUnseen(target.id)
        })()
      }
    })
  }, [])

  // Atajos de la ventana: ⌘\ barra lateral · ⌘, ajustes · ⌘K / ⌘⇧P paleta · ⌘N nuevo · ⌃Tab cambia de modo.
  // ⌘K en Code con proyecto abierto lo usa su selector de sesiones (⌘⇧P abre la paleta igualmente).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const ui = useUi.getState()

      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault()
        const i = MODES.findIndex((m) => m.id === ui.mode)
        const next = MODES[(i + (e.shiftKey ? -1 : 1) + MODES.length) % MODES.length]
        ui.setMode(next.id)
        return
      }

      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()

      if (e.shiftKey) {
        if (key === 'p') {
          e.preventDefault()
          ui.setPaletteOpen(!ui.paletteOpen)
        }
        return
      }

      if (e.key === '\\') {
        e.preventDefault()
        ui.toggleSidebar()
      } else if (e.key === ',') {
        e.preventDefault()
        ui.openSettings(!ui.settingsOpen)
      } else if (key === 'k') {
        if (!ui.paletteOpen && ui.mode === 'code' && useCode.getState().directory) return
        e.preventDefault()
        ui.setPaletteOpen(!ui.paletteOpen)
      } else if (key === 'n') {
        const action = MODES_BY_ID[ui.mode].newAction
        if (!action || ui.paletteOpen) return
        e.preventDefault()
        ui.openSettings(false)
        action.run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const View = MODES_BY_ID[mode].View

  return (
    <div className="flex h-full bg-bg">
      <ConfirmDialogHost />
      <ErrorBoundary label="el asistente de inicio">
        <OnboardingGate />
      </ErrorBoundary>
      <ErrorBoundary label="la paleta de comandos">
        <CommandPalette />
      </ErrorBoundary>
      <div
        className={`h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${collapsed ? 'w-0' : 'w-[var(--sidebar-width)]'}`}
        inert={collapsed}
      >
        <ErrorBoundary label="la barra lateral">
          <Sidebar />
        </ErrorBoundary>
      </div>
      <main className="relative flex min-w-0 flex-1 flex-col">
        {collapsed && (
          <div className="absolute top-2 left-20 z-10 animate-fade-in">
            <IconButton label="Mostrar barra lateral (⌘\)" onClick={toggleSidebar}>
              <PanelLeftOpen size={16} />
            </IconButton>
          </div>
        )}
        <ErrorBoundary label="el estado del servidor">
          <ServerBanner />
        </ErrorBoundary>
        <div className="min-h-0 flex-1">
          {settingsOpen ? (
            <div key="settings" className="h-full animate-fade-in">
              <SettingsView />
            </div>
          ) : (
            <div key={mode} className="h-full animate-fade-in">
              <ErrorBoundary key={mode} label={MODES_BY_ID[mode].label}>
                {import.meta.env.DEV && <E2EFault mode={mode} />}
                <View />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
