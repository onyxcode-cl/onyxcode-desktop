import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))

const { safeDocumentName } = await import('./artifact-window')

describe('safeDocumentName', () => {
  it('conserva letras, números, espacios, guiones y guiones bajos (acentos incluidos)', () => {
    expect(safeDocumentName('Informe de ventas Q3', 'x')).toBe('Informe de ventas Q3')
    expect(safeDocumentName('Cotización_2026-final', 'x')).toBe('Cotización_2026-final')
  })

  it('saca separadores de ruta y caracteres de control: nunca escapa a otra carpeta', () => {
    expect(safeDocumentName('../../etc/passwd', 'x')).toBe('etcpasswd')
    expect(safeDocumentName('a/b\\c', 'x')).toBe('abc')
    expect(safeDocumentName('nombre\u0000con\u0007control', 'x')).toBe('nombreconcontrol')
  })

  it('vacío o solo caracteres prohibidos: usa el valor de reserva', () => {
    expect(safeDocumentName('', 'documento')).toBe('documento')
    expect(safeDocumentName('***///', 'documento')).toBe('documento')
    expect(safeDocumentName('   ', 'documento')).toBe('documento')
  })
})
