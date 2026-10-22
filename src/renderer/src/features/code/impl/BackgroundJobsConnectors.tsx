/**
 * Conexiones de la banda de trabajos en segundo plano con los almacenes de cada modo.
 * El aborto es el de siempre (`client.session.abort` sobre la sesión hija): no hay canales nuevos.
 */
import { useMemo } from 'react'
import { useSessions } from '../../../stores/sessions'
import type { OpencodeClient } from '../../../lib/opencode'
import { BackgroundJobs, useNow } from './BackgroundJobs'
import { selectBackgroundJobs } from './background-jobs'
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
  return <BackgroundJobs view={view} onCancel={abort} />
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
  return <BackgroundJobs view={view} onCancel={abort} />
}

/** Recalcula la vista cada segundo mientras haya algo vivo (el tiempo transcurrido avanza solo). */
function useLiveView(input: Omit<Parameters<typeof selectBackgroundJobs>[0], 'now'>): ReturnType<typeof selectBackgroundJobs> {
  const probe = selectBackgroundJobs({ ...input, now: Date.now() })
  const now = useNow(probe.jobs.length > 0)
  return selectBackgroundJobs({ ...input, now })
}
