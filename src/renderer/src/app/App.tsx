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
import { initExtrasPrefs, whenExtrasLoaded } from '../features/settings/impl/extras'
import { newChat, sendChatMessage } from '../features/chat/actions'
import { useChat } from '../features/chat/store'
import { setDraft } from '../stores/drafts'
import { useSessions } from '../stores/sessions'
import { ensureCodeSubscription, useCode } from '../features/code/impl/store'
import { openProjectTrusted } from '../features/code/impl/trust'
import { clearUnseen, connectFolder, loadTask, rememberFullAccess, useTasks } from '../features/tasks/impl/store'
import { initAttentionBadge } from '../lib/attention'
import { call } from '../lib/api'
import { E2EFault } from './E2EFault'
import { CommandPalette } from './CommandPalette'
import { MODES_BY_ID } from './modes'
import { EngineNotice } from './EngineNotice'
import { QuickEntryNotice } from './QuickEntryNotice'
import { RemoteConfirmHost } from './RemoteConfirmHost'
import { RemotePairHost } from './RemotePairHost'
import { useQuickNotice } from '../lib/quick-notice'
import { UpdateNotice } from './UpdateNotice'
import { ServerBanner } from './ServerBanner'
import { Sidebar } from './Sidebar'
import { useTheme } from './useTheme'
import { useT } from '../lib/i18n'
import { isMacPlatform, platformCaps } from '../lib/platform'
import { useKeybindings } from '../keybindings/dispatch'
import { hintSuffix, useBindingHint } from '../keybindings/bindings'

export function App(): React.JSX.Element {
  const mode = useUi((s) => s.mode)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const sidebarHint = useBindingHint('sidebar.toggle')
  const toggleSidebar = useUi((s) => s.toggleSidebar)

  useTheme()
  const t = useT()

  useEffect(() => {
    const offSettings = useSettings.getState().init()
    const offServer = useServer.getState().init()
    // Eventos de OpenCode → store genérico de sesiones (Chat/Tareas), filtrados por directorio del sobre (6.5).
    const offEvents = onOpencodeEvent((event, dir) => routeEventToSessions(event, dir))
    return () => {
      offEvents()
      offServer()
      offSettings()
    }
  }, [])

  // Confirma al proceso principal que la interfaz pintó (marcador de arranque del actualizador).
  useEffect(() => {
    const t = window.setTimeout(() => void call('app:bootConfirm').catch(() => undefined), 300)
    return () => window.clearTimeout(t)
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
      useQuickNotice.getState().dismiss()
      newChat()
      void waitClient()
        .then(() => whenExtrasLoaded())
        .then(() => sendChatMessage(text))
        .catch((err: unknown) => {
          // Sin motor / sin IA: el texto vuelve al compositor (no se pierde) y el error queda en la conversación si ya existe.
          const id = useChat.getState().activeSessionId
          setDraft(`chat:${id ?? 'new'}`, text)
          if (id) useSessions.getState().setError(id, typeof err === 'object' && err ? err : String(err))
          // Sin conversación donde mostrar el error: aviso visible en la ventana principal (R3-A).
          else useQuickNotice.getState().show(err)
        })
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

  // Badge combinado del Dock (Code + Tareas: sesiones/tareas esperando o sin ver).
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
      } else if (platformCaps().tasks) {
        useUi.getState().setMode('tasks')
        void (async () => {
          const tasks = useTasks.getState()
          // `fullAccess` viene del monitor de main: la tarea puede vivir en el servidor de Control total.
          const wanted = target.fullAccess
          if (target.directory && (tasks.folder !== target.directory || (wanted !== undefined && tasks.fullAccess !== wanted))) {
            if (wanted !== undefined) rememberFullAccess(target.directory, wanted)
            await connectFolder(target.directory, wanted)
          }
          useTasks.setState({ activeTaskId: target.id })
          await loadTask(target.id)
          clearUnseen(target.id)
        })()
      }
    })
  }, [])

  // Atajos configurables (⌘\ barra lateral, ⌘, ajustes, ⌘K / ⌘⇧P paleta, ⌘N nuevo, ⌃Tab cambia de modo, Plan/Build, paneles de Code…):
  // un único manejador resuelve el atajo efectivo de cada acción (registro central en `keybindings/`; se cambian en Ajustes › Atajos).
  useKeybindings()

  const View = MODES_BY_ID[mode].View

  return (
    <div className="flex h-full bg-bg">
      <ConfirmDialogHost />
      <RemotePairHost />
      <RemoteConfirmHost />
      <ErrorBoundary label={t('app.boundary.onboarding')}>
        <OnboardingGate />
      </ErrorBoundary>
      <ErrorBoundary label={t('app.boundary.palette')}>
        <CommandPalette />
      </ErrorBoundary>
      <div
        className={`h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${collapsed ? 'w-0' : 'w-[var(--sidebar-width)]'}`}
        inert={collapsed}
      >
        <ErrorBoundary label={t('app.boundary.sidebar')}>
          <Sidebar />
        </ErrorBoundary>
      </div>
      <main className="relative flex min-w-0 flex-1 flex-col">
        {collapsed && (
          <div className={`absolute top-2 z-10 animate-fade-in ${isMacPlatform() ? 'left-20' : 'left-2'}`}>
            <IconButton label={t('app.sidebar.show', { hint: hintSuffix(sidebarHint) })} onClick={toggleSidebar}>
              <PanelLeftOpen size={16} />
            </IconButton>
          </div>
        )}
        <ErrorBoundary label={t('app.boundary.server')}>
          <ServerBanner />
          <EngineNotice />
          <QuickEntryNotice />
          <UpdateNotice />
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
