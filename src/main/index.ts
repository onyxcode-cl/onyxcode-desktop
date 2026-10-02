import { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { t } from '@shared/i18n'
import { needsQuitConfirmation } from './quit-guard'
import { APP_ID, APP_NAME, BRAND_COLORS } from '@shared/brand'
import { OpencodeServer } from './opencode/server'
import { killStaleServers } from './opencode/pids'
import { prepareOpencodeData, shouldReopenOnboarding } from './opencode/data-dir'
import { settingsStore } from './store'
import { migrateLegacyUserData, runMigrations } from './migrations'
import { cleanLegacyBrowserData } from './tasks/legacy-cleanup'
import { prepareOpencodeConfigDir } from './tasks/opencode-config'
import { registerAllHandlers } from './ipc'
import { registerBrowserHandlers } from './ipc/browser-handlers'
import { registerCodeHandlers } from './ipc/code-handlers'
import { registerRoutinesHandlers } from './ipc/routines-handlers'
import { registerUnsupportedHandlers } from './ipc/unsupported-handlers'
import { capsFor } from '@shared/platform-caps'
import { registerExtrasHandlers } from './ipc/extras-handlers'
import { registerWindowRole } from './ipc/guard'
import { missingSchemas } from './ipc/schemas'
import { embeddedBrowser, shutdown as shutdownEmbeddedBrowser } from './embedded-browser/service'
import { handleAppScheme, registerAppSchemePrivileges, trustedOrigins } from './security/app-protocol'
import { initMainI18n } from './i18n'
import { installWebSecurity } from './security/web-security'
import { loadRendererPage, preloadPath } from './extras/windows'
import { applyE2eHeadless, E2E_HEADLESS, presentWindow } from './e2e-headless'

app.setName(APP_NAME)

/** Capacidades de la plataforma: Tareas, Control del PC y actualizador solo en macOS. */
const caps = capsFor(process.platform)
/** Lo que `main` necesita de Tareas al salir; macOS lo trae `ipc/tasks-handlers`, el resto solo Rutinas. */
interface TasksLike {
  busyTaskCount: () => number
  shutdown: () => Promise<void>
  killSync: () => void
}
// Módulos del actualizador: `import()` dinámico y solo en macOS (otro código de macOS no se carga en Windows).
type UpdateBoot = typeof import('./update/boot')
type UpdateSwap = typeof import('./update/swap')
let updateBoot: UpdateBoot | null = null
let updateSwap: UpdateSwap | null = null
const isUpdating = (): boolean => updateSwap?.isUpdating() ?? false
const bootMarkers = (): ReturnType<UpdateBoot['bootMarkers']> | null => updateBoot?.bootMarkers() ?? null

// Instancia única: se pide lo antes posible y ANTES de cualquier efecto (migración de userData,
// killStaleServers, handlers, ventanas). Electron deriva el lock del userData ('OnyxCode'), que el
// modo dev comparte con la app instalada: si la empaquetada está abierta, `npm run dev` saldrá aquí
// (y viceversa). Sin lock, esta instancia no ejecuta nada más.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

// Esquema `onyxcode://app` para el renderer de producción (antes de `ready`).
registerAppSchemePrivileges()

const chatDirectory = join(app.getPath('userData'), 'chat-workspace')

// Orígenes que pueden llamar a los servidores OpenCode por CORS: `onyxcode://app` y, sin empaquetar,
// el dev server de Vite. Ya no se admite el origen `null` de file:// (AUDIT.md 2.6).
const corsOrigins = trustedOrigins()

const server = new OpencodeServer({ chatDirectory, corsOrigins })

let mainWindow: BrowserWindow | null = null
let tasksMod: TasksLike | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? BRAND_COLORS.bgDark : BRAND_COLORS.bgLight,
    webPreferences: {
      preload: preloadPath('index'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged
    }
  })
  registerWindowRole(win.webContents, 'main')

  mainWindow = win
  win.on('ready-to-show', () => presentWindow(win))
  // Marcador de arranque para el actualizador: la ventana principal cargó (el renderer confirma aparte).
  win.webContents.once('did-finish-load', () => bootMarkers()?.loaded())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    if (process.platform !== 'darwin') app.quit()
  })

  // Enlaces externos → navegador del sistema; cualquier otra navegación fuera de `onyxcode://app` (o
  // del dev server) se bloquea: lo hace `installWebSecurity` para todo webContents.
  void loadRendererPage(win, 'index.html')
  return win
}

