/**
 * Contexto de Windows para la política de carpetas de Tareas (`folder-policy-win.ts`), con TODO lo que toca el sistema inyectado
 * (sin Electron: `userData` y `execPath` los pone el llamador). En macOS solo se prueba con dobles.
 *
 * Falla CERRADO: sin la lista de unidades (no se pudo leer o está caducada), sin las variables esenciales del sistema o con
 * una `%LOCALAPPDATA%` rara, `context()` devuelve `undefined` y la política rechaza TODA carpeta (`merr.folder.winContext`).
 *
 * La lectura de unidades es asíncrona (PowerShell) y la política es síncrona: `refresh()` se espera en los puntos de entrada
 * asíncronos (`tasks:folders:check`, aprobar, vincular, arrancar) y `context()` solo vale mientras la última lectura sea reciente.
 */
import { execFile } from 'node:child_process'
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { promisify } from 'node:util'
import { wslSetupPaths } from './backends/wsl-setup'
import type { WinDirEntry, WinDrive, WinFolderPolicyContext, WinLinkProbe } from './folder-policy-win'
import { readWinDrives, type ExecFileFn } from './win-drives'

/** Una lectura de unidades más vieja que esto ya no vale (la caché propia de `readWinDrives` es de 30 s). */
export const WIN_CONTEXT_MAX_AGE_MS = 120_000

export interface WinHostDeps {
  /** `process.env` (se busca sin distinguir mayúsculas). */
  env: Record<string, string | undefined>
  /** userData de Lazunox. */
  userData: string
  /** `process.execPath`: su carpeta es la de instalación de Lazunox (vetada). */
  execPath: string
  readDrives(): Promise<WinDrive[] | null>
  now?: () => number
  /** Disco: se inyecta en pruebas; por defecto `node:fs`. `lstat` lanza ENOENT si no existe. */
  fs?: {
    lstat(p: string): { isSymbolicLink(): boolean }
    readdir(p: string): WinDirEntry[]
    realpath(p: string): string
    isDirectory(p: string): boolean
  }
}

export interface WinHost {
  /** Relee las unidades (con la caché de 30 s de `readWinDrives`). Nunca lanza. */
  refresh(): Promise<void>
  /** Contexto de la política, o `undefined` si falta algo (cierra). `allowedRoots` ya normalizadas por el llamador. */
  context(allowedRoots?: string[]): WinFolderPolicyContext | undefined
  /** `realpath` nativo (expande 8.3 y `subst`, quita `\\?\`); lanza si no existe. */
  realpath(p: string): string
  isDirectory(p: string): boolean
  /** `%USERPROFILE%` (o `''` si no existe). */
  home(): string
}

function envGet(env: Record<string, string | undefined>, name: string): string | undefined {
  const want = name.toLowerCase()
  for (const [k, v] of Object.entries(env)) if (k.toLowerCase() === want && typeof v === 'string' && v !== '') return v
  return undefined
}

const realFs: NonNullable<WinHostDeps['fs']> = {
  lstat: (p) => lstatSync(p),
  readdir: (p) =>
    readdirSync(p, { withFileTypes: true }).map((d): WinDirEntry => ({
      name: d.name,
      // Dos fuentes y se queda con la MÁS estricta: el tipo de la entrada y un `lstat` propio (junction, symlink, placeholder).
      isSymbolicLink: d.isSymbolicLink() || lstatSync(join(p, d.name)).isSymbolicLink(),
      isDirectory: d.isDirectory()
    })),
  realpath: (p) => realpathSync.native(p),
  isDirectory: (p) => {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  }
}

export function createWinHost(deps: WinHostDeps): WinHost {
  const now = deps.now ?? Date.now
  const fs = deps.fs ?? realFs
  let drives: { at: number; list: WinDrive[] } | null = null

  const links: WinLinkProbe = {
    lstat: (p) => {
      try {
        const s = fs.lstat(p)
        return { isSymbolicLink: () => s.isSymbolicLink() }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null
        throw e
      }
    },
    readdir: (p) => fs.readdir(p)
  }

  return {
    async refresh() {
      try {
        const list = await deps.readDrives()
        drives = list ? { at: now(), list } : null
      } catch {
        drives = null
      }
    },
    context(allowedRoots) {
      const e = deps.env
      const userProfile = envGet(e, 'USERPROFILE')
      const systemRoot = envGet(e, 'SystemRoot') ?? envGet(e, 'windir')
      const programData = envGet(e, 'ProgramData')
      const localAppData = envGet(e, 'LOCALAPPDATA')
      if (!userProfile || !systemRoot || !programData || !localAppData) return undefined
      if (!drives || now() - drives.at > WIN_CONTEXT_MAX_AGE_MS) return undefined
      // Distro WSL de Tareas (`%LOCALAPPDATA%\Lazunox\wsl`): `wslSetupPaths` valida la ruta; si es rara, no se aprueba nada.
      let wslRoot: string
      try {
        wslRoot = wslSetupPaths(localAppData).root
      } catch {
        return undefined
      }
      const programFiles = ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'].map((n) => envGet(e, n)).filter((x): x is string => !!x)
      return {
        userProfile,
        systemRoot,
        programData,
        programFiles,
        userData: deps.userData,
        appData: envGet(e, 'APPDATA'),
        localAppData,
        // Carpeta de instalación de Lazunox (ejecutable, recursos, actualizador) y distro WSL de Tareas.
        extraDenied: [win32.dirname(deps.execPath), wslRoot],
        drives: drives.list,
        allowedRoots,
        links
      }
    },
    realpath: (p) => fs.realpath(p),
    isDirectory: (p) => fs.isDirectory(p),
    home: () => envGet(deps.env, 'USERPROFILE') ?? ''
  }
}

const execFileP = promisify(execFile)

/** `WinHost` real (solo en win32): PowerShell por ruta absoluta para las unidades y `node:fs` para el resto. */
export function createRealWinHost(o: { userData: string; execPath?: string; env?: Record<string, string | undefined> }): WinHost {
  const env = o.env ?? process.env
  const systemRoot = envGet(env, 'SystemRoot') ?? envGet(env, 'windir') ?? 'C:\\Windows'
  return createWinHost({
    env,
    userData: o.userData,
    execPath: o.execPath ?? process.execPath,
    readDrives: () => readWinDrives({ execFile: execFileP as unknown as ExecFileFn, systemRoot })
  })
}
