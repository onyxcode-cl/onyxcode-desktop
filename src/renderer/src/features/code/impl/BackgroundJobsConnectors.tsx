/**
 * Conexiones de la banda de trabajos en segundo plano con los almacenes de cada modo.
 * El aborto de ayudantes es el de siempre (`client.session.abort` sobre la sesión hija); los comandos y celdas del motor propio
 * llegan por `jobs:list` / `jobs:stop` (main habla con el motor, ver `useEngineJobs`).
 */
import { useMemo } from 'react'
import type { EngineJobResumeResult } from '@shared/engine-jobs'
import { useSessions } from '../../../stores/sessions'
import type { OpencodeClient } from '../../../lib/opencode'
import { BackgroundJobs, useNow } from './BackgroundJobs'
import { selectBackgroundJobs } from './background-jobs'
import { selectEngineJobs } from './engine-jobs'
import { useEngineJobs } from './useEngineJobs'
import { sdkData, useClient } from './client'
import { rootSessionID, useCode } from './store'

/** Code: la sesión activa (su raíz) con los datos del almacén de Code. */
export function CodeBackgroundJobs(): React.JSX.Element | null {
  const client = useClient()
  const activeSessionID = useCode((s) => s.activeSessionID)
  const sessions = useCode((s) => s.sessions)
  const sessionProject = useCode((s) => s.sessionProject)
  const status = useCode((s) => s.runState)
  const messages = useCode((s) => s.messages)
  const errors = useCode((s) => s.errors)
  const permissions = useCode((s) => s.permissions)
  const questions = useCode((s) => s.questions)

  const rootId = activeSessionID ? rootSessionID(sessions, activeSessionID) : null
  const pending = useMemo(
    () => [...Object.values(permissions).map((p) => p.sessionID), ...Object.values(questions).map((q) => q.sessionID)],
    [permissions, questions]
  )
  const view = useLiveView({ rootId, sessions, status, messages, errors, pendingSessionIds: pending })
  const abort = async (id: string): Promise<void> => {
    if (!client) throw new Error('no-client')
    const dir = sessionProject[id] ?? (rootId ? sessionProject[rootId] : undefined) ?? sessions[id]?.directory
    sdkData(await client.session.abort({ sessionID: id, directory: dir }))
  }
  const engine = useEngineView(rootId, rootId ? (sessionProject[rootId] ?? sessions[rootId]?.directory) : undefined, status, view.liveCount)
  return (
    <BackgroundJobs view={view} onCancel={abort} engineJobs={engine.rows} onStopEngineJob={engine.stop} onResumeEngineJob={engine.resume} />
  )
}

/** Tareas y Chat: comparten `useSessions`; el que monta dice qué sesión es la raíz, dónde vive y quién tiene algo pendiente. */
export function SessionsBackgroundJobs({
  rootId,
  directory,
  client,
  pendingSessionIds
}: {
  rootId: string | null | undefined
  directory: string
  client: OpencodeClient | null
  pendingSessionIds?: readonly string[]
}): React.JSX.Element | null {
  const sessions = useSessions((s) => s.sessions)
  const status = useSessions((s) => s.status)
  const messages = useSessions((s) => s.messages)
  const errors = useSessions((s) => s.errors)
  const view = useLiveView({ rootId, sessions, status, messages, errors, pendingSessionIds })
  const abort = async (id: string): Promise<void> => {
    if (!client) throw new Error('no-client')
    sdkData(await client.session.abort({ sessionID: id, directory }))
  }
  const engine = useEngineView(rootId, directory, status, view.liveCount)
  return (
    <BackgroundJobs view={view} onCancel={abort} engineJobs={engine.rows} onStopEngineJob={engine.stop} onResumeEngineJob={engine.resume} />
  )
}

/**
 * Trabajos del motor propio de la conversación raíz, listos para pintar. Se sondea mientras la raíz trabaja o haya
 * ayudantes vivos (además de lo que ya esté en curso, que lo decide el propio hook).
 */
function useEngineView(
  rootId: string | null | undefined,
  directory: string | undefined,
  status: Record<string, 'idle' | 'busy' | 'retry' | undefined>,
  liveHelpers: number
): {
  rows: ReturnType<typeof selectEngineJobs>
  stop: (jobId: string) => Promise<void>
  resume: (jobId: string) => Promise<EngineJobResumeResult>
} {
  const rootRun = rootId ? status[rootId] : undefined
  const active = rootRun === 'busy' || rootRun === 'retry' || liveHelpers > 0
  const { jobs, stop, resume } = useEngineJobs({ sessionId: rootId, directory, active })
  const hasLive = jobs.some((j) => j.state === 'en_curso')
  const now = useNow(hasLive)
  return { rows: selectEngineJobs(jobs, hasLive ? now : Date.now()), stop, resume }
}

/** Recalcula la vista cada segundo mientras haya algo vivo (el tiempo transcurrido avanza solo). */
function useLiveView(input: Omit<Parameters<typeof selectBackgroundJobs>[0], 'now'>): ReturnType<typeof selectBackgroundJobs> {
  const probe = selectBackgroundJobs({ ...input, now: Date.now() })
  const now = useNow(probe.jobs.length > 0)
  return selectBackgroundJobs({ ...input, now })
}
