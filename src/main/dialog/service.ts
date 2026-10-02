/** Diálogos y acciones del sistema: abrir carpeta, mostrar en Finder, abrir en editor. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import { codeCandidates } from './code-candidates'

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
function tryLaunch(cmd: string, args: string[]): Promise<boolean> {
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

/** Abre en VS Code (`code`) y, si no está, con `open` (macOS) / `shell.openPath`. */
export async function openInEditor(path: string): Promise<{ via: 'code' | 'open' }> {
  const abs = assertExistingPath(path)
  for (const cmd of codeCandidates(process.platform, process.env)) {
    if ((cmd.startsWith('/') || isAbsolute(cmd)) && !existsSync(cmd)) continue
    if (await tryLaunch(cmd, [abs])) return { via: 'code' }
  }
  if (process.platform === 'darwin') {
    if (await tryLaunch('open', [abs])) return { via: 'open' }
  }
  const err = await shell.openPath(abs)
  if (err) throw new Error(`No se pudo abrir ${abs}: ${err}`)
  return { via: 'open' }
}
