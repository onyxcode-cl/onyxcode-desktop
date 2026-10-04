/**
 * Shells admitidas para `pty:create` (F8-B69, hallazgo 8): lista cerrada por nombre de binario, y en
 * macOS/Linux además debe vivir en `/etc/shells` o en un directorio de sistema/gestor de paquetes. Un
 * ejecutable arbitrario (`/tmp/x/bash`, `/usr/bin/python3`) ya no se acepta como «shell».
 */
import { existsSync, readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'

const POSIX_NAMES = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh'])
const WIN_NAMES = new Set(['pwsh.exe', 'powershell.exe', 'cmd.exe', 'bash.exe', 'wsl.exe'])
const POSIX_DIRS = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/opt/local/bin', '/run/current-system/sw/bin', '/snap/bin']

let etcShellsCache: Set<string> | null = null
function etcShells(): Set<string> {
  if (etcShellsCache) return etcShellsCache
  const out = new Set<string>()
  try {
    if (existsSync('/etc/shells')) {
      for (const line of readFileSync('/etc/shells', 'utf8').split('\n')) {
        const l = line.trim()
        if (l && !l.startsWith('#')) out.add(l)
      }
    }
  } catch {
    // sin /etc/shells: solo valen los directorios de sistema
  }
  etcShellsCache = out
  return out
}

export function isAllowedShell(shell: string, platform: NodeJS.Platform = process.platform, listed: ReadonlySet<string> = etcShells()): boolean {
  if (typeof shell !== 'string' || !shell || shell.includes('\0')) return false
  if (platform === 'win32') {
    if (!win32.isAbsolute(shell) || shell.split(/[\\/]+/).includes('..')) return false
    return WIN_NAMES.has(win32.basename(shell).toLowerCase())
  }
  if (!posix.isAbsolute(shell) || shell.split('/').includes('..') || shell.includes('//')) return false
  if (!POSIX_NAMES.has(posix.basename(shell))) return false
  return listed.has(shell) || POSIX_DIRS.includes(posix.dirname(shell))
}
