import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TasksConnection } from '@shared/ipc-tasks'
const m = vi.hoisted(() => ({ cw: vi.fn(), connect: vi.fn() }))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
vi.mock('./bridge', () => ({ cw: m.cw, hasTasksBridge: () => false, onTasks: () => () => {} }))
vi.mock('./store', async (original) => ({ ...(await original<typeof import('./store')>()), connectFolder: m.connect }))
import { useTasks } from './store'
import { setDeleteGrantAllowed } from './actions'
beforeEach(() => {
  vi.resetAllMocks()
  useTasks.setState({ folder: '/fixture', conn: { fullAccess: false } as TasksConnection, deleteGrant: false, deleteGrantBusy: false })
})
describe('acción real del permiso de carpeta', () => {
  it('usa el IPC existente y reconecta el servidor aislado tras guardar', async () => {
    m.cw.mockResolvedValue(true)
    await setDeleteGrantAllowed(true)
    expect(m.cw).toHaveBeenCalledWith('tasks:deleteGrant:set', { folder: '/fixture', allowed: true })
    expect(m.connect).toHaveBeenCalledWith('/fixture', false)
    expect(useTasks.getState()).toMatchObject({ deleteGrant: true, deleteGrantBusy: false })
  })
  it('si se cambia de carpeta mientras responde main, no pisa su permiso ni reconecta la anterior', async () => {
    m.cw.mockImplementation(async () => {
      useTasks.setState({ folder: '/otra', deleteGrant: false })
      return true
    })
    await expect(setDeleteGrantAllowed(true)).rejects.toThrow('cambió')
    expect(m.connect).not.toHaveBeenCalled()
    expect(useTasks.getState()).toMatchObject({ folder: '/otra', deleteGrant: false, deleteGrantBusy: false })
  })
  it('si falla el IPC, no concede y libera el indicador ocupado', async () => {
    m.cw.mockRejectedValue(new Error('fallo simulado'))
    await expect(setDeleteGrantAllowed(true)).rejects.toThrow('fallo simulado')
    expect(m.connect).not.toHaveBeenCalled()
    expect(useTasks.getState()).toMatchObject({ deleteGrant: false, deleteGrantBusy: false })
  })
})
