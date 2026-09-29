import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME, BRAND_COLORS } from '@shared/brand'
import { OpencodeServer } from './opencode/server'
import { killStaleServers } from './opencode/pids'
import { prepareOpencodeConfigDir } from './cowork/opencode-config'
import { registerAllHandlers } from './ipc'
import { registerBrowserHandlers } from './ipc/browser-handlers'
import { registerCodeHandlers } from './ipc/code-handlers'
import { registerCoworkHandlers } from './ipc/cowork-handlers'
import { registerExtrasHandlers } from './ipc/extras-handlers'
import { registerWindowRole } from './ipc/guard'
import { missingSchemas } from './ipc/schemas'
import { embeddedBrowser, shutdown as shutdownEmbeddedBrowser } from './embedded-browser/service'
import { handleAppScheme, registerAppSchemePrivileges, trustedOrigins } from './security/app-protocol'
import { installWebSecurity } from './security/web-security'
import { loadRendererPage, preloadPath } from './extras/windows'

app.setName(APP_NAME)
// Esquema `lapis://app` para el renderer de producción (antes de `ready`).
registerAppSchemePrivileges()

// La app se llamó "OpenDesk" durante el desarrollo: conserva ajustes, rutinas y sesiones.
// Chromium puede crear la carpeta nueva antes de que corra este código, así que se mueven
// las entradas que aún no existen en ella en vez de renombrar la carpeta completa.
const LEGACY_USER_DATA = join(app.getPath('appData'), 'OpenDesk')
const USER_DATA = app.getPath('userData')
if (existsSync(join(LEGACY_USER_DATA, 'settings.json')) && !existsSync(join(USER_DATA, 'settings.json'))) {
  mkdirSync(USER_DATA, { recursive: true })
  for (const entry of readdirSync(LEGACY_USER_DATA)) {
    const target = join(USER_DATA, entry)
    if (existsSync(target)) continue
    try {
      renameSync(join(LEGACY_USER_DATA, entry), target)
    } catch (err) {
      console.error(`[main] no se pudo migrar ${entry} de OpenDesk:`, err)
    }
  }
}

const chatDirectory = join(app.getPath('userData'), 'chat-workspace')

// Orígenes que pueden llamar a los servidores OpenCode por CORS: `lapis://app` y, sin empaquetar,
// el dev server de Vite. Ya no se admite el origen `null` de file:// (AUDIT.md 2.6).
const corsOrigins = trustedOrigins()

const server = new OpencodeServer({ chatDirectory, corsOrigins })

let mainWindow: BrowserWindow | null = null
let coworkMod: ReturnType<typeof registerCoworkHandlers> | null = null

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
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    if (process.platform !== 'darwin') app.quit()
  })

  // Enlaces externos → navegador del sistema; cualquier otra navegación fuera de `lapis://app` (o
  // del dev server) se bloquea: lo hace `installWebSecurity` para todo webContents.
  void loadRendererPage(win, 'index.html')
  return win
}

app.whenReady().then(() => {
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
  coworkMod = registerCoworkHandlers(ipcMain, () => mainWindow, {
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
  Promise.allSettled([server.stop(), coworkMod?.shutdown()])
    .then(() => undefined)
    .catch((err: unknown) => console.error('[main] error deteniendo opencode:', err))
    .finally(() => app.quit())
})

// Último recurso: nunca dejar el sidecar huérfano.
process.on('exit', () => {
  server.killSync()
  coworkMod?.killSync()
})
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.killSync()
    coworkMod?.killSync()
    process.exit(0)
  })
}
