// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEngineJobs } from './useEngineJobs'

const mocks = vi.hoisted(() => ({ call: vi.fn(), cw: vi.fn() }))
vi.mock('../../../lib/api', () => ({ call: mocks.call }))
vi.mock('../../tasks/impl/bridge', () => ({ cw: mocks.cw }))
vi.mock('../../../lib/platform', () => ({ isRemoteSurface: () => false }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let data: ReturnType<typeof useEngineJobs>
function Probe(props: Parameters<typeof useEngineJobs>[0]): null {
  data = useEngineJobs(props)
  return null
}
const props = { sessionId: 'ses_1', active: false, directory: '/win/c/workspace', source: 'tasks' as const, taskFolder: 'C:\\workspace' }
beforeEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.call.mockResolvedValue({ available: false })
  mocks.cw.mockImplementation(async (ch: string) => (ch.endsWith(':list') ? { available: true, jobs: [] } : { ok: true }))
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('useEngineJobs por motor', () => {
  it('lista, para y reanuda en el puente de tareas con carpeta host, sin enviar URL o ruta SDK', async () => {
    await act(async () => root.render(createElement(Probe, props)))
    expect(mocks.cw).toHaveBeenCalledWith('tasks:jobs:list', { sessionID: 'ses_1', folder: 'C:\\workspace', fullAccess: false })
    await act(async () => data.stop('sh_1'))
    expect(mocks.cw).toHaveBeenCalledWith('tasks:jobs:stop', {
      sessionID: 'ses_1',
      jobId: 'sh_1',
      folder: 'C:\\workspace',
      fullAccess: false
    })
    await act(async () => data.resume('ses_h'))
    expect(mocks.cw).toHaveBeenCalledWith('tasks:jobs:resume', {
      sessionID: 'ses_1',
      jobId: 'ses_h',
      folder: 'C:\\workspace',
      fullAccess: false
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('sin carpeta host no consulta Tareas ni el motor principal', async () => {
    await act(async () => root.render(createElement(Probe, { ...props, taskFolder: undefined })))
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.cw).not.toHaveBeenCalled()
  })

  it('el motor principal conserva su contrato y no oculta una parada rechazada', async () => {
    mocks.call.mockImplementation(async (ch: string) => (ch === 'jobs:stop' ? { ok: false } : { available: true, jobs: [] }))
    await act(async () => root.render(createElement(Probe, { sessionId: 'ses_1', active: false, directory: '/workspace' })))
    expect(mocks.call).toHaveBeenCalledWith('jobs:list', { sessionID: 'ses_1', directory: '/workspace' })
    await expect(data.stop('sh_1')).rejects.toThrow('stop-failed')
    expect(mocks.cw).not.toHaveBeenCalled()
  })

  it('descarta respuestas pendientes al cambiar de motor o modo de acceso', async () => {
    let done: (v: unknown) => void = () => undefined
    mocks.cw.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve
        })
    )
    await act(async () => root.render(createElement(Probe, props)))
    await act(async () => root.render(createElement(Probe, { ...props, fullAccess: true })))
    await act(async () => done({ available: true, jobs: [{ id: 'old' }] }))
    expect(data.jobs).toEqual([])
    expect(mocks.cw).toHaveBeenLastCalledWith('tasks:jobs:list', { sessionID: 'ses_1', folder: 'C:\\workspace', fullAccess: true })
  })
})
