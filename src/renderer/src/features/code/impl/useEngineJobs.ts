import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineJob } from '@shared/engine-jobs'
import { call } from '../../../lib/api'
import { isRemoteSurface } from '../../../lib/platform'
import { ENGINE_JOBS_POLL_MS } from './engine-jobs'

/**
 * Trabajos del motor propio de una conversación, con sondeo suave: solo mientras haya uno en curso o `active` (la
 * conversación trabaja o hay ayudantes vivos). Se consulta una vez al abrir la conversación y otra al cambiar `active`
 * (atrapa un comando lanzado justo antes de quedar ociosa). Si el motor no tiene la ruta (`available: false`) no se vuelve a
 * preguntar en esa conversación; un fallo de red conserva lo último y no se muestra. El celular no consulta (canal solo del Mac).
 */
export function useEngineJobs(opts: { sessionId: string | null | undefined; directory?: string; active: boolean }): {
  jobs: EngineJob[]
  stop: (jobId: string) => Promise<void>
  refresh: () => Promise<void>
} {
  const { sessionId, directory, active } = opts
  const [jobs, setJobs] = useState<EngineJob[]>([])
  const [available, setAvailable] = useState(true)
  const gen = useRef(0)
  const enabled = !!sessionId && !isRemoteSurface()

  useEffect(() => {
    gen.current++
    setJobs([])
    setAvailable(true)
  }, [sessionId, directory])

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || !sessionId) return
    const mine = gen.current
    try {
      const res = await call('jobs:list', { sessionID: sessionId, ...(directory ? { directory } : {}) })
      if (mine !== gen.current) return
      if (!res.available) {
        setAvailable(false)
        setJobs([])
      } else setJobs(res.jobs)
    } catch {
      /* sin error visible: se conserva lo último y el próximo sondeo reintenta */
    }
  }, [enabled, sessionId, directory])

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
      if (!sessionId) throw new Error('no-session')
      await call('jobs:stop', { sessionID: sessionId, jobId, ...(directory ? { directory } : {}) })
      await refresh()
    },
    [sessionId, directory, refresh]
  )
  return { jobs, stop, refresh }
}
