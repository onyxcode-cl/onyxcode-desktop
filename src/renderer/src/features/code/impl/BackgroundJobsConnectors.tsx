/**
 * Conexiones de la banda de trabajos en segundo plano con los almacenes de cada modo.
 * El aborto de ayudantes es el de siempre (`client.session.abort` sobre la sesión hija); los comandos y celdas del motor propio
 * llegan por `jobs:list` / `jobs:stop` (main habla con el motor, ver `useEngineJobs`).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { EngineJobResumeResult } from '@shared/engine-jobs'
import { useSessions } from '../../../stores/sessions'
import { isRemoteSurface } from '../../../lib/platform'
import type { OpencodeClient } from '../../../lib/opencode'
import { BackgroundJobs, useNow } from './BackgroundJobs'
import { selectBackgroundJobs } from './background-jobs'
import { selectEngineJobs } from './engine-jobs'
import { useEngineJobs } from './useEngineJobs'
import { sdkData, useClient } from './client'
import { rootSessionID, useCode } from './store'
import { canQueryFolder } from './helpers-board'
import { isFolderVerified } from './verified-folders'
import { toHelperLine } from './HelpersBoardConnector'

/** Una sola observación, también con Resumen cerrado: el indicador y la tarjeta comparten datos y sondeo. */
const CodeJobsContext = createContext<(ReturnType<typeof useCodeJobsData> & { focusRequest: number; openJobs: () => void }) | null>(null)

function useCodeJobsData(includeForeground = true) {
  const client = useClient()
  const activeSessionID = useCode((s) => s.activeSessionID)
  const sessions = useCode((s) => s.sessions)
  const sessionProject = useCode((s) => s.sessionProject)
  const status = useCode((s) => s.runState)
  const messages = useCode((s) => s.messages)
  const errors = useCode((s) => s.errors)
  const permissions = useCode((s) => s.permissions)
  const questions = useCode((s) => s.questions)
  const elicitations = useCode((s) => s.elicitations)

  const rootId = activeSessionID ? rootSessionID(sessions, activeSessionID) : null
  const pending = useMemo(
    () => [
      ...Object.values(permissions).map((p) => p.sessionID),
      ...Object.values(questions).map((q) => q.sessionID),
      ...Object.values(elicitations).map((e) => e.sessionID)
    ],
    [permissions, questions, elicitations]
  )
  const view = useLiveView({ rootId, sessions, status, messages, errors, pendingSessionIds: pending, includeForeground })
  const rootDir = rootId ? (sessionProject[rootId] ?? sessions[rootId]?.directory) : undefined
  const dirFor = (id: string): string => {
    const state = useCode.getState()
    const dir = state.sessionProject[id] ?? rootDir
    if (!client || !dir || (!isRemoteSurface() && !canQueryFolder(dir, state, isFolderVerified))) throw new Error('no-focus')
    return dir
  }
  const abort = async (id: string): Promise<void> => {
    sdkData(await client!.session.abort({ sessionID: id, directory: dirFor(id) }))
  }
  const onLoadConversation = useCallback(
    async (id: string) => {
      const state = useCode.getState()
      const dir = state.sessionProject[id] ?? (rootId ? (state.sessionProject[rootId] ?? state.sessions[rootId]?.directory) : undefined)
      if (!client || !dir || !canQueryFolder(dir, state, isFolderVerified)) throw new Error('no-focus')
      return sdkData(await client.session.messages({ sessionID: id, directory: dir })).map(toHelperLine)
    },
    [client, rootId]
  )
  const conversationVersion = (id: string): string => {
    const entries = messages[id] ?? []
    return `${entries.length}:${JSON.stringify(entries[entries.length - 1])}:${status[id] ?? ''}`
  }
  const engine = useEngineView(rootId, rootDir, status, view)
  return {
    view,
    abort,
    engine,
    onLoadConversation,
    conversationVersion,
    liveCount: view.liveCount + engine.rows.filter((job) => job.live).length
  }
}

export function CodeBackgroundJobsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const data = useCodeJobsData()
  const [focusRequest, setFocusRequest] = useState(0)
  const openJobs = (): void => {
    const state = useCode.getState()
    if (state.panel !== 'summary') state.togglePanel('summary')
    setFocusRequest((n) => n + 1)
  }
  return <CodeJobsContext.Provider value={{ ...data, focusRequest, openJobs }}>{children}</CodeJobsContext.Provider>
}

export function useCodeBackgroundJobs() {
  return useContext(CodeJobsContext)
}

