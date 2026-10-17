import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, powerMonitor, screen } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { t } from '@shared/i18n'
import { installEditContextMenu } from './security/edit-context-menu'
import { needsQuitConfirmation } from './quit-guard'
import { APP_ID, BRAND_COLORS, DISPLAY_NAME, INTERNAL_NAME } from '@shared/brand'
import { OpencodeServer } from './opencode/server'
import { killStaleServers } from './opencode/pids'
import { prepareOpencodeData, shouldReopenOnboarding } from './opencode/data-dir'
import { settingsStore } from './store'
import { migrateLegacyUserData, runMigrations } from './migrations'
import { cleanLegacyBrowserData } from './tasks/legacy-cleanup'
import { cleanLegacyAccountSession } from './legacy-account-cleanup'
import { prepareOpencodeConfigDir } from './tasks/opencode-config'
import { registerAllHandlers } from './ipc'
import { registerBrowserHandlers } from './ipc/browser-handlers'
import { registerCodeHandlers } from './ipc/code-handlers'
import { registerCompareHandlers } from './compare/handlers'
import { registerRoutinesHandlers } from './ipc/routines-handlers'
import { registerUnsupportedHandlers } from './ipc/unsupported-handlers'
import { capsFor } from '@shared/platform-caps'
import { capsFlagsToArgs } from '@shared/caps-argv'
import { computerWinHelperPresent, resolveComputerWin } from './computer/computer-win-flag'
import { resolveTasksWin } from './tasks/tasks-win-flag'
import { loadManagedPolicy } from './tasks/policy'
import { createManualFetch, type NetLike } from './remote/tunnel/manual-fetch'
import { craftService } from './office/craft/service'
import { cleanLegacyLibreOffice } from './office/legacy-clean'
import { registerExtrasHandlers } from './ipc/extras-handlers'
import { registerRemoteHandlers } from './ipc/remote-handlers'
import { disposeRemote, getOrgPolicy, remoteMode, setRemoteWin } from './remote/loader'
import { shouldQuitWhenAllWindowsClosed } from './remote/lifecycle'
import { hasTray } from './extras/tray'
import { resolveRemoteWin } from './remote/remote-win-flag'
import { registerWindowRole } from './ipc/guard'
import { missingSchemas } from './ipc/schemas'
import {
  embeddedBrowser,
  repaintOnWindowFocus,
  returnAutoPopoutsToPanel,
  shutdown as shutdownEmbeddedBrowser
} from './embedded-browser/service'
import { handleAppScheme, registerAppSchemePrivileges, trustedOrigins } from './security/app-protocol'
import { initMainI18n } from './i18n'
import { installWebSecurity } from './security/web-security'
import { loadRendererPage, preloadPath } from './extras/windows'
import { clampBounds } from './window-bounds'
import { syncTitleBarOverlay, themeOf } from './window-overlay'
import { titleBarOptions } from '@shared/window-chrome'
import { applyE2eHeadless, E2E_HEADLESS, presentWindow } from './e2e-headless'
import { describeError, initProblemLog, recordProblem } from './diagnostics/problem-log'

app.setName(INTERNAL_NAME)

/**
 * Capacidades de la plataforma: Tareas y Control del PC solo en macOS (en Windows tras banderas); actualizador en macOS y Windows,
 * salvo en una build de la Microsoft Store (`process.windowsStore`): la actualiza la Store, nunca el actualizador propio.
 */
function capsOf(tasksWin: boolean, remoteWin = false, computerWin = false): ReturnType<typeof capsFor> {
  const baseCaps = capsFor(process.platform, { tasksWin, remoteWin, computerWin })
  return { ...baseCaps, updater: baseCaps.updater && (process as NodeJS.Process & { windowsStore?: boolean }).windowsStore !== true }
}
/**
 * Bandera efectiva `tasksWin` (Tareas en Windows con WSL2): compilación (`TASKS_WIN_BUILD`, apagada) + opción del usuario o
 * `LAZUNOX_TASKS_WIN=1` sin empaquetar + política. Se calcula al arrancar (`whenReady`, con los ajustes ya leídos) y hace falta
 * reiniciar para que cambie. Apagada, Windows queda exactamente como hoy: sin modo Tareas, sin su backend, sin sus canales.
 */
