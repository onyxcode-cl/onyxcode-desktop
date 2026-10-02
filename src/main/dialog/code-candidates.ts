import { join as winJoin } from 'node:path/win32'

/**
 * Candidatos de VS Code por plataforma. En Windows `code` es `code.cmd` (no arranca sin shell), así que se
 * usa `Code.exe` de las rutas de instalación habituales (por usuario y del sistema); si no está, `openInEditor`
 * cae a `shell.openPath`. Pura (recibe el entorno) para poder probarla.
 */
export function codeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const get = (n: string): string | undefined => env[Object.keys(env).find((k) => k.toLowerCase() === n.toLowerCase()) ?? n]
    const out: string[] = []
    const local = get('LOCALAPPDATA')
    if (local) out.push(winJoin(local, 'Programs', 'Microsoft VS Code', 'Code.exe'))
    for (const v of ['ProgramFiles', 'ProgramFiles(x86)']) {
      const base = get(v)
      if (base) out.push(winJoin(base, 'Microsoft VS Code', 'Code.exe'))
    }
    return out
  }
  return ['code', '/usr/local/bin/code', '/opt/homebrew/bin/code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
}
