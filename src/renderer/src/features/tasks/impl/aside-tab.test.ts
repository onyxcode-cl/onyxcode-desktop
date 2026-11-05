import { describe, expect, it } from 'vitest'
import { effectiveAsideTab, viewerForTask } from './aside-tab'

describe('effectiveAsideTab (el panel derecho nunca queda en blanco)', () => {
  it('«visor» sin documento abierto vuelve a Progreso', () => {
    expect(effectiveAsideTab('viewer', { viewer: false, browser: true })).toBe('progress')
  })
  it('«navegador» sin carpeta vuelve a Progreso', () => {
    expect(effectiveAsideTab('browser', { viewer: false, browser: false })).toBe('progress')
  })
  it('respeta la pestaña elegida cuando tiene contenido', () => {
    expect(effectiveAsideTab('viewer', { viewer: true, browser: false })).toBe('viewer')
    expect(effectiveAsideTab('browser', { viewer: false, browser: true })).toBe('browser')
    expect(effectiveAsideTab('progress', { viewer: false, browser: false })).toBe('progress')
  })
})

describe('viewerForTask (el visor no se queda pegado entre tareas)', () => {
  const req = { path: '/a.pdf', nonce: 1, taskId: 't1' }
  it('muestra el documento solo en la tarea que lo pidió', () => {
    expect(viewerForTask(req, 't1')).toBe(req)
    expect(viewerForTask(req, 't2')).toBeNull()
    expect(viewerForTask(req, null)).toBeNull()
  })
  it('una petición sin dueño (antigua) vale; sin petición, nada', () => {
    const old: { path: string; nonce: number; taskId?: string } = { path: '/a.pdf', nonce: 1 }
    expect(viewerForTask(old, 't2')).toBe(old)
    expect(viewerForTask(null, 't1')).toBeNull()
  })
})
