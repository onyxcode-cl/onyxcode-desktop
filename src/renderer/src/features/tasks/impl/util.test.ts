import { describe, expect, it } from 'vitest'
import { friendlyTool, toolLabel } from './util'
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

it('V31: oculta el identificador de salida interna y el título redundante del cambio de modelo', () => {
  const part = (tool: string, input: Record<string, unknown>, title = ''): never =>
    ({ type: 'tool', tool, state: { status: 'completed', input, title } }) as never
  expect(friendlyTool(part('read', { filePath: '/tmp/tool_1e649dc9a001rK6k' }))).toEqual({ verb: 'Leyó', detail: '' })
  expect(friendlyTool(part('read', { filePath: '/proyecto/informe.md' })).detail).toBe('informe.md')
  expect(friendlyTool(part('cambiar_modelo', { modelo: 'Haiku' }, 'Cambié a Claude Haiku 5.5')).detail).toBe('')
})
