import { useEffect, useRef, useState } from 'react'
import { ConfirmDialogHost } from '../components/ConfirmDialog'
import { ExportConversationHost } from '../components/ExportConversation'
import { LiveAnnouncer } from '../components/LiveAnnouncer'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { OnboardingGate, PreflightGate } from '../features/onboarding'
import { SettingsView } from '../features/settings'
import { PersonalizacionView } from '../features/personalizacion'
import { onOpencodeEvent, useServer } from '../stores/server'
import { routeEventToSessions } from '../stores/eventRouter'
import { reportProviderError } from '../lib/provider-error-report'
import { useSettings } from '../stores/settings'
import { NARROW_WINDOW_PX, selectListCollapsed, useUi } from '../stores/ui'
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
import { MobileShell } from './mobile/MobileShell'
import { useT } from '../lib/i18n'
import { isMacPlatform, platformCaps, useIsRemote } from '../lib/platform'
import { useControlsInset } from '../lib/window-controls'
import { useKeybindings } from '../keybindings/dispatch'

/**
 * Todo lo que la aplicación necesita en marcha, sea cual sea la estructura de pantalla (escritorio o celular): tema, ajustes,
 * servidor, enrutado de eventos, suscripción de Code, entrada rápida, insignia y notificaciones. Sin atajos de teclado.
 */
function useAppRuntime(): void {
  useTheme()

  useEffect(() => {
    const offSettings = useSettings.getState().init()
    const offServer = useServer.getState().init()
    // Eventos de OpenCode → store genérico de sesiones (Chat/Tareas), filtrados por directorio del sobre (6.5).
    const offEvents = onOpencodeEvent((event, dir) => {
      reportProviderError(event)
      routeEventToSessions(event, dir)
    })
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
}

/** Escritorio (Mac y Windows): barra lateral + vista del modo. */
function DesktopApp(): React.JSX.Element {
  const mode = useUi((s) => s.mode)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const personalizationOpen = useUi((s) => s.personalizationOpen)
  const listCollapsed = useUi(selectListCollapsed)
  const narrow = useUi((s) => s.narrow)
  const t = useT()
  useAppRuntime()
  // Ventana angosta: la lista de la barra se pliega sola a riel (umbral `NARROW_WINDOW_PX`; ver `Sidebar.tsx`).
  useEffect(() => {
    const mq = window.matchMedia?.(`(max-width: ${NARROW_WINDOW_PX - 1}px)`)
    if (!mq) return
    const sync = (): void => useUi.getState().setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const controlsInset = useControlsInset()
  // Con un aviso arriba (motor, actualización…) las cabeceras ya no comparten franja con los semáforos de macOS: no necesitan el
  // hueco `--header-inset` y arrancan con el mismo margen que con la lista abierta (antes ~42 px frente a ~17 px).
  const noticesRef = useRef<HTMLDivElement>(null)
  const [noticeShown, setNoticeShown] = useState(false)
  useEffect(() => {
    const el = noticesRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const sync = (): void => setNoticeShown(el.offsetHeight > 0)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Atajos configurables (⌘\ barra lateral, ⌘, ajustes, ⌘K / ⌘⇧P paleta, ⌘N nuevo, ⌃Tab cambia de modo, Plan/Build, paneles de Code…):
  // un único manejador resuelve el atajo efectivo de cada acción (registro central en `keybindings/`; se cambian en Ajustes › Atajos).
  useKeybindings()

  const View = MODES_BY_ID[mode].View
  // La lista empuja al contenido solo si es visible, está en flujo (no superpuesta por ventana angosta) y el modo tiene una.
  const listInFlow = !!MODES_BY_ID[mode].SidebarContent && !listCollapsed && !narrow

  return (
    <div className="flex h-full bg-bg">
      <ConfirmDialogHost />
      <LiveAnnouncer />
      <ExportConversationHost />
      <RemotePairHost />
      <RemoteConfirmHost />
      <ErrorBoundary label={t('app.boundary.onboarding')}>
        <PreflightGate>
          <OnboardingGate />
        </PreflightGate>
      </ErrorBoundary>
      <ErrorBoundary label={t('app.boundary.palette')}>
        <CommandPalette />
      </ErrorBoundary>
      <ErrorBoundary label={t('app.boundary.sidebar')}>
        <Sidebar showLabel={t('app.sidebar.show', { hint: '' })} />
      </ErrorBoundary>
      {/* `--header-inset`: hueco que las cabeceras reservan a la izquierda cuando solo se ve el riel (56 px: modos y «Mostrar» dentro): en macOS lo que falta para pasar los semáforos (80 px menos los 56 de la barra); en Windows y Linux, nada.
          Cada cabecera suma `pl-[calc(var(--header-inset,0px)+16px)]`. */}
      <main
        className="relative flex min-w-0 flex-1 flex-col"
        // Lista superpuesta (ventana angosta): pulsar el contenido la cierra.
        onMouseDownCapture={narrow && !listCollapsed ? () => useUi.getState().toggleSidebar() : undefined}
        style={
          {
            '--header-inset': !listInFlow && !noticeShown && isMacPlatform() ? '24px' : '0px',
            // Reserva derecha para los controles de ventana de Windows (0 en macOS y Linux).
            '--controls-inset': `${controlsInset}px`,
            // Alto de la banda de título bajo los controles de Windows (48 px): los paneles del borde derecho dejan ese hueco libre arriba.
            '--controls-band': controlsInset > 0 ? '48px' : '0px'
          } as React.CSSProperties
        }
      >
        <ErrorBoundary label={t('app.boundary.server')}>
          <div ref={noticesRef} data-testid="app-notices" className="shrink-0">
            <ServerBanner />
            <EngineNotice />
            <QuickEntryNotice />
            <UpdateNotice />
          </div>
        </ErrorBoundary>
        <div className="min-h-0 flex-1">
          {settingsOpen ? (
            <div key="settings" className="h-full animate-fade-in">
              <SettingsView />
            </div>
          ) : personalizationOpen ? (
            <div key="personalizacion" className="h-full animate-fade-in">
              <ErrorBoundary label={t('pers.title')}>
                <PersonalizacionView />
              </ErrorBoundary>
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

/** Celular (PWA, superficie `remote`): la misma interfaz con la estructura de `MobileShell` y sin atajos de teclado. */
function MobileApp(): React.JSX.Element {
  useAppRuntime()
  return <MobileShell />
}

export function App(): React.JSX.Element {
  return useIsRemote() ? <MobileApp /> : <DesktopApp />
}
