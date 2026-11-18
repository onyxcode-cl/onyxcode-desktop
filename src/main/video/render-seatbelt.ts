// Solo macOS: perfil de Seatbelt del render de video. Se carga con import() dinámico desde render-process.ts únicamente en darwin.
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RenderJob } from './render-process'

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

export function seatbeltLaunch(job: RenderJob, worker: string, args: string[]): { cmd: string; args: string[] } {
  return { cmd: '/usr/bin/sandbox-exec', args: ['-p', videoSandboxProfile(job, worker), job.node, ...args] }
}
