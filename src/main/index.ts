import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME, BRAND_COLORS } from '@shared/brand'
import { OpencodeServer } from './opencode/server'
import { killStaleServers } from './opencode/pids'
import { migrateLegacyUserData, runMigrations } from './migrations'
import { cleanLegacyBrowserData } from './tasks/legacy-cleanup'
import { prepareOpencodeConfigDir } from './tasks/opencode-config'
import { registerAllHandlers } from './ipc'
import { registerBrowserHandlers } from './ipc/browser-handlers'
import { registerCodeHandlers } from './ipc/code-handlers'
import { registerTasksHandlers } from './ipc/tasks-handlers'
import { registerExtrasHandlers } from './ipc/extras-handlers'
import { registerWindowRole } from './ipc/guard'
import { missingSchemas } from './ipc/schemas'
import { embeddedBrowser, shutdown as shutdownEmbeddedBrowser } from './embedded-browser/service'
import { handleAppScheme, registerAppSchemePrivileges, trustedOrigins } from './security/app-protocol'
import { installWebSecurity } from './security/web-security'
import { loadRendererPage, preloadPath } from './extras/windows'
import { applyE2eHeadless, E2E_HEADLESS, presentWindow } from './e2e-headless'

app.setName(APP_NAME)

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
let tasksMod: ReturnType<typeof registerTasksHandlers> | null = null

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
    if (app.isReady()) focusMainWindow()
  })
  app.whenReady().then(() => {
    applyE2eHeadless()
    handleAppScheme()
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
    tasksMod = registerTasksHandlers(ipcMain, () => mainWindow, {
      getMainConnection: () => server.start(),
      chatDirectory,
      corsOrigins
    })
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

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
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
