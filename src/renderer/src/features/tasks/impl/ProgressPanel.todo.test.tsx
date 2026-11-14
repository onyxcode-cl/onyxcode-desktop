/** Un paso «en curso» no debe seguir girando cuando la tarea ya paró (visto en una tarea que terminó sin cerrar su último paso). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProgressPanel, TodoIcon } from './ProgressPanel'

describe('TodoIcon', () => {
  it('en curso con la tarea trabajando: gira', () => {
    expect(renderToStaticMarkup(<TodoIcon status="in_progress" live />)).toContain('animate-spin')
  })
  it('en curso con la tarea detenida: NO gira', () => {
    expect(renderToStaticMarkup(<TodoIcon status="in_progress" live={false} />)).not.toContain('animate-spin')
  })
  it('por defecto (sin `live`) sigue girando como siempre', () => {
    expect(renderToStaticMarkup(<TodoIcon status="in_progress" />)).toContain('animate-spin')
  })
  it('completado, cancelado y pendiente no giran nunca', () => {
    for (const status of ['completed', 'cancelled', 'pending']) {
      expect(renderToStaticMarkup(<TodoIcon status={status} live />)).not.toContain('animate-spin')
    }
  })
})

vi.mock('./store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store')>()
  return {
    ...actual,
    useTasks: Object.assign(
      (selector: (s: ReturnType<typeof actual.useTasks.getState>) => unknown) => selector(actual.useTasks.getState()),
      actual.useTasks
    )
  }
})

vi.mock('./TasksProjectCard', () => ({ TasksProjectCard: () => null }))
vi.mock('./ChangesPanel', () => ({ ChangesSection: () => null }))
vi.mock('../../../components/ContextDetail', () => ({ ContextDetail: () => null }))
vi.mock('../../../components/UsageMeter', () => ({ UsageMeter: () => null }))

import { useTasks } from './store'
import { useSessions } from '../../../stores/sessions'

beforeEach(() => {
  useTasks.setState({
    todos: {
      task: [
        { content: 'Paso hecho', status: 'completed', priority: 'medium' },
        { content: 'Paso abierto', status: 'in_progress', priority: 'medium' },
        { content: 'Paso pendiente', status: 'pending', priority: 'medium' }
      ]
    }
  })
  useSessions.setState({ messages: {}, status: { task: 'idle' } })
})

describe('Plan del panel de Tareas', () => {
  it('explica los pasos sin confirmar cuando la tarea ya paró', () => {
    const html = renderToStaticMarkup(<ProgressPanel sessionID="task" busy={false} />)
    expect(html).toContain('El modelo no marcó estos pasos')
    expect(html.match(/sin confirmar/g)).toHaveLength(2)
    expect(html).not.toContain('animate-spin')
  })
  it('completo no muestra advertencia', () => {
    useTasks.setState({ todos: { task: [{ content: 'Listo', status: 'completed', priority: 'medium' }] } })
    const html = renderToStaticMarkup(<ProgressPanel sessionID="task" busy={false} />)
    expect(html).not.toContain('sin confirmar')
    expect(html).not.toContain('El modelo no marcó')
  })
})
