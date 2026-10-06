/**
 * Entrada ÚNICA de rutas que llegan a `main` desde la interfaz o desde OpenCode (módulo PURO, plataforma inyectada).
 *
 * `resolveUiPath` valida y canoniza; `isApprovedPath` decide la pertenencia a las carpetas aprobadas. Traducir
 * (`/win/c/x` → `C:\x`) NUNCA autoriza: después hay que pasar por `isApprovedPath` (vía `assertInsideApproved`).
 * En darwin y el resto de plataformas es la identidad: el comportamiento actual no cambia.
 */
import { toSandboxPath, toWinCanonical, winFromLinuxAbsolute, type PathRejectReason } from '@shared/wsl-paths'

export type UiPathResult = { ok: true; path: string } | { ok: false; reason: PathRejectReason }

export function resolveUiPath(p: string, platform: NodeJS.Platform = process.platform): UiPathResult {
  if (typeof p !== 'string') return { ok: false, reason: 'empty' }
  if (platform !== 'win32') return { ok: true, path: p }
  // `//srv/x`, `\\srv\x`, `\\?\`, `\\.\`: toSandboxPath los rechaza con unc/device.
  if (/^[\\/]{2}/.test(p)) {
    const r = toSandboxPath(p)
    return r.ok ? { ok: false, reason: 'unc' } : r
  }
  if (p.startsWith('/')) return winFromLinuxAbsolute(p)
  const r = toSandboxPath(p)
  if (!r.ok) return r
  const win = toWinCanonical(r.path)
  return win ? { ok: true, path: win } : { ok: false, reason: 'outside' }
}

export interface ApprovedData {
  folders: ReadonlyArray<{ path: string }>
  linked: Readonly<Record<string, ReadonlyArray<{ path: string }>>>
  trusted: ReadonlyArray<{ path: string }>
}

/** Núcleo puro de `assertInsideApproved`: `real` ya normalizada (realpath) dentro de alguna carpeta aprobada. */
export function isApprovedPath(real: string, data: ApprovedData, isInside: (p: string, dir: string) => boolean): boolean {
  return (
    data.folders.some((f) => isInside(real, f.path)) ||
    Object.values(data.linked).some((list) => list.some((l) => isInside(real, l.path))) ||
    data.trusted.some((t) => isInside(real, t.path))
  )
}
