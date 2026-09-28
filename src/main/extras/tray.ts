/**
 * Icono de bandeja / barra de menús. El icono se dibuja en tiempo de ejecución (bitmap BGRA
 * 32×32 @2x → 16pt) como "template image" de macOS, así no depende de assets.
 */
import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { APP_NAME } from '@shared/brand'

export interface TrayActions {
  onNewConversation: () => void
  onQuickEntry: () => void
  onOpenApp: () => void
  onOpenSettings: () => void
  onQuit?: () => void
}

let tray: Tray | null = null
let lastActions: TrayActions | null = null
let lastAccelerator = ''

/** Burbuja de chat redondeada con tres puntos, dibujada con antialiasing simple. */
export function createTrayIcon(): NativeImage {
  const S = 32
  const buf = Buffer.alloc(S * S * 4)
  const cov = (px: number, py: number): number => {
    // Supermuestreo 4×4 para bordes suaves.
    let hits = 0
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const x = px + (sx + 0.5) / 4
        const y = py + (sy + 0.5) / 4
        if (inShape(x, y)) hits++
      }
    }
    return hits / 16
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = Math.round(cov(x, y) * 255)
      const i = (y * S + x) * 4
      buf[i] = 0 // B
      buf[i + 1] = 0 // G
      buf[i + 2] = 0 // R
      buf[i + 3] = a // A
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: S, height: S, scaleFactor: 2 })
  img.setTemplateImage(true)
  return img
}

function roundRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function inShape(x: number, y: number): boolean {
  const outer = roundRect(x, y, 3, 4, 29, 23, 6)
  const inner = roundRect(x, y, 5.5, 6.5, 26.5, 20.5, 4)
  // Cola de la burbuja (triángulo abajo-izquierda).
  const tail = y >= 22 && y <= 28.5 && x >= 8 && x <= 15 && x - 8 <= (28.5 - y) * 1.1
  const ring = (outer && !inner) || tail
  // Tres puntos.
  const dot = [10.5, 16, 21.5].some((cx) => (x - cx) ** 2 + (y - 13.5) ** 2 <= 2.2 ** 2)
  return ring || dot
}

function buildMenu(actions: TrayActions, quickAccelerator: string): Menu {
  return Menu.buildFromTemplate([
    { label: 'Nueva conversación', click: actions.onNewConversation },
    {
      label: 'Quick Entry',
      click: actions.onQuickEntry,
      // Sólo informativo: el atajo real es global (globalShortcut).
      accelerator: quickAccelerator || undefined,
      registerAccelerator: false
    },
    { type: 'separator' },
    { label: `Abrir ${APP_NAME}`, click: actions.onOpenApp },
    { label: 'Ajustes…', click: actions.onOpenSettings },
    { type: 'separator' },
    { label: `Salir de ${APP_NAME}`, click: actions.onQuit ?? (() => app.quit()) }
  ])
}

export function createTray(actions: TrayActions, quickAccelerator: string): Tray {
  lastActions = actions
  lastAccelerator = quickAccelerator
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildMenu(actions, quickAccelerator))
    return tray
  }
  tray = new Tray(createTrayIcon())
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(buildMenu(actions, quickAccelerator))
  return tray
}

/** Actualiza el acelerador mostrado en el menú. */
export function updateTrayShortcut(quickAccelerator: string): void {
  lastAccelerator = quickAccelerator
  if (tray && !tray.isDestroyed() && lastActions) tray.setContextMenu(buildMenu(lastActions, lastAccelerator))
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}

export function hasTray(): boolean {
  return !!tray && !tray.isDestroyed()
}
