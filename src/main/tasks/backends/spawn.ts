/**
 * Lanzamiento común de `opencode serve` en el anfitrión (Seatbelt y sin aislamiento). Movido SIN cambios
 * desde `sandbox.ts` (F8-B81): `withDisclaim` + `spawn` con entorno mínimo, `detached` y sin stdin.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { minimalEnv } from '../../process/child-env'
import { withDisclaim } from '../../process/disclaim'

export function spawnOnHost(command: string, args: string[], folder: string, env: Record<string, string>): ChildProcess {
  // Sin heredar los permisos TCC de la app (S6): el lanzador se ejecuta ANTES de sandbox-exec, así
  // que sandbox-exec y opencode (y todo lo que lancen) quedan desvinculados. Entorno mínimo.
  const launch = withDisclaim(command, args)
  return spawn(launch.command, launch.args, {
    cwd: folder,
    env: minimalEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
    // Líder de su propio grupo: `killTree` mata también MCP/bash (AUDIT.md B3).
    detached: true,
    // Windows (Control total sin WSL): sin ventana de consola. En macOS el objeto de opciones no cambia.
    ...(process.platform === 'win32' ? { windowsHide: true } : {})
  })
}
