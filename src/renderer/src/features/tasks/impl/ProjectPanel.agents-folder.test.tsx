// @vitest-environment jsdom
/** Panel de proyecto, pestaña AGENTS.md: al cambiar de carpeta no queda a la vista (ni se guarda) lo de la carpeta anterior. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.hoisted(() => vi.unstubAllGlobals())
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const calls = vi.hoisted(() => ({ log: [] as Array<{ ch: string; req: Record<string, unknown> }>, failFor: '' }))
vi.mock('./bridge', () => ({
  hasTasksBridge: () => true,
  onTasks: () => () => undefined,
  cw: vi.fn(async (ch: string, req: Record<string, unknown>) => {
    calls.log.push({ ch, req })
    const folder = String(req?.folder ?? '')
    if (ch === 'tasks:agentsMd:get') {
      if (folder === calls.failFor) throw new Error('AGENTS.md es un enlace simbólico')
      return { path: `${folder}/AGENTS.md`, content: `texto de ${folder}`, exists: true }
    }
    if (ch === 'tasks:agentsMd:save') return { path: `${folder}/AGENTS.md`, content: String(req.content), exists: true }
    if (ch === 'tasks:rules:list' || ch === 'tasks:skill:approved') return []
    return undefined
  })
}))

import { ProjectPanel } from './ProjectPanel'
import { useTasks } from './store'

let root: Root
let host: HTMLElement
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const agentsTab = (): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('AGENTS.md')) as HTMLButtonElement
const saveBtn = (): HTMLButtonElement => [...host.querySelectorAll('footer button')].pop() as HTMLButtonElement

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls.log = []
  calls.failFor = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('ProjectPanel: AGENTS.md y cambio de carpeta', () => {
  it('si la carga de la carpeta nueva falla, no quedan la ruta ni el texto de la anterior y no se puede guardar', async () => {
    useTasks.setState({ projectPanelOpen: true, folder: '/carp/t1', project: null, memory: null })
    await act(async () => root.render(<ProjectPanel />))
    await flush()
    await act(async () => agentsTab().click())
    await flush()
    expect(host.textContent).toContain('/carp/t1/AGENTS.md')

    calls.failFor = '/carp/t4link'
    await act(async () => useTasks.setState({ folder: '/carp/t4link' }))
    await flush()
    await act(async () => agentsTab().click())
    await flush()

    expect(host.textContent).not.toContain('/carp/t1')
    expect((host.querySelector('#proj-agents') as HTMLTextAreaElement).value).toBe('')
    expect(saveBtn().disabled).toBe(true)
    expect(calls.log.some((c) => c.ch === 'tasks:agentsMd:save')).toBe(false)
  })

  it('guardar usa la carpeta mostrada', async () => {
    useTasks.setState({ projectPanelOpen: true, folder: '/carp/t1', project: null, memory: null })
    await act(async () => root.render(<ProjectPanel />))
    await flush()
    await act(async () => agentsTab().click())
    await flush()
    await act(async () => saveBtn().click())
    await flush()
    const save = calls.log.filter((c) => c.ch === 'tasks:agentsMd:save')
    expect(save).toHaveLength(1)
    expect(save[0].req.folder).toBe('/carp/t1')
  })
})
