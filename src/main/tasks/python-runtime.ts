/**
 * Python incluido en la app para las skills de oficina (Word, Excel, PowerPoint, PDF).
 *
 * Las skills (`resources/opencode/skills/*`) necesitan python-docx, openpyxl, python-pptx, pypdf, etc. En vez de
 * depender del Python de cada Mac (a veces el 3.9 de las Command Line Tools, a veces ninguno), la app puede llevar su
 * propio intérprete (`scripts/fetch-python.mjs` lo descarga y fija; ver `resources/python-bin/`). Aquí solo se
 * LOCALIZA: si existe, se exporta como `LAZUNOX_PYTHON` a los servidores de OpenCode (las skills lo usan antes de
 * caer en `python3`); si no, no se exporta nada y todo sigue como antes.
 *
 * Solo macOS por ahora (en Windows las Tareas usan su propia imagen: ver `docs/WINDOWS-TAREAS.md`).
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unpacked } from '../util/asar'

/** Carpeta de la plataforma dentro de `resources/python-bin/` (la misma que crea `fetch-python.mjs`). */
export function pythonDirFor(platform: string, arch: string): string | null {
  if (platform !== 'darwin') return null
  if (arch === 'arm64') return 'mac-arm64'
  if (arch === 'x64') return 'mac-x64'
  return null
}

export interface PythonLookup {
  platform: string
  arch: string
  /** `process.resourcesPath` (app empaquetada). */
  resourcesPath?: string
  /** `app.getAppPath()` (desarrollo: raíz del repo). */
  appPath: string
  exists: (p: string) => boolean
}

/** Rutas candidatas del intérprete, por orden de preferencia (empaquetado primero, luego el árbol de desarrollo). */
export function pythonCandidates(l: Omit<PythonLookup, 'exists'>): string[] {
  const dir = pythonDirFor(l.platform, l.arch)
  if (!dir) return []
  const out: string[] = []
  if (l.resourcesPath) out.push(join(l.resourcesPath, 'python', 'bin', 'python3'))
  out.push(unpacked(join(l.appPath, 'resources', 'python-bin', dir, 'python', 'bin', 'python3')))
  return out
}

/** Primer candidato que existe, o `null`. */
export function findBundledPython(l: PythonLookup): string | null {
  return pythonCandidates(l).find((p) => l.exists(p)) ?? null
}

/**
 * Variables que se añaden al entorno de `opencode serve` (y, por herencia, a su bash). Vacío si no hay Python incluido.
 * `PYTHONDONTWRITEBYTECODE` y `PYTHONNOUSERSITE`: el intérprete vive en el bundle (solo lectura / sellado) y el sandbox
 * no deja escribir fuera de la carpeta de la tarea; sin esto Python intentaría crear `__pycache__` y leería paquetes
 * del usuario que no controlamos.
 */
export function pythonEnvFor(bin: string | null): Record<string, string> {
  if (!bin) return {}
  return { LAZUNOX_PYTHON: bin, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONUTF8: '1' }
}

/** Entorno de Python para esta app, resolviendo el intérprete real del sistema de archivos. */
export function bundledPythonEnv(): Record<string, string> {
  const bin = findBundledPython({
    platform: process.platform,
    arch: process.arch,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    appPath: app.getAppPath(),
    exists: existsSync
  })
  return pythonEnvFor(bin)
}
