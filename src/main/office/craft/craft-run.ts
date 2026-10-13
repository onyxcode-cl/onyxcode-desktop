/**
 * PRUEBA (rama `exp/craft-office-pruebas`): ejecución segura de los programas de línea de comandos de ArtCraft desde el proceso principal:
 * sin shell, con tope de tiempo y con un entorno MÍNIMO por plataforma cuyas carpetas de datos son una carpeta temporal propia (el
 * programa no toca ni lee la configuración del usuario).
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Entorno mínimo para ejecutar un programa de ArtCraft con todo apuntando a `home`. */
export function craftEnv(home: string, platform: string = process.platform): NodeJS.ProcessEnv {
  if (platform === 'win32') {
    const root = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows'
    return {
      SystemRoot: root,
      PATH: `${root}\\System32;${root}`,
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      TEMP: home,
      TMP: home
    }
  }
  return { PATH: '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home }
}

/** Ejecuta `binary args…` con carpeta de datos temporal propia (se borra al terminar). Lanza con un mensaje corto si falla. */
export async function runCraft(binary: string, args: string[], timeoutMs: number): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'lazunox-craft-home-'))
  try {
    await new Promise<void>((ok, fail) => {
      execFile(
        binary,
        args,
        { timeout: timeoutMs, maxBuffer: 1 << 20, env: craftEnv(home), cwd: home, windowsHide: true },
        (err, _o, stderr) => (err ? fail(new Error(String(stderr || err.message).slice(0, 300))) : ok())
      )
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
