import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME, BRAND_COLORS } from '@shared/brand'
import { OpencodeServer } from './opencode/server'
import { killStaleServers } from './opencode/pids'
import { prepareOpencodeConfigDir } from './cowork/opencode-config'
import { registerAllHandlers } from './ipc'
import { registerCodeHandlers } from './ipc/code-handlers'
import { registerCoworkHandlers } from './ipc/cowork-handlers'
import { registerExtrasHandlers } from './ipc/extras-handlers'

app.setName(APP_NAME)

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

const devOrigin = (() => {
  const url = process.env.ELECTRON_RENDERER_URL
  if (!url) return []
  try {
    return [new URL(url).origin]
  } catch {
    return []
  }
})()

const server = new OpencodeServer({ chatDirectory, corsOrigins: devOrigin })

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
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    if (process.platform !== 'darwin') app.quit()
  })

  // Links externos al navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url !== current && /^https?:\/\//i.test(url) && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\0')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
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

  registerAllHandlers(ipcMain, { server, chatDirectory })
  registerCodeHandlers(ipcMain, () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null)
  coworkMod = registerCoworkHandlers(ipcMain, () => mainWindow, {
    getMainConnection: () => server.start(),
    chatDirectory,
    corsOrigins: devOrigin
  })
  registerExtrasHandlers(ipcMain, { server, createMainWindow: createWindow, getMainWindow: () => mainWindow })

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
