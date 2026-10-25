import type { IpcMain } from 'electron'
import { parseEngineJobs, parseResumeResult, type EngineJobResumeResult, type EngineJobsResult } from '@shared/engine-jobs'
import type { OpencodeConnection } from '@shared/types'
import type { OpencodeServer } from '../opencode/server'
import { handle, IpcError } from './handle'

/**
 * Trabajos en segundo plano del motor propio (comandos y Code Mode): el renderer pide por IPC y main habla con el sidecar
 * (`fetch` con la autorización de siempre). Rutas del contrato 1.7: `GET …/trabajos` `POST …/trabajos/{id}/terminar` y `POST …/trabajos/{id}/reanudar`.
 * Si el motor no las tiene (oficial, externo o anterior: 404/405) se contesta `available: false` y el panel sigue con los ayudantes.
 */

type Conn = Pick<OpencodeConnection, 'baseUrl' | 'authorization'>
type FetchLike = typeof fetch

const TIMEOUT_MS = 4000

function urlFor(conn: Conn, sessionID: string, directory: string | undefined, tail: string): string {
  const q = directory ? `?directory=${encodeURIComponent(directory)}` : ''
  return `${conn.baseUrl}/experimental/session/${encodeURIComponent(sessionID)}/trabajos${tail}${q}`
}

export async function fetchEngineJobs(
  conn: Conn,
  req: { sessionID: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<EngineJobsResult> {
  const res = await fetchImpl(urlFor(conn, req.sessionID, req.directory, ''), {
    headers: { Authorization: conn.authorization },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { available: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  return { available: true, jobs: parseEngineJobs(await res.json().catch(() => null)) }
}

export async function stopEngineJob(
  conn: Conn,
  req: { sessionID: string; jobId: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: boolean }> {
  const res = await fetchImpl(urlFor(conn, req.sessionID, req.directory, `/${encodeURIComponent(req.jobId)}/terminar`), {
    method: 'POST',
    headers: { Authorization: conn.authorization },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { ok: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const body = (await res.json().catch(() => null)) as { ok?: unknown } | null
  return { ok: body?.ok === true }
}

/** Reanuda un ayudante perdido. 404/405 (motor sin la ruta) = `no_existe`: nada que reanudar. */
export async function resumeEngineJob(
  conn: Conn,
  req: { sessionID: string; jobId: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<EngineJobResumeResult> {
  const res = await fetchImpl(urlFor(conn, req.sessionID, req.directory, `/${encodeURIComponent(req.jobId)}/reanudar`), {
    method: 'POST',
    headers: { Authorization: conn.authorization },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { ok: false, motivo: 'no_existe' }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  return parseResumeResult(await res.json().catch(() => null))
}

export function registerEngineJobsHandlers(ipcMain: IpcMain, server: OpencodeServer): void {
  const conn = (): Conn => {
    const c = server.getConnection()
    if (!c) throw new IpcError('NOT_READY', 'El motor aún no está listo')
    return c
  }
  handle(ipcMain, 'jobs:list', (req) => fetchEngineJobs(conn(), req))
  handle(ipcMain, 'jobs:stop', (req) => stopEngineJob(conn(), req))
  handle(ipcMain, 'jobs:resume', (req) => resumeEngineJob(conn(), req))
}
