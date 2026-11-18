import { describe, expect, it } from 'vitest'
import { describeApplyFailure, reportWarnings } from './motivos'

describe('describeApplyFailure', () => {
  it('lee el motivo del informe del script y lo dice en español simple', () => {
    const f = describeApplyFailure(
      { error: { nivel: 'grave', motivos: ['falta la parte word/media/image1.png', 'cambió la parte word/styles.xml (no es de texto)'] } },
      '',
      1
    )
    expect(f.level).toBe('grave')
    expect(f.detail).toContain('Se perdió una parte del documento (word/media/image1.png).')
    expect(f.detail).toContain('estilos, imágenes o configuración (word/styles.xml)')
  })
  it('sin informe, usa las líneas DIFERENCIA / ERROR que imprimió el script', () => {
    expect(
      describeApplyFailure(null, 'OK: 3\nDIFERENCIA: Ventas: la celda B2 cambió (estilo/tipo/fórmula)\nESTRUCTURA: CAMBIÓ', 1)
    ).toEqual({
      level: 'grave',
      detail: 'Cambió una celda del Excel (B2): su estilo, su tipo o su fórmula.'
    })
    expect(
      describeApplyFailure(null, 'ERROR: el documento está protegido con contraseña: ábrelo y guárdalo sin protección.', 1).detail
    ).toBe('El documento está protegido con contraseña: ábrelo y guárdalo sin protección.')
  })
  it('código 4 (escrito pero sin poder revisarlo) es un aviso, no algo grave', () => {
    expect(describeApplyFailure(null, '', 4).level).toBe('aviso')
    expect(
      describeApplyFailure({ error: { nivel: 'aviso', motivos: ['no se pudo revisar la estructura del resultado (x)'] } }, '', 4).level
    ).toBe('aviso')
  })
  it('sin ninguna pista, igual da un motivo y es grave', () => {
    expect(describeApplyFailure(null, '', 1)).toMatchObject({ level: 'grave' })
  })
  it('muestra hasta 3 motivos y cuenta el resto', () => {
    const motivos = ['falta la parte a', 'falta la parte b', 'falta la parte c', 'falta la parte d', 'falta la parte e']
    expect(describeApplyFailure({ error: { nivel: 'grave', motivos } }, '', 1).detail).toMatch(/Y 2 motivos más\.$/)
  })
})

describe('reportWarnings', () => {
  it('toma los avisos del informe y descarta lo que no es texto', () => {
    expect(reportWarnings({ avisos: ['se descartaron 1 partes que el documento no usaba ([trash]/0000.dat)', 3] })).toHaveLength(1)
    expect(reportWarnings(null)).toEqual([])
  })
})
