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

/**
 * Símbolo "Faceta" (gema de 4 facetas + chispa), misma geometría de 32 unidades que
 * renderer/components/Logo.tsx y build/icon.svg. Dibujado con antialiasing simple.
 */
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

function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

function inShape(x: number, y: number): boolean {
  // Gema: cuadrado redondeado 17×17 rotado 45° alrededor de (16,16).
  const c = Math.SQRT1_2
  const rx = (x - 16) * c + (y - 16) * c + 16
  const ry = -(x - 16) * c + (y - 16) * c + 16
  const gem = roundRect(rx, ry, 7.5, 7.5, 24.5, 24.5, 3.6)
  // Cortes entre facetas: del centro óptico (16,14.6) a cada vértice.
  const cut = [
    [16, 3],
    [29, 16],
    [16, 29],
    [3, 16]
  ].some(([vx, vy]) => segDist(x, y, 16, 14.6, vx, vy) < 0.75)
  // Chispa de 4 puntas centrada en (26,6).
  const dx = Math.abs(x - 26)
  const dy = Math.abs(y - 6)
  const spark = Math.sqrt(dx) + Math.sqrt(dy) <= Math.sqrt(4.8)
  return (gem && !cut) || spark
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