let tasksWinOn = false
/** Bandera efectiva `remoteWin` (control remoto en Windows; `remote/remote-win-flag.ts`): apagada por defecto, hace falta reiniciar. */
let remoteWinOn = false
/** Bandera efectiva `computerWin` (Control del PC en Windows; `computer/computer-win-flag.ts`): exige `tasksWin` y el helper; la puerta real es el consentimiento de la tarjeta. */
let computerWinOn = false
let caps = capsOf(false)
/** Lo que `main` necesita de Tareas al salir; macOS lo trae `ipc/tasks-handlers`, el resto solo Rutinas. */
interface TasksLike {
  busyTaskCount: () => number
  shutdown: () => Promise<void>
  killSync: () => void
}
// Módulos del actualizador: `import()` dinámico y solo en macOS (otro código de macOS no se carga en Windows).
type UpdateBoot = typeof import('./update/boot')
type UpdateSwap = typeof import('./update/swap')
type UpdateSwapWin = typeof import('./update/swap-win')
let updateBoot: UpdateBoot | null = null
let updateSwap: UpdateSwap | null = null
let updateSwapWin: UpdateSwapWin | null = null
const isUpdating = (): boolean => (updateSwap?.isUpdating() ?? false) || (updateSwapWin?.isUpdatingWin() ?? false)
const bootMarkers = (): ReturnType<UpdateBoot['bootMarkers']> | null => updateBoot?.bootMarkers() ?? null

// Instancia única: se pide lo antes posible y ANTES de cualquier efecto (migración de userData,
// killStaleServers, handlers, ventanas). Electron deriva el lock del userData ('Lazunox'), que el
// modo dev comparte con la app instalada: si la empaquetada está abierta, `npm run dev` saldrá aquí
// (y viceversa). Sin lock, esta instancia no ejecuta nada más.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

// Esquema `lazunox://app` para el renderer de producción (antes de `ready`).
registerAppSchemePrivileges()

const chatDirectory = join(app.getPath('userData'), 'chat-workspace')

// Orígenes que pueden llamar a los servidores OpenCode por CORS: `lazunox://app` y, sin empaquetar,
// el dev server de Vite. Ya no se admite el origen `null` de file:// (AUDIT.md 2.6).
const corsOrigins = trustedOrigins()

const server = new OpencodeServer({ chatDirectory, corsOrigins })

let mainWindow: BrowserWindow | null = null
let tasksMod: TasksLike | null = null

/** Tamaño inicial y mínimos; en Windows se ajustan al área útil (200 % en 1080p no cabe `minHeight` 560). */
function initialBounds(): { width: number; height: number; minWidth: number; minHeight: number; x?: number; y?: number } {
  const desired = { width: 1280, height: 820, minWidth: 820, minHeight: 560 }
  if (process.platform !== 'win32') return desired
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return clampBounds(display.workArea, display.scaleFactor, desired)
  } catch {
    return desired
  }
}

