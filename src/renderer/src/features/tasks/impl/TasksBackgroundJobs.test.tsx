// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TasksBackgroundJobs, TasksBackgroundJobsProvider, useTasksBackgroundJobs } from './TasksBackgroundJobs'

const mocks = vi.hoisted(() => ({
  useData: vi.fn(),
  state: {
    activeTaskId: 'task',
    folder: '/approved/project',
    client: {},
    conn: { fullAccess: false },
    permissions: {},
    questions: {}
  },
  stop: vi.fn(),
  load: vi.fn()
}))
vi.mock('./store', () => ({ useTasks: (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state) }))
vi.mock('./conn-paths', () => ({ sdkDir: (folder: string) => folder }))
vi.mock('../../code/impl/BackgroundJobsConnectors', () => ({ useSessionsJobsData: mocks.useData }))
vi.mock('../../code/impl/BackgroundJobs', () => ({
  BackgroundJobs: ({
    layout,
    onStopEngineJob,
    onLoadConversation
  }: {
    layout: string
    onStopEngineJob: (id: string) => void
    onLoadConversation: (id: string) => void
  }) => (
    <section data-layout={layout}>
      <button onClick={() => onStopEngineJob('job')}>stop</button>
      <button onClick={() => onLoadConversation('helper')}>view</button>
    </section>
  )
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.unstubAllGlobals()
  mocks.useData.mockReset()
  mocks.stop.mockReset()
  mocks.load.mockReset()
  mocks.useData.mockReturnValue({
    view: { jobs: [], liveCount: 1 },
    abort: vi.fn(),
    engine: { rows: [], stop: mocks.stop, resume: vi.fn() },
    liveCount: 2,
    onLoadConversation: mocks.load,
    conversationVersion: () => 'v1'
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Harness() {
  const data = useTasksBackgroundJobs()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        data-testid="open"
        onClick={() => {
          data?.requestFocus()
          setOpen(true)
        }}
      >
        {data?.liveCount}
      </button>
      {open && <TasksBackgroundJobs />}
    </>
  )
}
describe('tarjeta de trabajos de Overdrive', () => {
  it('observa el motor de la tarea con el panel cerrado, conserva el contador y enfoca la tarjeta al abrir', () => {
    act(() => root.render(createElement(TasksBackgroundJobsProvider, null, createElement(Harness))))
    expect(host.querySelector('[data-testid="open"]')?.textContent).toBe('2')
    expect(host.querySelector('section')).toBeNull()
    expect(mocks.useData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rootId: 'task',
        taskFolder: '/approved/project',
        engineSource: 'tasks',
        fullAccess: false,
        includeForeground: true
      })
    )
    act(() => (host.querySelector('[data-testid="open"]') as HTMLButtonElement).click())
    expect(host.querySelector('section')?.getAttribute('data-layout')).toBe('card')
    expect(document.activeElement).toBe(host.querySelector('[data-testid="tasks-summary-jobs"]'))
    act(() => (host.querySelector('section button') as HTMLButtonElement).click())
    expect(mocks.stop).toHaveBeenCalledWith('job')
    act(() => (host.querySelectorAll('section button')[1] as HTMLButtonElement).click())
    expect(mocks.load).toHaveBeenCalledWith('helper')
  })
})
