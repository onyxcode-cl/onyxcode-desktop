/** Puente local del MCP al panel: solo estado y órdenes de parar trabajos ya conocidos, nunca PIDs ni comandos. */
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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
const stopFile = (file: string, id: string): string => `${file}.stop-${id}.json`

// OpenCode crea un MCP por directorio: cada escritor necesita su propio snapshot y archivo temporal.
function snapshotFiles(file: string): string[] {
  try {
    const prefix = `${basename(file)}.jobs-`
    return readdirSync(dirname(file))
      .filter((name) => name.startsWith(prefix) && /^[a-f0-9]{24}\.json$/.test(name.slice(prefix.length)))
      .map((name) => join(dirname(file), name))
  } catch {
    return []
  }
}

function snapshots(file: string): string[] {
  return snapshotFiles(file)
    .map((path) => {
      try {
        return { path, at: statSync(path).mtimeMs }
      } catch {
        return { path, at: 0 }
      }
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 128)
    .map(({ path }) => path)
}

/** Lectura acotada; un MCP muerto o un archivo inválido no presenta trabajos vivos. */
export function readPanelJobs(file: string, now = Date.now()): PanelJob[] {
  return snapshots(file).flatMap((path) => readSnapshot(path, now))
}

function readSnapshot(path: string, now: number): PanelJob[] {
  try {
    const raw = readFileSync(path, 'utf8')
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
  const source = snapshots(file).find((path) =>
    readSnapshot(path, Date.now()).some((j) => j.id === id && j.sessionID === sessionID && ['running', 'possibly-stuck'].includes(j.state))
  )
  if (!source) return false
  const path = stopFile(source, id)
  try {
    writeFileSync(path, JSON.stringify({ sessionID }), { mode: 0o600 })
    const end = Date.now() + 4000
    while (Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const current = readSnapshot(source, Date.now()).find((j) => j.id === id && j.sessionID === sessionID)
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
  // Se limpian restos caducados al crear cada MCP; un escritor que vuelva a publicar recrea su archivo.
  for (const old of snapshotFiles(file)) {
    try {
      if (Date.now() - statSync(old).mtimeMs > 10_000) unlinkSync(old)
    } catch {
      /* otro MCP puede haberlo retirado */
    }
  }
  const path = `${file}.jobs-${randomBytes(12).toString('hex')}.json`
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
          const request = stopFile(path, j.id)
          try {
            const raw = readFileSync(request, 'utf8')
            unlinkSync(request)
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
