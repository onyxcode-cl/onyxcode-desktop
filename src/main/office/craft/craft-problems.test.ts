import { describe, expect, it } from 'vitest'
import type { ProblemInput } from '../../diagnostics/problem-log'
import { OfficeError } from '../download'
import { recordCraftProblem } from './craft-problems'

const run = (err: unknown, extra?: Record<string, string | number>): ProblemInput[] => {
  const got: ProblemInput[] = []
  recordCraftProblem('instalación', err, extra, { record: (p) => got.push(p), platform: 'darwin', arch: 'arm64' })
  return got
}

describe('recordCraftProblem', () => {
  it('anota código, mensaje, plataforma, arquitectura y bytes recibidos', () => {
    const [p] = run(new OfficeError('size', 'Descarga incompleta (10 de 20 bytes)', 10))
    expect(p.source).toBe('craft')
    expect(p.message).toContain('Descarga incompleta')
    expect(p.detail).toMatchObject({ etapa: 'instalación', codigo: 'size', plataforma: 'darwin', arquitectura: 'arm64', bytes: 10 })
  })

  it('un error cualquiera queda como código «desconocido» y sin bytes', () => {
    const [p] = run(new Error('boom'), { programa: 'wordcraft' })
    expect(p.detail).toMatchObject({ codigo: 'desconocido', programa: 'wordcraft' })
    expect(p.detail?.bytes).toBeUndefined()
  })

  it('cancelar a propósito no se registra', () => {
    expect(run(new OfficeError('cancelled', 'Descarga cancelada'))).toEqual([])
  })

  it('si el registro falla, no lanza', () => {
    expect(() =>
      recordCraftProblem(
        'documento',
        new Error('x'),
        {},
        {
          record: () => {
            throw new Error('disco')
          }
        }
      )
    ).not.toThrow()
  })
})
