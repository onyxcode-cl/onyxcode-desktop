import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineJob, EngineJobResumeResult } from '@shared/engine-jobs'
import { call } from '../../../lib/api'
import { isRemoteSurface } from '../../../lib/platform'
import { cw } from '../../tasks/impl/bridge'
import { ENGINE_JOBS_POLL_MS } from './engine-jobs'

/**
 * Trabajos del motor propio de una conversación, con sondeo suave: solo mientras haya uno en curso o `active` (la
 * conversación trabaja o hay ayudantes vivos). Se consulta una vez al abrir la conversación y otra al cambiar `active`
 * (atrapa un comando lanzado justo antes de quedar ociosa). Si el motor no tiene la ruta (`available: false`) no se vuelve a
 * preguntar en esa conversación; un fallo de red conserva lo último y no se muestra. El celular no consulta (canales solo de escritorio).
 */
export function useEngineJobs(opts: {
  sessionId: string | null | undefined
  directory?: string
  active: boolean
  source?: 'main' | 'tasks'
  /** Carpeta HOST autorizada de Tareas. main elige la ruta SDK (WSL en Windows). */
  taskFolder?: string
  fullAccess?: boolean
}): {
  jobs: EngineJob[]
  stop: (jobId: string) => Promise<void>
  /** Reanuda un ayudante perdido; devuelve lo que contestó el motor (`motivo` si no pudo). */
  resume: (jobId: string) => Promise<EngineJobResumeResult>
  refresh: () => Promise<void>
} {
  const { sessionId, directory, active, source = 'main', taskFolder, fullAccess = false } = opts
  const [jobs, setJobs] = useState<EngineJob[]>([])
  const [available, setAvailable] = useState(true)
  const gen = useRef(0)
  const enabled = !!sessionId && !isRemoteSurface() && (source === 'main' || !!taskFolder)

  useEffect(() => {
    gen.current++
    setJobs([])
    setAvailable(true)
  }, [sessionId, directory, source, taskFolder, fullAccess])

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || !sessionId) return
    const mine = gen.current
    try {
      const res =
        source === 'tasks'
          ? await cw('tasks:jobs:list', { sessionID: sessionId, folder: taskFolder!, fullAccess })
          : await call('jobs:list', { sessionID: sessionId, ...(directory ? { directory } : {}) })
      if (mine !== gen.current) return
      if (!res.available) {
        setAvailable(false)
        setJobs([])
      } else setJobs(res.jobs)
    } catch {
      /* sin error visible: se conserva lo último y el próximo sondeo reintenta */
    }
  }, [enabled, sessionId, directory, source, taskFolder, fullAccess])

  useEffect(() => {
    if (available) void refresh()
  }, [available, refresh, active])

  const hasLive = jobs.some((j) => j.state === 'en_curso')
  const poll = enabled && available && (active || hasLive)
  useEffect(() => {
    if (!poll) return undefined
    const id = setInterval(() => void refresh(), ENGINE_JOBS_POLL_MS)
    return () => clearInterval(id)
  }, [poll, refresh])

  const stop = useCallback(
    async (jobId: string): Promise<void> => {
      if (!enabled || !sessionId) throw new Error('no-session')
      const result =
        source === 'tasks'
          ? await cw('tasks:jobs:stop', { sessionID: sessionId, jobId, folder: taskFolder!, fullAccess })
          : await call('jobs:stop', { sessionID: sessionId, jobId, ...(directory ? { directory } : {}) })
      if (!result.ok) throw new Error('stop-failed')
      await refresh()
    },
    [enabled, sessionId, directory, source, taskFolder, fullAccess, refresh]
  )
  const resume = useCallback(
    async (jobId: string): Promise<EngineJobResumeResult> => {
      if (!enabled || !sessionId) throw new Error('no-session')
      const res =
        source === 'tasks'
          ? await cw('tasks:jobs:resume', { sessionID: sessionId, jobId, folder: taskFolder!, fullAccess })
          : await call('jobs:resume', { sessionID: sessionId, jobId, ...(directory ? { directory } : {}) })
      // Con éxito (o si ya no hay nada que reanudar) la lápida desaparece: se vuelve a consultar.
      await refresh()
      return res
    },
    [enabled, sessionId, directory, source, taskFolder, fullAccess, refresh]
  )
  return { jobs, stop, resume, refresh }
}
