/**
 * Unidades de Windows para la política de carpetas de Tareas (`folder-policy-win.ts`).
 *
 * `parseWinDrives` es PURO y estricto; `readWinDrives` ejecuta DriveInfo de .NET en PowerShell con `execFile` INYECTADO (sin shell,
 * 3 s de límite y un reintento de 10 s, caché de 30 s). Un fallo conserva el último acierto menos de 120 s;
 * sin un acierto vigente devuelve `null` y la política no aprueba ninguna carpeta. En macOS no se usa; solo se prueba con un `execFile` doble.
 */
import { recordProblem, type ProblemInput } from '../diagnostics/problem-log'
import type { WinDrive, WinDriveKind } from './folder-policy-win'

/** `System.IO.DriveType` (mismos valores que Win32_LogicalDisk): 0 desconocido, 1 sin raíz, 2 extraíble, 3 fijo, 4 red, 5 óptico, 6 RAM. */
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

/** Salida JSON de la consulta de unidades: DeviceID y DriveType numérico; el formato anterior CIM también vale. */
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
export const WIN_DRIVES_RETRY_TIMEOUT_MS = 10_000
export const WIN_DRIVES_MAX_AGE_MS = 120_000

// DriveType llama a la API del sistema; no carga CIM/WMI ni consulta IsReady, tamaño o contenido de las unidades.
const SCRIPT =
  '[System.IO.DriveInfo]::GetDrives() | ForEach-Object { [pscustomobject]@{DeviceID=$_.Name.Substring(0,2);DriveType=[int]$_.DriveType} } | ConvertTo-Json -Compress'

export interface WinDrivesDeps {
  execFile: ExecFileFn
  now?: () => number
  /** `%SystemRoot%` (el PowerShell se llama por ruta absoluta, no por PATH). */
  systemRoot: string
  /** Solo tiempos/resultados, nunca rutas ni contenido de las unidades. */
  debug?: (message: string) => void
  /** Registro permanente, con motivos cerrados: nunca se incluyen stdout, stderr ni mensajes del sistema. */
  record?: (problem: ProblemInput) => void
}

export interface WinDrivesSnapshot {
  at: number
  drives: WinDrive[]
}
interface Reader {
  cache: WinDrivesSnapshot | null
  inflight: Promise<WinDrivesSnapshot | null> | null
}

// El ejecutor y SystemRoot delimitan el anfitrión: nunca se comparte una lectura con otro contexto de pruebas/host.
let readers = new WeakMap<ExecFileFn, Map<string, Reader>>()

/** Solo para pruebas. */
export function resetWinDrivesCache(): void {
  readers = new WeakMap()
}

/** Lista para los llamadores que no conservan su propia caché. */
export async function readWinDrives(deps: WinDrivesDeps, force = false): Promise<WinDrive[] | null> {
  return (await readWinDrivesSnapshot(deps, force))?.drives ?? null
}

/** `force` renueva en segundo plano. La fecha original acompaña también al fallback: nunca se rejuvenece una lista vieja. */
export async function readWinDrivesSnapshot(deps: WinDrivesDeps, force = false): Promise<WinDrivesSnapshot | null> {
  const now = deps.now ?? Date.now
  const root = deps.systemRoot.replace(/[\\/]+$/, '')
  let byRoot = readers.get(deps.execFile)
  if (!byRoot) {
    byRoot = new Map()
    readers.set(deps.execFile, byRoot)
  }
  let reader = byRoot.get(root.toLowerCase())
  if (!reader) {
    reader = { cache: null, inflight: null }
    byRoot.set(root.toLowerCase(), reader)
  }
  const cached = reader.cache
  if (!force && cached && now() >= cached.at && now() - cached.at < WIN_DRIVES_TTL_MS) {
    deps.debug?.('[tasks-startup] stage=win-drives cache=hit ms=0')
    return cached
  }
  if (reader.inflight) return reader.inflight
  const target = reader
  const started = performance.now()
  const pending = (async (): Promise<WinDrivesSnapshot | null> => {
    for (const [index, timeout] of [WIN_DRIVES_TIMEOUT_MS, WIN_DRIVES_RETRY_TIMEOUT_MS].entries()) {
      const at = now()
      let reason: string
      try {
        const exe = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        const { stdout } = await deps.execFile(exe, ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
          timeout,
          windowsHide: true,
          maxBuffer: 64 * 1024
        })
        const drives = parseWinDrives(stdout)
        if (drives) {
          // Antigüedad desde que se inició el intento exitoso, sin sumar el tiempo que tardó el proceso.
          target.cache = { at, drives }
          return target.cache
        }
        reason = 'salida inválida'
      } catch (err) {
        const e = err as { code?: unknown; killed?: unknown; signal?: unknown } | null
        reason =
          e?.code === 'ETIMEDOUT' || (e?.killed === true && e?.signal === 'SIGTERM')
            ? 'tiempo agotado'
            : e?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ? 'salida demasiado grande'
              : e?.code === 'ENOENT'
                ? 'PowerShell no disponible'
                : 'fallo del proceso'
      }
      try {
        ;(deps.record ?? recordProblem)({
          source: 'process',
          level: 'warn',
          message: `No se pudo leer la lista de unidades de Windows (${reason}, intento ${index + 1}).`,
          detail: { motivo: reason, intento: index + 1, limiteMs: timeout }
        })
      } catch {
        /* el registro nunca debe alterar la política */
      }
    }
    const previous = target.cache
    return previous && now() >= previous.at && now() - previous.at < WIN_DRIVES_MAX_AGE_MS ? previous : null
  })()
  target.inflight = pending
  try {
    const drives = await pending
    deps.debug?.(`[tasks-startup] stage=win-drives cache=miss ok=${drives !== null} ms=${Math.round(performance.now() - started)}`)
    return drives
  } finally {
    if (target.inflight === pending) target.inflight = null
  }
}
