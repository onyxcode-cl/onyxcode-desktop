// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'
import { makeSession, nextEventId, textPart, userMessage } from '../../../../../test/fixtures/events'
import type { OcEvent } from '../../../lib/opencode'
import { useLang } from '../../../lib/i18n'
import { useProviders } from '../../../stores/providers'
import { useSessions } from '../../../stores/sessions'
import { handleEvent, useTasks } from './store'
import { TaskConversation } from './TaskConversation'
import { TasksComposer } from './TasksComposer'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
const D = '/work/tasks'
const engine = 'http://tasks.test'
const old = { providerID: 'p', modelID: 'old' }
const next = { providerID: 'p', modelID: 'new' }
let mounted: Mounted | undefined
const entries = [{ info: userMessage('m1', 's1', { model: old }), parts: [textPart('p1', 'm1', 's1', 'hola')] }]
const change = (sessionID = 's1') =>
  act(() =>
    handleEvent(
      {
        id: nextEventId(),
        type: 'session.modelo.cambiado',
        properties: { sessionID, anterior: old, nuevo: next, motivo: 'La persona pidió seguir con Nuevo visible' }
      } as unknown as OcEvent,
      D
    )
  )
beforeEach(() => {
  useLang.setState({ lang: 'es' })
  useTasks.setState({
    folder: D,
    activeTaskId: 's1',
    taskModel: old,
    taskVariant: 'low',
    taskModels: {},
    modelChanges: {},
    conn: { folder: D, directory: D, pathMap: { kind: 'identity' }, baseUrl: engine } as never
  })
  useSessions.setState({ sessions: { s1: makeSession('s1', D), s2: makeSession('s2', D) }, sessionSource: { s1: engine, s2: engine } })
  useProviders.setState({
    loaded: true,
    providers: [
      {
        id: 'p',
        name: 'Proveedor',
        models: {
          old: { id: 'old', name: 'Anterior' },
          new: { id: 'new', name: 'Nuevo visible' }
        }
      }
    ] as never
  })
})
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})
describe('selector y línea de cambio en Overdrive', () => {
  it('actualiza el selector real y muestra la misma línea de Código como texto plano', () => {
    mounted = mount(
      <>
        <TasksComposer onSend={() => undefined} busy={false} />
        <TaskConversation entries={entries} busy={false} permissions={[]} taskId="s1" />
      </>
    )
    expect(mounted.host.textContent).toContain('Anterior')
    change()
    const note = mounted.host.querySelector('[data-testid="model-change-note"]')!
    expect(note.textContent).toBe('Cambié a Nuevo visible porque lo pediste.')
    expect(note.children).toHaveLength(0)
    expect(note.className).toContain('text-xs text-muted')
    expect(mounted.host.querySelector('button[title="p/new"]')?.textContent).toContain('Nuevo visible')
    expect(mounted.host.querySelector('button[title="p/old"]')).toBeNull()
  })
  it('muestra el aviso únicamente en el chat de la tarea correspondiente', () => {
    mounted = mount(<TaskConversation entries={entries} busy={false} permissions={[]} taskId="s1" />)
    change('s2')
    expect(mounted.host.querySelector('[data-testid="model-change-note"]')).toBeNull()
    mounted.rerender(<TaskConversation entries={[]} busy={false} permissions={[]} taskId="s2" />)
    expect(mounted.host.querySelector('[data-testid="model-change-note"]')?.textContent).toBe('Cambié a Nuevo visible porque lo pediste.')
  })
  it('no interpreta HTML, cambia de idioma y usa el id si falta el catálogo', () => {
    useProviders.setState({ providers: [{ id: 'p', models: { new: { name: '<b>Modelo</b>' } } }] as never })
    mounted = mount(<TaskConversation entries={entries} busy={false} permissions={[]} taskId="s1" />)
    change()
    const note = mounted.host.querySelector('[data-testid="model-change-note"]')!
    expect(note.textContent).toBe('Cambié a <b>Modelo</b> porque lo pediste.')
    expect(note.children).toHaveLength(0)
    act(() => useLang.setState({ lang: 'en' }))
    expect(note.textContent).toBe('I switched to <b>Modelo</b> because you asked.')
    act(() => useProviders.setState({ providers: [] }))
    expect(note.textContent).toBe('I switched to new because you asked.')
  })
})
