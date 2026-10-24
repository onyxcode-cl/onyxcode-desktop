import { describe, expect, it } from 'vitest'
import { ENGINE_JOBS_MAX, parseEngineJobs } from './engine-jobs'

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sh_1',
  tipo: 'shell',
  titulo: 'npm run build',
  estado: 'en_curso',
  codigo: null,
  inicio: 1000,
  fin: null,
  ...over
})

describe('parseEngineJobs', () => {
  it('traduce el contrato del motor a la forma de la app', () => {
    expect(parseEngineJobs({ trabajos: [row(), row({ id: 'cm_2', tipo: 'celda', estado: 'terminado', codigo: 0, fin: 5000 })] })).toEqual([
      { id: 'sh_1', kind: 'shell', title: 'npm run build', state: 'en_curso', code: null, startedAt: 1000, endedAt: null },
      { id: 'cm_2', kind: 'celda', title: 'npm run build', state: 'terminado', code: 0, startedAt: 1000, endedAt: 5000 }
    ])
  })

  it('acepta los cinco estados y descarta tipos, estados o campos inválidos sin fallar entero', () => {
    const estados = ['en_curso', 'terminado', 'terminado_por_ti', 'tope_de_vida', 'perdido']
    expect(parseEngineJobs({ trabajos: estados.map((estado, i) => row({ id: `sh_${i}`, estado })) })).toHaveLength(5)
    const bad = [
      row({ estado: 'raro' }),
      row({ tipo: 'otro' }),
      row({ id: '' }),
      row({ id: 3 }),
      row({ inicio: 'x' }),
      null,
      'x',
      row({ id: 'ok' })
    ]
    expect(parseEngineJobs({ trabajos: bad }).map((j) => j.id)).toEqual(['ok'])
  })

  it('cuerpos que no son el contrato dan lista vacía', () => {
    for (const body of [null, undefined, [], 'x', {}, { trabajos: 'x' }]) expect(parseEngineJobs(body)).toEqual([])
  })

  it('topa el número de filas y el largo del título', () => {
    const many = Array.from({ length: ENGINE_JOBS_MAX + 10 }, (_, i) => row({ id: `sh_${i}` }))
    expect(parseEngineJobs({ trabajos: many })).toHaveLength(ENGINE_JOBS_MAX)
    expect(parseEngineJobs({ trabajos: [row({ titulo: 'a'.repeat(5000) })] })[0]!.title.length).toBe(300)
  })
})
