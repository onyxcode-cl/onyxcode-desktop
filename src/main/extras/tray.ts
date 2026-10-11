/**
 * Icono de bandeja / barra de menús. El icono se dibuja en tiempo de ejecución (bitmap BGRA
 * 32×32 @2x → 16pt) como "template image" de macOS (a color en Windows, ver `tray-style.ts`), así no
 * depende de assets.
 */
import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { DISPLAY_NAME } from '@shared/brand'
import { onLangChange, t } from '@shared/i18n'
import { trayIconReps, trayIconStyle } from './tray-style'

export interface TrayActions {
  onNewConversation: () => void
  onQuickEntry: () => void
  onOpenApp: () => void
  onOpenSettings: () => void
  onQuit?: () => void
  /** «Cortar acceso del celular» (solo se muestra con el control remoto activo). */
  onRemoteStop?: () => void
}

let tray: Tray | null = null
let lastActions: TrayActions | null = null
let lastAccelerator = ''
let remoteActive = false

/**
 * Símbolo de la marca (gema de 4 facetas), misma geometría de 32 unidades que
 * renderer/components/Logo.tsx y build/icon.svg. Dibujado con antialiasing simple.
 */
export function renderTrayBitmap(S: number, rgb: readonly [number, number, number]): Buffer {
  const k = 32 / S // la geometría está en 32 unidades
  const buf = Buffer.alloc(S * S * 4)
  const cov = (px: number, py: number): number => {
    // Supermuestreo 4×4 para bordes suaves.
    let hits = 0
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const x = (px + (sx + 0.5) / 4) * k
        const y = (py + (sy + 0.5) / 4) * k
        if (inShape(x, y)) hits++
      }
    }
    return hits / 16
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = Math.round(cov(x, y) * 255)
      const i = (y * S + x) * 4
      buf[i] = rgb[2] // B
      buf[i + 1] = rgb[1] // G
      buf[i + 2] = rgb[0] // R
      buf[i + 3] = a // A
    }
  }
  return buf
}

/**
 * macOS: un bitmap de 32 px a escala 2 (template). Windows: varias representaciones (16/20/24/32 px =
 * 100/125/150/200 %) para que el sistema elija la exacta y no reescale (borroso). `platform` es inyectable.
 */
export function createTrayIcon(platform: string = process.platform): NativeImage {
  const style = trayIconStyle(platform)
  const reps = trayIconReps(platform)
  let img: NativeImage
  if (reps.length === 1) {
    const { size, scaleFactor } = reps[0]
    img = nativeImage.createFromBitmap(renderTrayBitmap(size, style.rgb), { width: size, height: size, scaleFactor })
  } else {
    img = nativeImage.createEmpty()
    for (const { size, scaleFactor } of reps) {
      img.addRepresentation({ scaleFactor, width: size, height: size, buffer: renderTrayBitmap(size, style.rgb) })
    }
  }
  img.setTemplateImage(style.template)
  return img
}

function inShape(x: number, y: number): boolean {
  // Gema de la marca: un cuadrado de 15.6 de lado con esquinas redondeadas (radio 2.2) girado 45° y centrado en (16,16), el mismo
  // dibujo que Logo.tsx. Se mide con la distancia firmada a un rectángulo redondeado en el sistema girado.
  const dx = x - 16
  const dy = y - 16
  const u = Math.abs((dx + dy) / Math.SQRT2)
  const v = Math.abs((dy - dx) / Math.SQRT2)
  const h = 7.8 - 2.2
  const qx = Math.max(u - h, 0)
  const qy = Math.max(v - h, 0)
  return Math.hypot(qx, qy) <= 2.2
}

function buildMenu(actions: TrayActions, quickAccelerator: string): Menu {
  return Menu.buildFromTemplate([
    { label: t('main.tray.newConversation'), click: actions.onNewConversation },
    {
      label: t('main.tray.quickEntry'),
      click: actions.onQuickEntry,
      // Sólo informativo: el atajo real es global (globalShortcut).
      accelerator: quickAccelerator || undefined,
      registerAccelerator: false
    },
    { type: 'separator' },
    { label: t('main.tray.openApp', { app: DISPLAY_NAME }), click: actions.onOpenApp },
    { label: t('main.tray.settings'), click: actions.onOpenSettings },
    ...(remoteActive && actions.onRemoteStop
      ? [{ type: 'separator' as const }, { label: t('remote.tray.stop'), click: actions.onRemoteStop }]
      : []),
    { type: 'separator' },
    { label: t('main.tray.quit', { app: DISPLAY_NAME }), click: actions.onQuit ?? (() => app.quit()) }
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
  tray.setToolTip(DISPLAY_NAME)
  tray.setContextMenu(buildMenu(actions, quickAccelerator))
  return tray
}

/** Muestra u oculta la entrada «Cortar acceso del celular». */
export function setTrayRemoteActive(active: boolean): void {
  if (remoteActive === active) return
  remoteActive = active
  if (tray && !tray.isDestroyed() && lastActions) tray.setContextMenu(buildMenu(lastActions, lastAccelerator))
}

/** Actualiza el acelerador mostrado en el menú. */
export function updateTrayShortcut(quickAccelerator: string): void {
  lastAccelerator = quickAccelerator
  if (tray && !tray.isDestroyed() && lastActions) tray.setContextMenu(buildMenu(lastActions, lastAccelerator))
}

// El menú de la bandeja se reconstruye al cambiar de idioma (Ajustes → General → Idioma).
onLangChange(() => {
  if (tray && !tray.isDestroyed() && lastActions) tray.setContextMenu(buildMenu(lastActions, lastAccelerator))
})

/** ¿Hay icono en la bandeja del sistema ahora mismo? */
export function hasTray(): boolean {
  return tray !== null && !tray.isDestroyed()
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
