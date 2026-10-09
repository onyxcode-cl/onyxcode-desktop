import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ cw: vi.fn(), hasTasksBridge: vi.fn(() => true) }))
vi.mock('../../tasks/impl/bridge', () => bridge)

import { acceptCodeLearnedMemory, loadCodeLearnedMemory, useCodeLearnedMemory } from './learned-memory-store'

beforeEach(() => {
  vi.clearAllMocks()
  bridge.hasTasksBridge.mockReturnValue(true)
  useCodeLearnedMemory.setState({ learnedUser: null })
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
    expect(bridge.cw).toHaveBeenCalledWith('tasks:learn:get', {})
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
  it('filtra las propuestas de alcance "proyecto" antes de mandar nada', async () => {
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
    expect(bridge.cw).toHaveBeenCalledWith('tasks:learn:accept', {
      proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: 'global' }]
    })
    expect(bridge.cw).toHaveBeenCalledWith('tasks:learn:get', {})
  })
})