/** Code: tarjeta del panel Resumen; no monta otro sondeo. */
export function CodeBackgroundJobs(): React.JSX.Element | null {
  const data = useCodeBackgroundJobs()
  if (!data) return null
  return (
    <BackgroundJobs
      layout="card"
      view={data.view}
      onCancel={data.abort}
      engineJobs={data.engine.rows}
      onStopEngineJob={data.engine.stop}
      onResumeEngineJob={data.engine.resume}
      onLoadConversation={data.onLoadConversation}
      conversationVersion={data.conversationVersion}
    />
  )
}

/** El celular no tiene Resumen: conserva sus ayudantes junto al compositor. */
export function MobileCodeBackgroundJobs(): React.JSX.Element | null {
  const data = useCodeJobsData(false)
  return <BackgroundJobs view={data.view} onCancel={data.abort} />
}

/** Datos compartidos para Chat y para la tarjeta de Tareas (su motor aislado). */
export function useSessionsJobsData({
  rootId,
  directory,
  client,
  pendingSessionIds,
  engineSource = 'main',
  includeForeground = false,
  taskFolder,
  fullAccess,
  engineJobs = true
}: {
  rootId: string | null | undefined
  directory: string
  client: OpencodeClient | null
  pendingSessionIds?: readonly string[]
  engineSource?: 'main' | 'tasks'
  includeForeground?: boolean
  taskFolder?: string
  fullAccess?: boolean
  engineJobs?: boolean
}) {
  const sessions = useSessions((s) => s.sessions)
  const status = useSessions((s) => s.status)
  const messages = useSessions((s) => s.messages)
  const errors = useSessions((s) => s.errors)
  const view = useLiveView({ rootId, sessions, status, messages, errors, pendingSessionIds, includeForeground })
  const abort = async (id: string): Promise<void> => {
    if (!client) throw new Error('no-client')
    sdkData(await client.session.abort({ sessionID: id, directory }))
  }
  const onLoadConversation = useCallback(
    async (id: string) => {
      if (!client) throw new Error('no-client')
      return sdkData(await client.session.messages({ sessionID: id, directory })).map(toHelperLine)
    },
    [client, directory]
  )
  const conversationVersion = (id: string): string => {
    const entries = messages[id] ?? []
    return `${entries.length}:${JSON.stringify(entries[entries.length - 1])}:${status[id] ?? ''}`
  }
  const engine = useEngineView(engineJobs ? rootId : null, directory, status, view, { source: engineSource, taskFolder, fullAccess })
  return {
    view,
    abort,
    engine,
    onLoadConversation,
    conversationVersion,
    liveCount: view.liveCount + engine.rows.filter((job) => job.live).length
  }
}

/** El compositor de Chat conserva su presentación de banda y solo sus ayudantes de fondo. */
export function SessionsBackgroundJobs(props: Parameters<typeof useSessionsJobsData>[0]): React.JSX.Element | null {
  const data = useSessionsJobsData(props)
  return (
    <BackgroundJobs
      view={data.view}
      onCancel={data.abort}
      engineJobs={data.engine.rows}
      onStopEngineJob={data.engine.stop}
      onResumeEngineJob={data.engine.resume}
    />
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
  view: ReturnType<typeof selectBackgroundJobs>,
  opts: { source?: 'main' | 'tasks'; taskFolder?: string; fullAccess?: boolean } = {}
): {
  rows: ReturnType<typeof selectEngineJobs>
  stop: (jobId: string) => Promise<void>
  resume: (jobId: string) => Promise<EngineJobResumeResult>
} {
  const rootRun = rootId ? status[rootId] : undefined
  const active = rootRun === 'busy' || rootRun === 'retry' || view.liveCount > 0
  const { jobs, stop, resume } = useEngineJobs({ sessionId: rootId, directory, active, ...opts })
  const hasLive = jobs.some((j) => j.state === 'en_curso')
  const now = useNow(hasLive)
  return { rows: selectEngineJobs(jobs, hasLive ? now : Date.now(), new Set(view.jobs.map((job) => job.id))), stop, resume }
}

/** Recalcula la vista cada segundo mientras haya algo vivo (el tiempo transcurrido avanza solo). */
function useLiveView(input: Omit<Parameters<typeof selectBackgroundJobs>[0], 'now'>): ReturnType<typeof selectBackgroundJobs> {
  const probe = selectBackgroundJobs({ ...input, now: Date.now() })
  const now = useNow(probe.jobs.length > 0)
  return selectBackgroundJobs({ ...input, now })
}