/** Proveedor del backend de Tareas en Windows (solo con `tasksWin`; carga el código de WSL bajo demanda). */
async function createWinBackend(): Promise<import('./tasks/backends').WinBackendProvider> {
  const { createWinBackendProvider } = await import('./tasks/backends/win-provider')
  const dev = !app.isPackaged
  const wsl = dev ? join(app.getAppPath(), 'resources', 'wsl') : join(process.resourcesPath, 'wsl')
  return createWinBackendProvider({
    dirs: {
      pinJson: dev ? join(app.getAppPath(), 'resources', 'opencode-bin', 'pin.json') : join(wsl, 'pin.json'),
      payloadDir: wsl,
      evidenceDir: dev ? join(app.getAppPath(), 'docs', 'evidence') : join(wsl, 'evidence')
    },
    fetch: createManualFetch(net as unknown as NetLike),
    hostEnv: process.env,
    policyDisabled: () => loadManagedPolicy()?.disableWslTasks === true,
    log: (m) => console.log('[tasks-win]', m)
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...initialBounds(),
    // En Windows el menú queda oculto (Alt lo muestra); los aceleradores siguen activos.
    autoHideMenuBar: process.platform === 'win32',
    show: false,
    title: DISPLAY_NAME,
    // macOS: semáforos integrados; Windows: `hidden` + overlay de controles nativos; Linux: marco estándar (shared/window-chrome).
    ...titleBarOptions(process.platform, themeOf(nativeTheme)),
    backgroundColor: nativeTheme.shouldUseDarkColors ? BRAND_COLORS.bgDark : BRAND_COLORS.bgLight,
    webPreferences: {
      preload: preloadPath('index'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      // Banderas de capacidades para el preload (solo la ventana principal; los preloads secundarios no las reciben).
      additionalArguments: capsFlagsToArgs({ tasksWin: tasksWinOn, remoteWin: remoteWinOn, computerWin: computerWinOn })
    }
  })
  registerWindowRole(win.webContents, 'main')
  if (process.platform === 'win32') {
    // El tema (claro/oscuro/sistema, alto contraste) puede cambiar con la ventana abierta: se repintan los controles nativos.
    const onTheme = (): void => void syncTitleBarOverlay(win, nativeTheme)
    nativeTheme.on('updated', onTheme)
    win.once('closed', () => nativeTheme.off('updated', onTheme))
  }

  mainWindow = win
  installEditContextMenu(win.webContents)
  win.on('ready-to-show', () => presentWindow(win))
  // Si el agente llevó el navegador a una ventana aparte mientras esta ventana estaba oculta, vuelve al panel al mostrarse.
  win.on('restore', () => returnAutoPopoutsToPanel())
  win.on('focus', () => repaintOnWindowFocus())
  win.on('show', () => returnAutoPopoutsToPanel())
  // Marcador de arranque para el actualizador: la ventana principal cargó (el renderer confirma aparte).
  win.webContents.once('did-finish-load', () => bootMarkers()?.loaded())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    if (process.platform !== 'darwin') app.quit()
  })

  // Enlaces externos → navegador del sistema; cualquier otra navegación fuera de `lazunox://app` (o
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
  // La cuenta se retiró (0.4.x): se borra la sesión que haya quedado en disco. Sin Llavero ni safeStorage.
  try {
    const sessionRemoved = cleanLegacyAccountSession(app.getPath('userData'))
    if (sessionRemoved.length > 0) console.log('[main] limpieza de la sesión de la antigua cuenta:', sessionRemoved.length)
  } catch (err) {
    console.warn('[main] no se pudo limpiar la sesión de la antigua cuenta', err)
  }
  // Registro permanente de problemas (Ajustes › Diagnóstico): queda en disco aunque se cierre la app.
  initProblemLog({ dir: join(app.getPath('userData'), 'logs'), home: homedir() })
  // `uncaughtExceptionMonitor` solo OBSERVA: no cambia lo que hace Electron con el error.
  process.on('uncaughtExceptionMonitor', (err) => recordProblem({ source: 'main', ...describeError(err) }))
  process.on('unhandledRejection', (reason) => {
    console.error('[main] promesa rechazada sin capturar:', reason)
    recordProblem({ source: 'main', level: 'warn', ...describeError(reason) })
  })
  app.on('render-process-gone', (_e, wc, d) => {
    if (d.reason !== 'clean-exit')
      recordProblem({
        source: 'process',
        message: 'se cerró una ventana por un fallo',
        detail: { motivo: d.reason, codigo: d.exitCode, url: wc.getURL().slice(0, 80) }
      })
  })
  app.on('child-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit')
      recordProblem({
        source: 'process',
        message: `falló un proceso de la app (${d.type})`,
        detail: { motivo: d.reason, codigo: d.exitCode }
      })
  })
  // Un segundo lanzamiento (dock, `open`, lazunox://) enfoca esta instancia. Antes de `ready` se
  // ignora: la ventana se crea igualmente al arrancar.
  app.on('second-instance', () => {
    // Mientras se sustituye la app no se enfoca ni se abren ventanas (la instancia está cerrándose).
    if (app.isReady() && !isUpdating()) focusMainWindow()
  })
  app.whenReady().then(async () => {
    applyE2eHeadless()
    tasksWinOn = resolveTasksWin({
      platform: process.platform,
      policy: process.platform === 'win32' ? loadManagedPolicy() : null
    })
    computerWinOn = resolveComputerWin({
      platform: process.platform,
      tasksWin: tasksWinOn,
      helperPresent:
        process.platform === 'win32' &&
        computerWinHelperPresent({ resourcesPath: process.resourcesPath ?? '', appPath: app.getAppPath(), cwd: process.cwd() }),
      policy: process.platform === 'win32' ? loadManagedPolicy() : null
    })
    remoteWinOn = resolveRemoteWin({
      platform: process.platform,
      env: process.env,
      isPackaged: app.isPackaged,
      policyBlocked: process.platform === 'win32' ? getOrgPolicy().blocked !== false : false
    })
    setRemoteWin(remoteWinOn)
    caps = capsOf(tasksWinOn, remoteWinOn, computerWinOn)
    if (caps.updater) {
      ;[updateBoot, updateSwap, updateSwapWin] = await Promise.all([
        import('./update/boot'),
        import('./update/swap'),
        import('./update/swap-win')
      ])
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
    registerCompareHandlers(ipcMain, {
      getMainConnection: () => server.start(),
      getMainWindow: () => mainWindow,
      chatDirectory,
      cliVersion: () => server.getConnection()?.version ?? null
    })
    if (caps.updater) (await import('./ipc/update')).registerUpdateHandlers(ipcMain)
    if (caps.tasks) {
      const { registerTasksHandlers } = await import('./ipc/tasks-handlers')
      tasksMod = registerTasksHandlers(ipcMain, () => mainWindow, {
        getMainConnection: () => server.start(),
        chatDirectory,
        corsOrigins,
        // Sin Control del PC no se construye ni se cablea nada de `computer:*` (los stubs responden «no disponible»).
        computer: caps.computer,
        tasksWin: tasksWinOn,
        computerWin: computerWinOn,
        winBackend: tasksWinOn ? await createWinBackend() : undefined
      })
    } else {
      // Sin modo Tareas: Rutinas de Chat y Code, y el resto de canales de Tareas/Control/actualizador responden «no disponible».
      tasksMod = registerRoutinesHandlers(ipcMain, () => mainWindow, { getMainConnection: () => server.start(), chatDirectory })
    }
    registerUnsupportedHandlers(ipcMain, caps)
    registerExtrasHandlers(ipcMain, { server, chatDirectory, createMainWindow: createWindow, getMainWindow: () => mainWindow })
    registerRemoteHandlers(ipcMain, { server, chatDirectory, createMainWindow: createWindow, getMainWindow: () => mainWindow })
    embeddedBrowser.init({ getMainWindow: () => mainWindow, getMainConnection: () => server.start() })
    registerBrowserHandlers(ipcMain)

    // Arranca el sidecar en paralelo a la ventana.
    server.start().catch((err: unknown) => console.error('[main] opencode no arrancó:', err))

    createWindow()

    // ArtCraft: si una instalación quedó a medias, se reintenta en silencio (máx. una vez cada 24 h, sin bloquear el arranque).
    setTimeout(() => void craftService().retryIncomplete(), 45_000).unref()

    // LibreOffice abandonado (lo reemplazó ArtCraft): borra userData/bin/libreoffice-<versión> (~800 MB) una vez por arranque, sin bloquearlo.
    setTimeout(() => {
      try {
        cleanLegacyLibreOffice({ binDir: join(app.getPath('userData'), 'bin') })
      } catch (err) {
        console.warn('[limpieza] LibreOffice abandonado:', err)
      }
    }, 20_000).unref()

    app.on('activate', () => {
      // La ventana oculta de Quick Entry cuenta en getAllWindows: usar la principal.
      if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Windows con el control remoto activo (`remoteWin`) y la bandeja visible: sigue viva en la bandeja (como en macOS sin ventana).
    if (
      shouldQuitWhenAllWindowsClosed({
        platform: process.platform,
        remoteWinOn,
        remoteActive: remoteMode() !== 'off',
        hasTray: hasTray()
      })
    )
      app.quit()
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
    Promise.allSettled([server.stop(), tasksMod?.shutdown(), disposeRemote()])
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
