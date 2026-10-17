import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ cw: vi.fn(), hasTasksBridge: vi.fn(() => true) }))
vi.mock('../../tasks/impl/bridge', () => bridge)

import { acceptCodeLearnedMemory, loadCodeLearnedMemory, useCodeLearnedMemory } from './learned-memory-store'

beforeEach(() => {
  vi.clearAllMocks()
  bridge.hasTasksBridge.mockReturnValue(true)
  useCodeLearnedMemory.setState({ learnedUser: null, learnedProject: null })
})

describe('loadCodeLearnedMemory', () => {
  it('sin puente de Tareas: no llama a nada y deja learnedUser en null', async () => {
    bridge.hasTasksBridge.mockReturnValue(false)
    await loadCodeLearnedMemory()
    expect(bridge.cw).not.toHaveBeenCalled()
    expect(useCodeLearnedMemory.getState().learnedUser).toBeNull()
  })

  it('con memoria global guardada: la deja en formato de prompt', async () => {
    bridge.cw.mockResolvedValue({
      usuario: [{ id: '1', tipo: 'preferencia', texto: 'prefiere tablas', fecha: '2026-10-07' }],
      proyecto: []
    })
    await loadCodeLearnedMemory()
    expect(bridge.cw).toHaveBeenCalledWith('tasks:mem:get', {})
    expect(useCodeLearnedMemory.getState().learnedUser).toContain('prefiere tablas')
  })

  it('sin memoria guardada: learnedUser queda null (no un string vacío)', async () => {
    bridge.cw.mockResolvedValue({ usuario: [], proyecto: [] })
    await loadCodeLearnedMemory()
    expect(useCodeLearnedMemory.getState().learnedUser).toBeNull()
  })

  it('si el IPC falla: learnedUser queda null, sin lanzar', async () => {
    bridge.cw.mockRejectedValue(new Error('no'))
    await expect(loadCodeLearnedMemory()).resolves.toBeUndefined()
    expect(useCodeLearnedMemory.getState().learnedUser).toBeNull()
  })
})

describe('acceptCodeLearnedMemory', () => {
  it('sin carpeta: filtra las propuestas de alcance "proyecto" antes de mandar nada', async () => {
    bridge.cw.mockResolvedValue({ usuario: [], proyecto: [] })
    await acceptCodeLearnedMemory([{ alcance: 'proyecto', tipo: 'convencion', texto: 'x' }])
    expect(bridge.cw).not.toHaveBeenCalled()
  })

  it('con al menos una de alcance "usuario": llama a tasks:learn:accept solo con esas, y relee', async () => {
    bridge.cw.mockResolvedValue({ usuario: [], proyecto: [] })
    await acceptCodeLearnedMemory([
      { alcance: 'usuario', tipo: 'preferencia', texto: 'global' },
      { alcance: 'proyecto', tipo: 'convencion', texto: 'de proyecto' }
    ])
    expect(bridge.cw).toHaveBeenCalledWith('tasks:mem:accept', {
      proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: 'global' }]
    })
    expect(bridge.cw).toHaveBeenCalledWith('tasks:mem:get', {})
  })

  it('con carpeta: manda también las de "proyecto" y relee con esa carpeta', async () => {
    bridge.cw.mockResolvedValue({ usuario: [], proyecto: [{ id: '2', tipo: 'convencion', texto: 'usa pnpm', fecha: '2026-10-07' }] })
    await acceptCodeLearnedMemory([{ alcance: 'proyecto', tipo: 'convencion', texto: 'usa pnpm' }], '/work/a')
    expect(bridge.cw).toHaveBeenCalledWith('tasks:mem:accept', {
      folder: '/work/a',
      proposals: [{ alcance: 'proyecto', tipo: 'convencion', texto: 'usa pnpm' }]
    })
    expect(bridge.cw).toHaveBeenCalledWith('tasks:mem:get', { folder: '/work/a' })
    expect(useCodeLearnedMemory.getState().learnedProject).toContain('usa pnpm')
  })
})