/** Trae la ventana principal al frente (la crea si no existe). Solo para `second-instance`:
 *  `activate` conserva su comportamiento (únicamente recrear si falta). */
function focusMainWindow(): void {
  // La ventana oculta de Quick Entry cuenta en getAllWindows: usar la referencia a la principal.
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) presentWindow(mainWindow, { focus: true })
  else if (!E2E_HEADLESS) mainWindow.focus()
}

function start(): void {
  // Nombres anteriores de la app (Lapis/OpenDesk): antes de `ready`, como siempre (ver migrations/legacy-app-names.ts).
  migrateLegacyUserData(app.getPath('userData'), app.getPath('appData'))
  // «Chrome aparte» ya no existe: se borran sus datos huérfanos (perfil, cookies, descargas y json).
  // Solo dentro de userData; tras borrarse no queda nada, así que en la práctica corre una vez.
  const legacyRemoved = cleanLegacyBrowserData(app.getPath('userData'))
  if (legacyRemoved.length > 0) console.log('[main] limpieza de datos de Chrome aparte:', legacyRemoved.length)
  // Un segundo lanzamiento (dock, `open`, onyxcode://) enfoca esta instancia. Antes de `ready` se
  // ignora: la ventana se crea igualmente al arrancar.
  app.on('second-instance', () => {
    // Mientras se sustituye la app no se enfoca ni se abren ventanas (la instancia está cerrándose).
    if (app.isReady() && !isUpdating()) focusMainWindow()
  })
  app.whenReady().then(async () => {
    applyE2eHeadless()
    if (caps.updater) {
      ;[updateBoot, updateSwap] = await Promise.all([import('./update/boot'), import('./update/swap')])
    }
    updateBoot?.startBoot()
    handleAppScheme()
    initMainI18n()
    installWebSecurity()
    electronApp.setAppUserModelId(APP_ID)
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    // Servidores `opencode serve` huérfanos de una ejecución anterior que no salió limpia (B3).
    try {
      killStaleServers()
    } catch (err) {
      console.error('[main] limpieza de servidores huérfanos:', err)
    }
    // Migración de nombres persistidos (nombres antiguos -> actuales): tras parar los servidores huérfanos (no hay nadie usando
    // tasks-sandbox/) y ANTES de tocar la config de OpenCode, los handlers y las ventanas. Nunca rompe el arranque.
    try {
      runMigrations(app.getPath('userData'), { appVersion: app.getVersion() })
    } catch (err) {
      console.error('[main] migraciones de datos:', err)
    }
    // Almacén de datos propio del motor (claves y sesiones, aislado del CLI). Si una instalación ya
    // configurada lo estrena (vacío), se reabre el asistente UNA vez para conectar la IA de la app.
    try {
      const { created } = prepareOpencodeData(app.getPath('userData'))
      if (shouldReopenOnboarding({ created, chatWorkspaceExists: existsSync(chatDirectory), onboarded: settingsStore.get().onboarded })) {
        settingsStore.set({ onboarded: false })
      }
    } catch (err) {
      console.error('[main] almacén de datos propio del motor:', err)
    }
    // Agentes de la app → userData/opencode-config (nunca escribir dentro del bundle, P1).
    prepareOpencodeConfigDir()

    if (!app.isPackaged) {
      // Un canal IPC sin esquema queda rechazado por el guard: avisar fuerte en desarrollo.
      const missing = missingSchemas()
      if (missing.length) {
        const msg = `[ipc] canales sin esquema en src/main/ipc/schemas.ts (se rechazarán): ${missing.join(', ')}`
        console.error(msg)
        dialog.showErrorBox('Canales IPC sin esquema', msg)
      }
    }

    registerAllHandlers(ipcMain, { server, chatDirectory, createMainWindow: createWindow, getMainWindow: () => mainWindow })
    registerCodeHandlers(ipcMain, () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null)
    if (caps.updater) (await import('./ipc/update')).registerUpdateHandlers(ipcMain)
    if (caps.tasks) {
      const { registerTasksHandlers } = await import('./ipc/tasks-handlers')
      tasksMod = registerTasksHandlers(ipcMain, () => mainWindow, {
        getMainConnection: () => server.start(),
        chatDirectory,
        corsOrigins
      })
    } else {
      // Sin modo Tareas: Rutinas de Chat y Code, y el resto de canales de Tareas/Control/actualizador responden «no disponible».
      tasksMod = registerRoutinesHandlers(ipcMain, () => mainWindow, { getMainConnection: () => server.start(), chatDirectory })
    }
    registerUnsupportedHandlers(ipcMain, caps)
    registerExtrasHandlers(ipcMain, { server, createMainWindow: createWindow, getMainWindow: () => mainWindow })
    embeddedBrowser.init({ getMainWindow: () => mainWindow, getMainConnection: () => server.start() })
    registerBrowserHandlers(ipcMain)

    // Arranca el sidecar en paralelo a la ventana.
    server.start().catch((err: unknown) => console.error('[main] opencode no arrancó:', err))

    createWindow()

    app.on('activate', () => {
      // La ventana oculta de Quick Entry cuenta en getAllWindows: usar la principal.
      if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Cierre de sesión / apagado del Mac: nunca se bloquea con un diálogo (el sistema espera a la app).
  let systemShutdown = false
  app.whenReady().then(() => powerMonitor.on('shutdown', () => (systemShutdown = true)))

  /** Pregunta «Salir igualmente / Cancelar» (se puede sustituir en E2E como `dialog.showSaveDialog`). */
  const confirmQuit = async (count: number): Promise<boolean> => {
    const win = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: t('merr.quit.title'),
      message: t('merr.quit.message', { count }),
      detail: t('merr.quit.detail'),
      buttons: [t('merr.quit.confirm'), t('merr.quit.cancel')],
      defaultId: 1,
      cancelId: 1
    }
    const res = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return res.response === 0
  }

  let quitting = false
  let quitConfirmed = false
  let asking = false
  app.on('before-quit', (event) => {
    if (quitting) return
    if (!quitConfirmed) {
      const busy = needsQuitConfirmation({
        busyCount: tasksMod?.busyTaskCount() ?? 0,
        updating: isUpdating(),
        systemShutdown
      })
      if (busy > 0) {
        event.preventDefault()
        if (asking) return
        asking = true
        void confirmQuit(busy)
          .catch(() => true)
          .then((ok) => {
            asking = false
            if (ok) {
              quitConfirmed = true
              app.quit()
            } else if (!mainWindow || mainWindow.isDestroyed()) {
              // En Windows/Linux la ventana ya se cerró: «Cancelar» devuelve la app a la vista.
              createWindow()
            }
          })
        return
      }
    }
    quitting = true
    event.preventDefault()
    try {
      shutdownEmbeddedBrowser()
    } catch (err) {
      console.error('[main] limpieza del navegador integrado:', err)
    }
    Promise.allSettled([server.stop(), tasksMod?.shutdown()])
      .then(() => undefined)
      .catch((err: unknown) => console.error('[main] error deteniendo opencode:', err))
      .finally(() => app.quit())
  })

  // Último recurso: nunca dejar el sidecar huérfano.
  process.on('exit', () => {
    server.killSync()
    tasksMod?.killSync()
  })
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      server.killSync()
      tasksMod?.killSync()
      process.exit(0)
    })
  }
}

if (gotSingleInstanceLock) start()
