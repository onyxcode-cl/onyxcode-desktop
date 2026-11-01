/**
 * Barra lateral translúcida: macOS usa «vibrancy» del sistema (material `fullscreen-ui`: deja pasar más color que `sidebar`, que lo apaga, y sigue el tema claro u oscuro); Windows 11 (compilación 22000 o más) usa Mica («suave») o
 * Acrylic («vidrio»). En el resto (Windows 10, Linux) no hay efecto y la barra queda sólida. Solo es adorno: el renderer pinta
 * opaco todo menos la barra, y si el sistema no puede, nada cambia.
 */
import { release } from 'node:os'
import type { BrowserWindow } from 'electron'
import type { SidebarGlass } from '@shared/types'

/** `10.0.22621` → 22621; 0 si no se entiende. */
export function windowsBuild(osRelease: string): number {
  const n = Number(osRelease.split('.')[2])
  return Number.isFinite(n) ? n : 0
}

export function glassSupported(platform: string = process.platform, osRelease: string = release()): boolean {
  if (platform === 'darwin') return true
  if (platform === 'win32') return windowsBuild(osRelease) >= 22000
  return false
}

export type GlassPlan = { vibrancy: 'fullscreen-ui' | null; material: 'none' | 'mica' | 'acrylic'; transparent: boolean }

export function glassPlan(level: SidebarGlass, platform: string = process.platform, osRelease: string = release()): GlassPlan {
  if (level === 'solid' || !glassSupported(platform, osRelease)) return { vibrancy: null, material: 'none', transparent: false }
  if (platform === 'darwin') return { vibrancy: 'fullscreen-ui', material: 'none', transparent: true }
  return { vibrancy: null, material: level === 'soft' ? 'mica' : 'acrylic', transparent: true }
}

/** Opciones de construcción de la ventana (evita un parpadeo al abrir); sin efecto = objeto vacío. */
export function glassWindowOptions(level: SidebarGlass): {
  vibrancy?: 'fullscreen-ui'
  backgroundMaterial?: 'mica' | 'acrylic'
  transparentBg: boolean
} {
  const p = glassPlan(level)
  return {
    ...(p.vibrancy ? { vibrancy: p.vibrancy } : {}),
    ...(p.material !== 'none' ? { backgroundMaterial: p.material } : {}),
    transparentBg: p.transparent
  }
}

/** Aplica el nivel a una ventana ya creada. `solidBg` es el color de fondo normal para restituirlo al volver a «sólida». */
export function applyGlass(win: BrowserWindow, level: SidebarGlass, solidBg: string): void {
  if (win.isDestroyed()) return
  const p = glassPlan(level)
  try {
    if (process.platform === 'darwin') win.setVibrancy(p.vibrancy)
    else if (process.platform === 'win32' && glassSupported()) win.setBackgroundMaterial(p.material)
    win.setBackgroundColor(p.transparent ? '#00000000' : solidBg)
  } catch (e) {
    console.warn('[glass] no se pudo aplicar:', (e as Error).message)
  }
}
