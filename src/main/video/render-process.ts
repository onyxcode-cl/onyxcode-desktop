/** Proceso y grupo propios: ningún render usa el entorno, PATH ni herramientas de la tarea. */
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { VideoPaths } from '@shared/video'
import { parseRenderError } from './render-errors'

export interface RenderJob {
  work: string
  composition: string
  width: number
  height: number
  seconds?: number
  times: number[]
  paths: VideoPaths
  node: string
  audio?: (import('./project-input').AudioInput & { file: string })[]
}
export interface RenderOutput {
  duration?: number
  mp4?: string
  images: string[]
  contactSheet?: string
  revision?: { oficial: boolean; hojaOficial: boolean; fuentesLocales?: number; alcance: string }
  movimiento?: { porcentajeQuieto: number; tramos: { inicio: number; fin: number }[]; intervalo: number; aviso: string | null }
  audio?: { codec: string; duration: number }
  ownedPids?: number[]
  avisos?: string[]
  cobertura?: { segundo: number; proporcion: number }[]
}
export type RenderProcess = (job: RenderJob, signal: AbortSignal) => Promise<RenderOutput>

export function renderEnvironment(work: string, paths: VideoPaths): Record<string, string> {
  return {
    ...(process.platform === 'win32'
      ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', WINDIR: process.env.WINDIR ?? 'C:\\Windows' }
      : {}),
    HOME: work,
    USERPROFILE: work,
    TMPDIR: work,
    TMP: work,
    TEMP: work,
    XDG_CONFIG_HOME: work,
    XDG_CACHE_HOME: work,
    XDG_DATA_HOME: work,
    HYPERFRAMES_BROWSER_PATH: paths.chrome,
    HYPERFRAMES_FFMPEG_PATH: paths.ffmpeg,
    HYPERFRAMES_FFPROBE_PATH: paths.ffprobe,
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_NO_AUTO_INSTALL: '1',
    HYPERFRAMES_NO_OPTIONAL_INSTALL: '1',
    DO_NOT_TRACK: '1'
  }
}

export type RenderLauncher = (job: RenderJob, worker: string, args: string[]) => { cmd: string; args: string[] }
/** Sin aislamiento propio (Windows): el worker corre con su proxy a la nada. En macOS, index.ts pasa el lanzador de Seatbelt
 *  (`render-seatbelt.ts`, cargado con import() solo en darwin para que Windows no lleve ese código). */
export const plainLauncher: RenderLauncher = (job, _worker, args) => ({ cmd: job.node, args })

export function createRenderProcess(worker: string, launcher: RenderLauncher = plainLauncher): RenderProcess {
  return (job, signal) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted()
      const launch = launcher(job, worker, [worker, JSON.stringify(job)])
      const child = spawn(launch.cmd, launch.args, {
        cwd: job.work,
        env: renderEnvironment(job.work, job.paths),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      let killed = false
      const kill = (): void => {
        if (!child.pid || killed) return
        killed = true
        if (process.platform === 'win32')
          spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            timeout: 15_000
          })
        else {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            /* grupo ya terminado */
          }
        }
      }
      const abort = (): void => kill()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) kill()
      // stdin es la vigía: si main muere, el worker cierra sus hijos y termina.
      child.stdin.on('error', () => undefined)
      child.stdout.on('data', (b: Buffer) => {
        stdout += b.toString()
        if (stdout.length > 64 * 1024) kill()
      })
      child.stderr.on('data', (b: Buffer) => {
        stderr = (stderr + b.toString()).slice(-4096)
      })
      child.once('error', reject)
      child.once('close', (code) => {
        signal.removeEventListener('abort', abort)
        kill() // también tras éxito: recoge descendientes que no salieron con el worker
        if (signal.aborted) return reject(new Error('El video se canceló.'))
        if (code !== 0) {
          console.warn('[video] proceso:', stderr)
          try {
            const error = parseRenderError(JSON.parse(stdout))
            if (error) return reject(error)
          } catch {
            /* un rechazo del sandbox no tiene respuesta del worker */
          }
          return reject(new Error('No se pudo renderizar con el aislamiento de video.'))
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error('El render no devolvió un resultado válido.'))
        }
      })
    })
}
