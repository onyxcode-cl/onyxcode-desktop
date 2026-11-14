/** Puente local del MCP al panel: solo estado y órdenes de parar trabajos ya conocidos, nunca PIDs ni comandos. */
import { readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import type { BackgroundShellManager } from './manager'
import type { JobStatus } from './types'

export interface PanelJob {
  id: string
  sessionID: string
  command: string
  state: JobStatus['state']
  startedAt: number
  endedAt: number | null
  exitCode: number | null
}
const validID = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v)
const snapshot = (file: string): string => `${file}.jobs.json`
const stopFile = (file: string, id: string): string => `${file}.stop-${id}.json`

/** Lectura acotada; un MCP muerto o un archivo inválido no presenta trabajos vivos. */
export function readPanelJobs(file: string, now = Date.now()): PanelJob[] {
  try {
    const raw = readFileSync(snapshot(file), 'utf8')
    if (raw.length > 128 * 1024) return []
    const body = JSON.parse(raw)
    if (typeof body.at !== 'number' || Math.abs(now - body.at) > 10_000 || !Array.isArray(body.jobs)) return []
    return body.jobs
      .slice(0, 50)
      .filter(
        (j: PanelJob) =>
          j &&
          validID(j.id) &&
          validID(j.sessionID) &&
          typeof j.command === 'string' &&
          j.command.length <= 300 &&
          ['running', 'possibly-stuck', 'exited', 'stopped', 'killed-limit'].includes(j.state) &&
          Number.isFinite(j.startedAt) &&
          (j.endedAt === null || Number.isFinite(j.endedAt)) &&
          (j.exitCode === null || Number.isFinite(j.exitCode))
      )
  } catch {
    return []
  }
}

export async function requestPanelStop(file: string, id: string, sessionID: string): Promise<boolean> {
  if (!validID(id) || !validID(sessionID)) return false
  const job = readPanelJobs(file).find((j) => j.id === id && j.sessionID === sessionID)
  if (!job || !['running', 'possibly-stuck'].includes(job.state)) return false
  const path = stopFile(file, id)
  try {
    writeFileSync(path, JSON.stringify({ sessionID }), { mode: 0o600 })
    const end = Date.now() + 4000
    while (Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const current = readPanelJobs(file).find((j) => j.id === id && j.sessionID === sessionID)
      if (current && !['running', 'possibly-stuck'].includes(current.state)) return true
    }
    return false
  } finally {
    try {
      unlinkSync(path)
    } catch {
      /* consumida */
    }
  }
}

/** Corre en el MCP. El dueño se obtiene del argumento que inyecta el plugin, y se vuelve a validar antes de parar. */
export function createPanelControl(
  file: string,
  manager: BackgroundShellManager,
  ownerOf: (id: string) => string | undefined
): {
  publish: () => void
  poll: () => Promise<void>
} {
  let polling = false
  const publish = (): void => {
    const jobs = manager.list().flatMap((j): PanelJob[] => {
      const sessionID = ownerOf(j.id)
      return sessionID && validID(sessionID)
        ? [
            {
              id: j.id,
              sessionID,
              command: j.command.slice(0, 300),
              state: j.state,
              startedAt: j.startedAt,
              endedAt: j.endedAt,
              exitCode: j.exitCode
            }
          ]
        : []
    })
    try {
      const path = snapshot(file)
      writeFileSync(`${path}.tmp`, JSON.stringify({ at: Date.now(), jobs }), { mode: 0o600 })
      renameSync(`${path}.tmp`, path)
    } catch {
      /* el panel no impide ejecutar ni cerrar el MCP */
    }
  }
  return {
    publish,
    async poll() {
      if (polling) return
      polling = true
      try {
        for (const j of manager.list()) {
          const path = stopFile(file, j.id)
          try {
            const raw = readFileSync(path, 'utf8')
            unlinkSync(path)
            const owner = ownerOf(j.id)
            const requested = raw.length <= 512 ? JSON.parse(raw).sessionID : null
            if (validID(owner) && validID(requested) && requested === owner) await manager.stop(j.id)
          } catch {
            /* sin petición válida */
          }
        }
        publish()
      } finally {
        polling = false
      }
    }
  }
}
