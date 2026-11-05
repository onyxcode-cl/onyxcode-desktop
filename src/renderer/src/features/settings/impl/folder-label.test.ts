import { describe, expect, it } from 'vitest'
import { folderLabel } from './TasksSection'

describe('folderLabel (carpetas de tarea con id crudo)', () => {
  it('una carpeta creada por la app se muestra con su fecha, no con el id', () => {
    expect(folderLabel('/Users/ana/Lazunox/20261029-59f52a')).toBe('Carpeta de tarea · 29/10/2026')
    expect(folderLabel('C:\\Users\\ana\\Lazunox\\20261029-59f52a')).toBe('Carpeta de tarea · 29/10/2026')
  })
  it('el resto de carpetas conserva su nombre', () => {
    expect(folderLabel('/Users/ana/Informes')).toBe('Informes')
    expect(folderLabel('/Users/ana/2026-informe')).toBe('2026-informe')
  })
})
