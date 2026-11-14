/** Une las fuentes de la app con /trabajos sin cambiar el motor ni aceptar rutas o PIDs del renderer. */
import type { EngineJob, EngineJobsResult } from '@shared/engine-jobs'
import { readPanelJobs, requestPanelStop } from '../background-shell/panel-control'
import { hostBackgroundJobs, stopHostBackgroundJob } from '../host-exec/runner'
import { createSdkWakeEngine, resolveRootSession } from '../opencode/shell-bg-wake'

type Conn = { baseUrl: string; authorization: string }
export interface AppJobsScope {
  eventsFile?: string | null
  hostFolder?: string
}

async function ownedJobs(
  conn: Conn,
  sessionID: string,
  scope: AppJobsScope
): Promise<
  Array<{
    job: EngineJob
    sessionID: string
    source: 'bgshell' | 'host'
  }>
> {
  const jobs = [
    ...(scope.eventsFile
      ? readPanelJobs(scope.eventsFile).map((j) => ({
          sessionID: j.sessionID,
          source: 'bgshell' as const,
          job: {
            id: `bgshell_${j.id}`,
            kind: 'shell' as const,
            title: j.command,
            startedAt: j.startedAt,
            endedAt: j.endedAt,
            code: j.exitCode,
            state: (j.state === 'running' || j.state === 'possibly-stuck'
              ? 'en_curso'
              : j.state === 'stopped'
                ? 'terminado_por_ti'
                : j.state === 'killed-limit'
                  ? 'tope_de_vida'
                  : 'terminado') as EngineJob['state']
          }
        }))
      : []),
    ...(scope.hostFolder ? hostBackgroundJobs(scope.hostFolder).map((j) => ({ ...j, source: 'host' as const })) : [])
  ]
  const engine = createSdkWakeEngine(conn)
  const owners = new Map<string, Promise<boolean>>()
  for (const j of jobs)
    if (!owners.has(j.sessionID))
      owners.set(
        j.sessionID,
        resolveRootSession((id) => engine.getSession(id), j.sessionID).then((r) => r.kind === 'ok' && r.rootID === sessionID)
      )
  const matches = await Promise.all(jobs.map((j) => owners.get(j.sessionID)))
  return jobs.filter((_, i) => matches[i])
}

export async function mergeAppBackgroundJobs(
  conn: Conn,
  sessionID: string,
  scope: AppJobsScope,
  engine: EngineJobsResult
): Promise<EngineJobsResult> {
  const jobs = await ownedJobs(conn, sessionID, scope)
  if (!scope.eventsFile && !scope.hostFolder) return engine
  return { available: true, jobs: [...(engine.available ? engine.jobs : []), ...jobs.map((j) => j.job)] }
}

export async function stopAppBackgroundJob(conn: Conn, sessionID: string, jobID: string, scope: AppJobsScope): Promise<boolean> {
  const item = (await ownedJobs(conn, sessionID, scope)).find((j) => j.job.id === jobID)
  if (!item) return false
  return item.source === 'bgshell' && scope.eventsFile
    ? requestPanelStop(scope.eventsFile, item.job.id.slice('bgshell_'.length), item.sessionID)
    : !!scope.hostFolder && stopHostBackgroundJob(item.job.id, scope.hostFolder, item.sessionID)
}

export const isAppBackgroundJob = (id: string): boolean => id.startsWith('bgshell_') || id.startsWith('host_')
