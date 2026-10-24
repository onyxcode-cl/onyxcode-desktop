import { describe, expect, it } from 'vitest'
import type { EngineJob } from '@shared/engine-jobs'
import { ENGINE_FINISHED_GRACE_MS, MAX_FINISHED_ENGINE_JOBS, selectEngineJobs } from './engine-jobs'

const NOW = 10_000_000
const job = (over: Partial<EngineJob> = {}): EngineJob => ({
  id: 'sh_1',
  kind: 'shell',
  title: 'npm test',
  state: 'en_curso',
  code: null,
  startedAt: NOW - 65_000,
  endedAt: null,
  ...over
})

describe('selectEngineJobs', () => {
  it('en curso: tiempo desde el inicio y marcado como vivo', () => {
    const [r] = selectEngineJobs([job()], NOW)
    expect(r).toMatchObject({ live: true, elapsedMs: 65_000, endedAt: null })
  })

  it('terminados: tiempo fijo hasta el fin, y se ocultan pasada la gracia', () => {
    const fresh = job({ id: 'a', state: 'terminado', code: 0, endedAt: NOW - 1000, startedAt: NOW - 11_000 })
    const old = job({ id: 'b', state: 'perdido', endedAt: NOW - ENGINE_FINISHED_GRACE_MS - 1, startedAt: NOW - 999_999 })
    const rows = selectEngineJobs([fresh, old], NOW)
    expect(rows.map((r) => r.id)).toEqual(['a'])
    expect(rows[0]).toMatchObject({ live: false, elapsedMs: 10_000 })
  })

  it('vivos primero (los más antiguos antes) y luego los terminados; tope de terminados', () => {
    const live1 = job({ id: 'l1', startedAt: NOW - 5000 })
    const live2 = job({ id: 'l2', startedAt: NOW - 9000 })
    const done = Array.from({ length: MAX_FINISHED_ENGINE_JOBS + 3 }, (_, i) =>
      job({ id: `d${i}`, state: 'terminado', startedAt: NOW - 100_000 + i, endedAt: NOW - 50_000 + i })
    )
    const rows = selectEngineJobs([...done, live1, live2], NOW)
    expect(rows.slice(0, 2).map((r) => r.id)).toEqual(['l2', 'l1'])
    expect(rows).toHaveLength(2 + MAX_FINISHED_ENGINE_JOBS)
    // se quedan los terminados más recientes
    expect(rows.slice(2).map((r) => r.id)).toEqual(['d3', 'd4', 'd5', 'd6', 'd7'])
  })

  it('terminado sin fin informado no se queda colgado: usa el inicio', () => {
    const [r] = selectEngineJobs([job({ state: 'tope_de_vida', endedAt: null, startedAt: NOW - 1000 })], NOW)
    expect(r).toMatchObject({ live: false, elapsedMs: 0 })
  })
})
