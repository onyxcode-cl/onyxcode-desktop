import { describe, expect, it } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { FINISHED_GRACE_MS, formatElapsed, MAX_VISIBLE_JOBS, selectBackgroundJobs, type BackgroundJobsInput } from './background-jobs'

const NOW = 1_760_000_000_000
const ROOT = 'ses_root'

const sess = (id: string, parentID: string | undefined, created = NOW - 60_000, updated = NOW - 1000, title = id): never =>
  ({ id, parentID, title, time: { created, updated } }) as never

const taskPart = (child: string, over: { background?: boolean; status?: string; description?: string; agent?: string } = {}): Part =>
  ({
    id: `prt_${child}`,
    sessionID: ROOT,
    messageID: 'msg_1',
    type: 'tool',
    callID: `call_${child}`,
    tool: 'task',
    state: {
      status: over.status ?? 'completed',
      input: { description: over.description ?? `Trabajo ${child}`, subagent_type: over.agent ?? 'explore' },
      metadata: { sessionId: child, ...(over.background === false ? {} : { background: true }) },
      time: { start: NOW - 60_000, end: NOW - 59_000 }
    }
  }) as never

function input(over: Partial<BackgroundJobsInput> & { parts?: Part[] } = {}): BackgroundJobsInput {
  const { parts = [], ...rest } = over
  return {
    rootId: ROOT,
    sessions: { [ROOT]: sess(ROOT, undefined) },
    status: {},
    messages: { [ROOT]: [{ parts }] },
    now: NOW,
    ...rest
  }
}

describe('selectBackgroundJobs', () => {
  it('lista la hija viva de un subagente de fondo, con título, agente y tiempo', () => {
    const v = selectBackgroundJobs(
      input({
        parts: [taskPart('c1', { description: 'Revisar pruebas', agent: 'general' })],
        sessions: { [ROOT]: sess(ROOT, undefined), c1: sess('c1', ROOT, NOW - 65_000) },
        status: { c1: 'busy' }
      })
    )
    expect(v.liveCount).toBe(1)
    expect(v.jobs).toEqual([
      expect.objectContaining({ id: 'c1', title: 'Revisar pruebas', agent: 'general', state: 'running', elapsedMs: 65_000, endedAt: null })
    ])
    expect(v.overLimit).toBe(false)
  })

  it('excluye la consulta lateral: es sesión hija pero no tiene parte `task`', () => {
    const v = selectBackgroundJobs(
      input({
        parts: [],
        sessions: { [ROOT]: sess(ROOT, undefined), side: sess('side', ROOT) },
        status: { side: 'busy' }
      })
    )
    expect(v.jobs).toEqual([])
  })

  it('excluye subagentes en primer plano, hijas de otra raíz y sesiones sin cargar', () => {
    const v = selectBackgroundJobs(
      input({
        parts: [taskPart('fg', { background: false }), taskPart('otra'), taskPart('ausente')],
        sessions: { [ROOT]: sess(ROOT, undefined), fg: sess('fg', ROOT), otra: sess('otra', 'ses_otro') },
        status: { fg: 'busy', otra: 'busy' }
      })
    )
    expect(v.jobs).toEqual([])
  })

  it('sin raíz no hay nada', () => {
    expect(selectBackgroundJobs(input({ rootId: null })).jobs).toEqual([])
  })

  it('estados: esperando permiso, terminó y falló', () => {
    const v = selectBackgroundJobs(
      input({
        parts: [taskPart('w'), taskPart('d'), taskPart('f')],
        sessions: {
          [ROOT]: sess(ROOT, undefined),
          w: sess('w', ROOT, NOW - 30_000),
          d: sess('d', ROOT, NOW - 30_000, NOW - 2000),
          f: sess('f', ROOT, NOW - 30_000, NOW - 3000)
        },
        status: { w: 'busy', d: 'idle', f: 'idle' },
        errors: { f: { name: 'UnknownError' } },
        pendingSessionIds: ['w']
      })
    )
    const by = Object.fromEntries(v.jobs.map((j) => [j.id, j]))
    expect(by.w.state).toBe('waiting')
    expect(by.d.state).toBe('done')
    expect(by.f.state).toBe('failed')
    expect(by.d.endedAt).toBe(NOW - 2000)
    expect(by.d.elapsedMs).toBe(28_000)
    expect(v.liveCount).toBe(1)
  })

  it('un trabajo terminado desaparece pasado el plazo de gracia', () => {
    const old = sess('d', ROOT, NOW - 120_000, NOW - FINISHED_GRACE_MS - 1)
    const v = selectBackgroundJobs(
      input({ parts: [taskPart('d')], sessions: { [ROOT]: sess(ROOT, undefined), d: old }, status: { d: 'idle' } })
    )
    expect(v.jobs).toEqual([])
  })

  it('una hija recién creada y aún sin actividad cuenta como corriendo', () => {
    const v = selectBackgroundJobs(
      input({ parts: [taskPart('n')], sessions: { [ROOT]: sess(ROOT, undefined), n: sess('n', ROOT, NOW - 500, NOW - 500) } })
    )
    expect(v.jobs[0]?.state).toBe('running')
  })

  it(`tope de ${MAX_VISIBLE_JOBS} simultáneos: muestra los más antiguos y avisa del resto`, () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const sessions: Record<string, never> = { [ROOT]: sess(ROOT, undefined) }
    ids.forEach((id, i) => (sessions[id] = sess(id, ROOT, NOW - 100_000 + i * 1000)))
    const v = selectBackgroundJobs(
      input({ parts: ids.map((id) => taskPart(id)), sessions, status: Object.fromEntries(ids.map((id) => [id, 'busy' as const])) })
    )
    expect(v.liveCount).toBe(6)
    expect(v.jobs.map((j) => j.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(v.hidden).toBe(2)
    expect(v.overLimit).toBe(true)
  })

  it('con exactamente el tope no hay aviso', () => {
    const ids = ['a', 'b', 'c', 'd']
    const sessions: Record<string, never> = { [ROOT]: sess(ROOT, undefined) }
    ids.forEach((id) => (sessions[id] = sess(id, ROOT)))
    const v = selectBackgroundJobs(
      input({ parts: ids.map((id) => taskPart(id)), sessions, status: Object.fromEntries(ids.map((id) => [id, 'busy' as const])) })
    )
    expect(v.overLimit).toBe(false)
    expect(v.hidden).toBe(0)
  })
})

describe('formatElapsed', () => {
  it('segundos, minutos y horas', () => {
    expect(formatElapsed(42_000)).toBe('42 s')
    expect(formatElapsed(65_000)).toBe('1 min 05 s')
    expect(formatElapsed(3_900_000)).toBe('1 h 05 min')
    expect(formatElapsed(-5)).toBe('0 s')
  })
})
