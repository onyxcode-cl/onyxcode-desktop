/**
 * Lanzamiento "desvinculado" de TCC (AUDIT.md S6).
 *
 * macOS atribuye Accesibilidad / Grabación de pantalla / Automatización al "proceso responsable"
 * de la cadena: sin más, todo hijo de OnyxCode (opencode serve → bash → screencapture, MCP de
 * terceros, rutinas) usaría los permisos que el usuario concedió a OnyxCode para computer use.
 *
 * `resources/launcher/bin/onyxcode-disclaim` (C, `resources/launcher/disclaim.c`) hace un
 * `posix_spawn` con `POSIX_SPAWN_SETEXEC` y el atributo "disclaim": el programa sustituye al
 * lanzador (MISMO PID, descriptores y grupo de procesos) y pasa a ser responsable de sí mismo.
 * Se usa para TODOS los `opencode serve` (sidecar principal, Cowork con sandbox y de acceso total).
 *
 * Lo que SÍ debe conservar los permisos de OnyxCode — el MCP de computer use y su `cu-helper` — corre
 * en un utilityProcess de main (`computer/mcp-host.ts`), nunca debajo de un OpenCode desvinculado.
 *
 * Si el lanzador falta (no compilado) o no es macOS, se lanza directamente y se avisa en el log.
 */
import { app } from 'electron'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

let cached: string | null | undefined
let warned = false

function executable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Ruta del lanzador o null si no existe (no macOS / no compilado). */
export function disclaimLauncherPath(): string | null {
  if (cached !== undefined) return cached
  if (process.platform !== 'darwin' || process.env.ONYXCODE_NO_DISCLAIM === '1') return (cached = null)
  const candidates = [
    join(process.resourcesPath ?? '', 'launcher', 'onyxcode-disclaim'),
    join(app.getAppPath(), 'resources', 'launcher', 'bin', 'onyxcode-disclaim'),
    join(process.cwd(), 'resources', 'launcher', 'bin', 'onyxcode-disclaim')
  ]
  cached = candidates.find(executable) ?? null
  return cached
}

/**
 * Envuelve `command args` con el lanzador. `disclaimed=false` si no está disponible (el proceso
 * heredará los permisos TCC de OnyxCode: se registra un aviso una vez).
 */
export function withDisclaim(command: string, args: string[]): { command: string; args: string[]; disclaimed: boolean } {
  const launcher = disclaimLauncherPath()
  if (!launcher) {
    if (process.platform === 'darwin' && !warned) {
      warned = true
      console.warn(
        '[disclaim] falta resources/launcher/bin/onyxcode-disclaim (npm run build:launcher): ' +
          'los servidores OpenCode heredarán los permisos de Accesibilidad/Grabación de pantalla de la app'
      )
    }
    return { command, args, disclaimed: false }
  }
  return { command: launcher, args: [command, ...args], disclaimed: true }
}
