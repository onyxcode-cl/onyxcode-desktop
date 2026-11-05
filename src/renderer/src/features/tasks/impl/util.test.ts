import { describe, expect, it } from 'vitest'
import { toolLabel } from './util'
describe('toolLabel (U3)', () => {
  it('las herramientas de documentos tienen nombre legible según el estado', () => {
    expect(toolLabel('documentos_crear', 'completed')).toBe('Creó el documento')
    expect(toolLabel('documentos_crear', 'running')).toBe('Creando el documento')
    expect(toolLabel('documentos_crear', 'error')).toBe('No se pudo crear el documento')
    expect(toolLabel('documentos_renderizar')).toBe('Miró el documento')
  })
  it('una herramienta desconocida solo pierde los guiones bajos', () => {
    expect(toolLabel('otra_herramienta_rara')).toBe('Usó la herramienta «otra herramienta rara»')
  })
})
