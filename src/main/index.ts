import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME } from '@shared/brand'
import { OpencodeServer } from './opencode/server'
import { registerAllHandlers } from './ipc'

app.setName(APP_NAME)

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1d' : '#faf9f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

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

  registerAllHandlers(ipcMain, { server, chatDirectory })

  // Arranca el sidecar en paralelo a la ventana.
  server.start().catch((err: unknown) => console.error('[main] opencode no arrancó:', err))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
  server
    .stop()
    .catch((err: unknown) => console.error('[main] error deteniendo opencode:', err))
    .finally(() => app.quit())
})

// Último recurso: nunca dejar el sidecar huérfano.
process.on('exit', () => server.killSync())
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.killSync()
    process.exit(0)
  })
}
