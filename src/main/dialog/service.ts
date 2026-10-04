/** Diálogos y acciones del sistema: abrir carpeta, mostrar en Finder, abrir en editor. */
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import { codeCandidates } from './code-candidates'
import { assertSafeToOpen } from '../tasks/open-policy'

export interface OpenFolderOptions {
  title?: string
  defaultPath?: string
}

export async function openFolder(parent?: BrowserWindow | null, opts: OpenFolderOptions = {}): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: opts.title ?? 'Abrir carpeta',
    defaultPath: opts.defaultPath && isAbsolute(opts.defaultPath) ? opts.defaultPath : undefined,
    properties: ['openDirectory', 'createDirectory']
  }
  const result = parent && !parent.isDestroyed() ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

function assertExistingPath(p: string): string {
  if (typeof p !== 'string' || !p || !isAbsolute(p) || p.includes('\0')) throw new Error(`Ruta inválida: ${String(p)}`)
  const abs = resolve(p)
  if (!existsSync(abs)) throw new Error(`La ruta no existe: ${abs}`)
  return abs
}

export function revealInFinder(path: string): void {
  shell.showItemInFolder(assertExistingPath(path))
}

/** PATH ampliado: las apps lanzadas desde Finder no heredan el PATH de la shell. */
function extendedEnv(): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return { ...process.env }
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  const parts = (process.env.PATH ?? '').split(':').filter(Boolean)
  for (const e of extra) if (!parts.includes(e)) parts.push(e)
  return { ...process.env, PATH: parts.join(':') }
}

/** Lanza un proceso desacoplado; resuelve true si arrancó, false si no existe el ejecutable. */
export function tryLaunch(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let settled = false
    const done = (ok: boolean): void => {
      if (!settled) {
        settled = true
        resolvePromise(ok)
      }
    }
    try {
      const child = spawn(cmd, args, {
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: 'ignore',
        env: extendedEnv()
      })
      child.once('error', () => done(false))
      child.once('spawn', () => {
        child.unref()
        done(true)
      })
    } catch {
      done(false)
    }
  })
}

/**
 * Contención (F8-B68): la ruta (ya con `realpath`) debe estar dentro de una carpeta de proyecto autorizada. `isProjectRoot`
 * decide si un directorio concreto lo es (proyecto activo de la ventana o reciente); se prueba cada ancestro de la ruta.
 */
export function assertInsideProject(real: string, isProjectRoot: (dir: string) => boolean): void {
  let dir = real
  for (;;) {
    if (isProjectRoot(dir)) return
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`La ruta no pertenece a un proyecto abierto: ${real}`)
}

/**
 * Abre en VS Code (`code`) y, si no está, con `open` (macOS) / `shell.openPath`. Solo rutas dentro de un proyecto
 * autorizado (`isProjectRoot`); los ejecutables/lanzadores (`.app`, scripts, bit de ejecución…) nunca se abren con la
 * app por defecto (`assertSafeToOpen`): en ese caso solo sirve el editor de código o «Mostrar en Finder».
 */
export async function openInEditor(path: string, isProjectRoot: (dir: string) => boolean): Promise<{ via: 'code' | 'open' }> {
  const abs = realpathSync(assertExistingPath(path))
  assertInsideProject(abs, isProjectRoot)
  for (const cmd of codeCandidates(process.platform, process.env)) {
    if ((cmd.startsWith('/') || isAbsolute(cmd)) && !existsSync(cmd)) continue
    if (await tryLaunch(cmd, [abs])) return { via: 'code' }
  }
  assertSafeToOpen(abs) // los respaldos `open`/`openPath` ejecutarían un .app o un script
  if (process.platform === 'darwin') {
    if (await tryLaunch('open', [abs])) return { via: 'open' }
  }
  const err = await shell.openPath(abs)
  if (err) throw new Error(`No se pudo abrir ${abs}: ${err}`)
  return { via: 'open' }
}
