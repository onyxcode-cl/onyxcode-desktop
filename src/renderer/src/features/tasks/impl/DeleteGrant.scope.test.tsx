// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TasksConnection } from '@shared/ipc-tasks'
import { mount, type Mounted } from '../../../../../test/dom-render'

const m = vi.hoisted(() => ({ cw: vi.fn(), connect: vi.fn() }))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
vi.mock('./bridge', () => ({ cw: m.cw, hasTasksBridge: () => false, onTasks: () => () => {} }))
vi.mock('./store', async (original) => ({ ...(await original<typeof import('./store')>()), connectFolder: m.connect }))
import { useTasks } from './store'
import { DeleteGrantToggle } from './DeleteGrant'
import { SandboxDenialNotice } from './SandboxDenialNotice'

let mounted: Mounted | undefined
beforeEach(() => {
  vi.resetAllMocks()
  m.cw.mockResolvedValue(true)
  useTasks.setState({
    folder: '/fixture/a',
    conn: { folder: '/fixture/a', fullAccess: false } as TasksConnection,
    deleteGrant: false,
    deleteGrantBusy: false,
    sandboxDenials: { '/fixture/a': [{ kind: 'delete', at: 1, canAllowDelete: true }] },
    denialMonitorUnavailable: {}
  })
})
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})

describe.each(['proyecto', 'aviso de aislamiento'])('destino del permiso desde %s', (entry) => {
  const show = (): HTMLButtonElement => {
    mounted = mount(entry === 'proyecto' ? <DeleteGrantToggle /> : <SandboxDenialNotice />)
    return mounted.q<HTMLButtonElement>('button')!
  }
  it('solo el clic concede a la carpeta representada por el botón', async () => {
    const button = show()
    expect(m.cw).not.toHaveBeenCalled()
    await act(async () => button.click())
    expect(m.cw).toHaveBeenCalledExactlyOnceWith('tasks:deleteGrant:set', { folder: '/fixture/a', allowed: true })
    expect(m.connect).toHaveBeenCalledExactlyOnceWith('/fixture/a', false)
  })
  it.each(['carpeta', 'conexión'])('un botón anterior al cambio de %s no concede a ningún destino', async (change) => {
    const button = show()
    await act(async () => {
      // El store ya cambió y React aún no sustituyó el botón visible.
      useTasks.setState({
        folder: change === 'carpeta' ? '/fixture/b' : '/fixture/a',
        conn: { folder: change === 'carpeta' ? '/fixture/b' : '/fixture/a', fullAccess: false } as TasksConnection,
        deleteGrant: false
      })
      button.click()
    })
    expect(m.cw).not.toHaveBeenCalled()
    expect(m.connect).not.toHaveBeenCalled()
  })
})
