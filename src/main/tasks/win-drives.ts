/**
 * Unidades de Windows para la política de carpetas de Tareas (`folder-policy-win.ts`).
 *
 * `parseWinDrives` es PURO y estricto; `readWinDrives` ejecuta PowerShell con `execFile` INYECTADO (sin shell,
 * 3 s de límite, caché de 30 s) y FALLA CERRADO: ante cualquier error, salida rara o tiempo agotado devuelve
 * `null` y la política no aprueba ninguna carpeta. En macOS no se usa; solo se prueba con un `execFile` doble.
 */
import type { WinDrive, WinDriveKind } from './folder-policy-win'

/** `Win32_LogicalDisk.DriveType`: 0 desconocido, 1 sin raíz, 2 extraíble, 3 fijo, 4 red, 5 óptico, 6 RAM. */
export function driveKindFromType(n: unknown): WinDriveKind {
  switch (n) {
    case 3:
      return 'fixed'
    case 2:
      return 'removable'
    case 4:
      return 'network'
    case 5:
      return 'optical'
    case 6:
      return 'ram'
    default:
      return 'unknown'
  }
}

/** Salida JSON de `Get-CimInstance Win32_LogicalDisk | Select DeviceID,DriveType | ConvertTo-Json`. */
export function parseWinDrives(stdout: string): WinDrive[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout.replace(/^﻿/, ''))
  } catch {
    return null
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : null
  if (!list || list.length === 0 || list.length > 26) return null
  const out: WinDrive[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object') return null
    const o = it as Record<string, unknown>
    const m = typeof o.DeviceID === 'string' ? /^([A-Za-z]):$/.exec(o.DeviceID) : null
    if (!m) return null
    out.push({ letter: m[1]!.toUpperCase(), kind: driveKindFromType(o.DriveType) })
  }
  return out
}

export type ExecFileFn = (
  file: string,
  args: string[],
  opts: { timeout: number; windowsHide: boolean; maxBuffer: number }
) => Promise<{ stdout: string }>

export const WIN_DRIVES_TTL_MS = 30_000
export const WIN_DRIVES_TIMEOUT_MS = 3_000

const SCRIPT = 'Get-CimInstance -ClassName Win32_LogicalDisk | Select-Object DeviceID,DriveType | ConvertTo-Json -Compress'

export interface WinDrivesDeps {
  execFile: ExecFileFn
  now?: () => number
  /** `%SystemRoot%` (el PowerShell se llama por ruta absoluta, no por PATH). */
  systemRoot: string
}

let cache: { at: number; drives: WinDrive[] } | null = null

/** Solo para pruebas. */
export function resetWinDrivesCache(): void {
  cache = null
}

export async function readWinDrives(deps: WinDrivesDeps): Promise<WinDrive[] | null> {
  const now = (deps.now ?? Date.now)()
  if (cache && now - cache.at < WIN_DRIVES_TTL_MS) return cache.drives
  try {
    const exe = `${deps.systemRoot.replace(/[\\/]+$/, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    const { stdout } = await deps.execFile(exe, ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
      timeout: WIN_DRIVES_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 64 * 1024
    })
    const drives = parseWinDrives(stdout)
    if (!drives) return null
    cache = { at: now, drives }
    return drives
  } catch {
    // Sin caché vieja: una lectura fallida no resucita una respuesta anterior (cierra).
    return null
  }
}
