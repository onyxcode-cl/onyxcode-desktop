/**
 * Comprobación de acceso a una carpeta CON LA IDENTIDAD DEL MOTOR (solo macOS).
 *
 * `opencode serve` se lanza con `lazunox-disclaim` (docs/SEGURIDAD.md §3): es responsable de sí mismo ante TCC y NO hereda los
 * permisos de carpetas de Lazunox. Así, aunque el selector dé acceso a Lazunox (y `checkFolderAccess` vea `ok`), el motor puede
 * recibir `EPERM … lstat '<carpeta>'` y la interfaz solo mostraría «Unexpected server error». Esta sonda lanza el MISMO binario,
 * con el MISMO envoltorio y un entorno mínimo, con un subcomando inofensivo que solo lista la carpeta (`opencode debug file list
 * --pure .` con `cwd` = la carpeta: hace `lstat` + `readdir`, como el motor al abrir el proyecto). HOME/XDG temporales (no toca la
 * configuración ni los datos de la persona), sin plugins externos, plazo corto y SIGKILL al vencer (con SETEXEC el PID es el mismo).
 */
import type { ExecFileException } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** `unavailable`: no hay binario o no se pudo lanzar; no bloquea (falla abierto, como la comprobación de Lazunox). */
export type EngineProbeResult = 'ok' | 'denied' | 'timeout' | 'unavailable'

export interface RunResult {
  /** Error de `execFile` (o `null` si salió con 0). */
  error: ExecFileException | null
  stdout: string
  stderr: string
}

export interface EngineProbeDeps {
  /** Ruta del binario del motor (la misma que usa `server.ts`) o `null`. */
  binary: () => string | null
  /** Envuelve con `lazunox-disclaim` (la misma función que `server.ts`). */
  wrap: (command: string, args: string[]) => { command: string; args: string[] }
  /** `execFile` sin shell; nunca rechaza: devuelve el error junto a la salida. */
  run: (file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<RunResult>
  timeoutMs: number
}

/** Margen para que la persona responda si macOS pregunta por el motor (mismo plazo que la comprobación de Lazunox). */
export const ENGINE_PROBE_TIMEOUT_MS = 20_000

const DENIED_RE = /\b(EPERM|EACCES)\b|operation not permitted|permission denied/i

/** Clasifica la salida de la sonda. Exportada para las pruebas. */
export function classifyEngineProbe(r: RunResult): EngineProbeResult {
  // Solo stderr: stdout es la lista de nombres de la carpeta (un archivo puede llamarse «EPERM»).
  const text = r.stderr
  if (!r.error) return DENIED_RE.test(text) ? 'denied' : 'ok'
  // Carpeta enorme: el motor la pudo listar (Node lo corta por tamaño de salida, no por plazo).
  if (r.error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'ok'
  // Plazo vencido: el aviso de macOS puede estar esperando respuesta; nunca se trata como «denegado».
  if (r.error.killed || r.error.code === 'ETIMEDOUT') return 'timeout'
  // `cwd` ilegible al lanzar (chdir lo hace todavía Lazunox): permiso de archivo, no de TCC, pero el motor tampoco podría.
  if (r.error.code === 'EACCES' || r.error.code === 'EPERM') return 'denied'
  if (r.error.code === 'ENOENT') return 'unavailable'
  if (DENIED_RE.test(text)) return 'denied'
  // Cualquier otro fallo (versión del motor sin este subcomando, etc.): no bloquea; lo informará el motor.
  return 'ok'
}

export async function probeFolderAsEngine(path: string, deps: EngineProbeDeps): Promise<EngineProbeResult> {
  const bin = deps.binary()
  if (!bin) return 'unavailable'
  const home = await mkdtemp(join(tmpdir(), 'lazunox-probe-'))
  try {
    const launch = deps.wrap(bin, ['debug', 'file', 'list', '--pure', '.'])
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_STATE_HOME: join(home, 'state'),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: home,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
      NO_COLOR: '1'
    }
    const r = await deps.run(launch.command, launch.args, { cwd: path, env, timeoutMs: deps.timeoutMs })
    return classifyEngineProbe(r)
  } catch {
    return 'unavailable'
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
}
