/**
 * Registro de PIDs de las ejecuciones del manager, para limpiar restos tras un cierre brusco.
 *
 * Cada manager tiene su carpeta `<baseDir>/o-XXXX/` (0700) con `registry.json` (0600): su propio PID y marca de identidad y,
 * por trabajo, PID/PGID y marca de identidad. Al arrancar, `cleanupStaleRuns` recorre las carpetas: si el DUEÑO ya no es el
 * mismo proceso (murió), cada trabajo cuyo PID siga siendo el MISMO proceso (misma marca de inicio) recibe SIGTERM/SIGKILL en
 * su grupo. Un PID reutilizado por otro proceso, o cuya identidad no se puede comprobar, NO se toca.
 */
import { join } from 'node:path'
import type { ShellBgFs } from './fs-port'
import type { ProcessPort } from './process-port'

export const REGISTRY_FILE = 'registry.json'
export const OWNER_DIR_PREFIX = 'o-'

export interface RegistryJob {
  id: string
  pid: number
  /** Marca de identidad del proceso líder; `null` = no verificable (no se mata nunca). */
  identity: string | null
}

export interface RegistryData {
  version: 1
  owner: { pid: number; identity: string | null }
  jobs: RegistryJob[]
}

export class PidRegistry {
  private jobs = new Map<string, RegistryJob>()
  constructor(
    private readonly fs: ShellBgFs,
    private readonly dir: string,
    private readonly owner: { pid: number; identity: string | null }
  ) {}

  upsert(job: RegistryJob): void {
    this.jobs.set(job.id, job)
    this.write()
  }
  remove(id: string): void {
    if (this.jobs.delete(id)) this.write()
  }
  write(): void {
    const data: RegistryData = { version: 1, owner: this.owner, jobs: [...this.jobs.values()] }
    try {
      this.fs.writeFile(join(this.dir, REGISTRY_FILE), JSON.stringify(data), 0o600)
    } catch {
      /* sin registro la limpieza de restos pierde cobertura, pero el cierre normal sigue funcionando */
    }
  }
}

export interface CleanupDeps {
  fs: ShellBgFs
  port: ProcessPort
  baseDir: string
  /** Carpeta del propio manager: no se toca. */
  ownDir?: string | null
  graceMs: number
  sleep(ms: number): Promise<void>
}

export interface CleanupReport {
  /** PIDs a los que se les cortó el grupo. */
  killed: number[]
  /** PIDs que NO se tocaron (PID reutilizado por otro proceso o identidad no verificable). */
  skipped: number[]
  removedDirs: string[]
}

function parseRegistry(text: string | null): RegistryData | null {
  if (!text) return null
  try {
    const d = JSON.parse(text) as RegistryData
    if (d?.version !== 1 || typeof d.owner?.pid !== 'number' || !Array.isArray(d.jobs)) return null
    return d
  } catch {
    return null
  }
}

export async function cleanupStaleRuns(deps: CleanupDeps): Promise<CleanupReport> {
  const report: CleanupReport = { killed: [], skipped: [], removedDirs: [] }
  for (const name of deps.fs.readdir(deps.baseDir)) {
    if (!name.startsWith(OWNER_DIR_PREFIX)) continue
    const dir = join(deps.baseDir, name)
    if (deps.ownDir && dir === deps.ownDir) continue
    const data = parseRegistry(deps.fs.readText(join(dir, REGISTRY_FILE)))
    if (!data) continue // sin registro legible no sabemos de quién es: se deja
    // ¿Sigue vivo el dueño (el mismo proceso)? Entonces es otro manager activo y no se toca. Sin marca verificable: tampoco.
    if (data.owner.identity === null) continue
    const ownerNow = await deps.port.identity(data.owner.pid)
    if (ownerNow === data.owner.identity) continue
    const toKill: number[] = []
    for (const j of data.jobs) {
      const now = j.identity === null ? null : await deps.port.identity(j.pid)
      if (now !== null && now === j.identity) {
        deps.port.killGroup(j.pid, 'SIGTERM')
        toKill.push(j.pid)
        report.killed.push(j.pid)
      } else {
        report.skipped.push(j.pid)
      }
    }
    if (toKill.length > 0) {
      await deps.sleep(Math.min(deps.graceMs, 1500))
      for (const pid of toKill) if (deps.port.groupAlive(pid)) deps.port.killGroup(pid, 'SIGKILL')
    }
    try {
      deps.fs.rmrf(dir)
      report.removedDirs.push(dir)
    } catch {
      /* se reintenta en el próximo arranque */
    }
  }
  return report
}
