/** Proceso y grupo propios: ningún render usa el entorno, PATH ni herramientas de la tarea. */
import { spawn, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
}
export interface RenderOutput {
  duration?: number
  mp4?: string
  images: string[]
  ownedPids?: number[]
  avisos?: string[]
  cobertura?: { segundo: number; proporcion: number }[]
}
export type RenderProcess = (job: RenderJob, signal: AbortSignal) => Promise<RenderOutput>

const sb = (p: string): string => JSON.stringify(realpathSync(p))
export function videoSandboxProfile(job: RenderJob, worker: string): string {
  const reads = [
    job.work,
    dirname(job.paths.chrome),
    dirname(job.paths.ffmpeg),
    dirname(job.paths.ffprobe),
    job.paths.hyperframes,
    dirname(job.node),
    dirname(worker)
  ]
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec (literal ${sb(job.node)}) (literal ${sb(job.paths.chrome)}) (literal ${sb(job.paths.ffmpeg)}) (literal ${sb(job.paths.ffprobe)}))
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read* (literal "/") ${reads.map((p) => `(subpath ${sb(p)})`).join(' ')} (subpath "/System") (subpath "/usr/lib") (subpath "/Library/Fonts") (subpath "/System/Library/Fonts") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal "/usr/share/icu/icudt78l.dat"))
(allow file-write* (subpath ${sb(job.work)}) (literal "/dev/null"))
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))`
}

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
    DO_NOT_TRACK: '1'
  }
}

export function createRenderProcess(worker: string): RenderProcess {
  return (job, signal) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted()
      const args = [worker, JSON.stringify(job)]
      const child = spawn(
        process.platform === 'darwin' ? '/usr/bin/sandbox-exec' : job.node,
        process.platform === 'darwin' ? ['-p', videoSandboxProfile(job, worker), job.node, ...args] : args,
        {
          cwd: job.work,
          env: renderEnvironment(job.work, job.paths),
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
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
