/**
 * Elección de la shell por defecto de la terminal integrada (pura: sin `electron` ni acceso real al
 * disco, para poder probarla con casos de todas las plataformas).
 *
 * - macOS/Linux: `$SHELL` si es absoluta y existe; si no zsh/bash/sh, con `-l` (login).
 * - Windows: `pwsh.exe` (PowerShell 7) si existe; si no Windows PowerShell 5.1 con `-NoLogo`. `$SHELL`
 *   se ignora (Git Bash/WSL lo definen sin que el usuario quiera esa shell aquí) y `COMSPEC` (cmd) ya no
 *   es el valor por defecto.
 */
import { delimiter as posixDelim, join as posixJoin } from 'node:path/posix'
import { join as winJoin } from 'node:path/win32'

export interface ShellChoice {
  command: string
  args: string[]
}

export interface ShellProbe {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  exists: (p: string) => boolean
  isAbsolute: (p: string) => boolean
}

/** Variable `Path` sin distinguir mayúsculas (en Windows es `Path`). */
function pathEntries(env: Record<string, string | undefined>, win: boolean): string[] {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path')
  const raw = key ? (env[key] ?? '') : ''
  return raw.split(win ? ';' : posixDelim).filter(Boolean)
}

function envGet(env: Record<string, string | undefined>, name: string): string | undefined {
  const k = Object.keys(env).find((x) => x.toLowerCase() === name.toLowerCase())
  return k ? env[k] : undefined
}

export function resolveDefaultShell(p: ShellProbe): ShellChoice {
  if (p.platform === 'win32') {
    const dirs: string[] = []
    const pf = envGet(p.env, 'ProgramFiles')
    if (pf) dirs.push(winJoin(pf, 'PowerShell', '7'))
    for (const d of pathEntries(p.env, true)) dirs.push(d)
    for (const d of dirs) {
      const exe = winJoin(d, 'pwsh.exe')
      if (p.exists(exe)) return { command: exe, args: ['-NoLogo'] }
    }
    const root = envGet(p.env, 'SystemRoot') ?? envGet(p.env, 'windir') ?? 'C:\\Windows'
    const ps51 = winJoin(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    // Si ni siquiera existe (instalación rara), se deja el nombre y que lo resuelva el sistema.
    return { command: p.exists(ps51) ? ps51 : 'powershell.exe', args: ['-NoLogo'] }
  }
  const env = p.env.SHELL
  if (env && p.isAbsolute(env) && p.exists(env)) return { command: env, args: ['-l'] }
  for (const s of ['/bin/zsh', '/bin/bash', '/bin/sh']) if (p.exists(s)) return { command: posixJoin(s), args: ['-l'] }
  return { command: '/bin/sh', args: ['-l'] }
}
