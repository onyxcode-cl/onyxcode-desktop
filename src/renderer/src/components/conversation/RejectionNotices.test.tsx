// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useLang } from '../../lib/i18n'

vi.hoisted(() => vi.unstubAllGlobals())
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { setLang } from '@shared/i18n'
import type { TasksConnection } from '@shared/ipc-tasks'
import { RejectionNotices } from './RejectionNotices'
import { useRejectionNotices } from '../../stores/rejection-notices'
import { useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'
import { useCode } from '../../features/code/impl/store'
import { useTasks } from '../../features/tasks/impl/store'
import { replyPermission, rejectQuestion } from '../../features/tasks/impl/actions'
import { makeSession } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const directory = '/fixture'
const permission = {
  id: 'p1',
  sessionID: 'kid',
  permission: 'bash',
  patterns: ['npm run build'],
  always: [],
  metadata: {},
  api: 'v1' as const
}
const question = { id: 'q1', sessionID: 'kid', questions: [{ header: 'Destino', question: '¿Dónde guardarlo?', options: [] }] }
const reply = vi.fn()
const reject = vi.fn()
const promptAsync = vi.fn()
const client = { permission: { reply }, question: { reject }, session: { promptAsync } }
const html = (mode: 'code' | 'tasks', sessionID = 'root', folder = directory): string => {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<RejectionNotices mode={mode} directory={folder} sessionID={sessionID} />))
  const rendered = host.innerHTML
  act(() => root.unmount())
  return rendered
}

beforeEach(() => {
  vi.clearAllMocks()
  setLang('es')
  useLang.setState({ lang: 'es' })
  reply.mockResolvedValue({ data: true })
  reject.mockResolvedValue({ data: true })
  useRejectionNotices.setState({ notices: [] })
  const sessions = { root: makeSession('root', directory), kid: makeSession('kid', directory, { parentID: 'root' }) }
  useCode.setState({
    directory,
    sessions,
    sessionProject: { root: directory, kid: directory },
    activeSessionID: 'root',
    permissions: { p1: permission },
    questions: { q1: question },
    globalError: null
  })
  useServer.setState({ client: client as never })
  useSessions.setState({ sessions })
  useTasks.setState({
    folder: directory,
    client: client as never,
    conn: null,
    activeTaskId: 'root',
    permissions: { p1: permission },
    questions: { q1: question }
  })
})

describe.each(['code', 'tasks'] as const)('cierre de tarjeta en %s', (mode) => {
  const rejectPermission = (): Promise<void> =>
    mode === 'code' ? useCode.getState().replyPermission(permission, 'reject') : replyPermission('p1', 'reject')
  const rejectTheQuestion = (): Promise<void> => (mode === 'code' ? useCode.getState().rejectQuestion(question) : rejectQuestion('q1'))

  it('retira la tarjeta y explica el rechazo del ayudante en la raíz sin otra llamada al modelo', async () => {
    await rejectPermission()
    expect((mode === 'code' ? useCode : useTasks).getState().permissions.p1).toBeUndefined()
    expect(html(mode)).toContain('No hice esta acción porque la rechazaste. Quedó pendiente:')
    expect(html(mode)).toContain('npm run build')
    expect(html(mode)).toContain('Puedes darme otra instrucción.')
    expect(html(mode, 'other')).toBe('')
    expect(html(mode, 'root', '/otra')).toBe('')
    expect(html(mode === 'code' ? 'tasks' : 'code')).toBe('')
    expect(promptAsync).not.toHaveBeenCalled()
    expect(reply).toHaveBeenCalledTimes(1)
    useRejectionNotices.getState().dismiss(useRejectionNotices.getState().notices[0])
    expect(html(mode)).toBe('')
  })

  it('la pregunta rechazada también tiene cierre visible', async () => {
    await rejectTheQuestion()
    expect((mode === 'code' ? useCode : useTasks).getState().questions.q1).toBeUndefined()
    expect(html(mode)).toContain('rechazaste la pregunta')
    expect(html(mode)).toContain('¿Dónde guardarlo?')
    expect(promptAsync).not.toHaveBeenCalled()
  })

  it('no declara rechazado un permiso cuya respuesta falló y conserva la tarjeta', async () => {
    reply.mockResolvedValue({ error: { message: 'sin red' } })
    await rejectPermission().catch(() => {})
    expect((mode === 'code' ? useCode : useTasks).getState().permissions.p1).toBeDefined()
    expect(html(mode)).toBe('')
  })

  it('no declara rechazada una pregunta cuya respuesta falló', async () => {
    reject.mockResolvedValue({ error: { message: 'sin red' } })
    await rejectTheQuestion().catch(() => {})
    expect((mode === 'code' ? useCode : useTasks).getState().questions.q1).toBeDefined()
    expect(html(mode)).toBe('')
  })

  it('conserva la solicitud si el evento elimina la tarjeta mientras responde el servidor', async () => {
    reply.mockImplementation(async () => {
      useCode.setState({ permissions: {}, activeSessionID: 'other' })
      useTasks.setState({ permissions: {}, activeTaskId: 'other' })
      return { data: true }
    })
    await rejectPermission()
    expect(html(mode)).toContain('npm run build')
    expect(html(mode, 'other')).toBe('')
  })

  it('conserva el cierre en la conversación visible si el ayudante todavía no fue listado', async () => {
    useCode.setState({ sessions: {}, activeSessionID: 'root' })
    useSessions.setState({ sessions: {} })
    await rejectPermission()
    expect(html(mode)).toContain('npm run build')
  })

  it('aprobar y los rechazos internos de detención o reintento no generan avisos de rechazo manual', async () => {
    if (mode === 'code') {
      await useCode.getState().replyPermission(permission, 'once')
      await useCode.getState().replyPermission(permission, 'reject', true)
    } else {
      await replyPermission('p1', 'once')
      useTasks.setState({ permissions: { p1: permission } })
      await replyPermission('p1', 'reject', 'reinicio', true)
    }
    expect(html(mode)).toBe('')
  })
})

it('muestra una ruta de Windows en el aviso y usa el directorio aislado en la respuesta', async () => {
  useTasks.setState({
    folder: 'C:\\Trabajo',
    conn: {
      folder: 'C:\\Trabajo',
      directory: '/win/c/Trabajo',
      pathMap: { kind: 'wsl', mounts: [{ win: 'C:\\Trabajo', linux: '/win/c/Trabajo' }] },
      fullAccess: false
    } as TasksConnection,
    permissions: { p1: { ...permission, permission: 'edit', patterns: ['/win/c/Trabajo/informe.txt'] } }
  })
  await replyPermission('p1', 'reject')
  expect(reply).toHaveBeenCalledWith({ requestID: 'p1', directory: '/win/c/Trabajo', reply: 'reject' })
  expect(html('tasks', 'root', 'C:\\Trabajo')).toContain('C:\\Trabajo\\informe.txt')
})

it('el cierre está traducido y el detalle se muestra como texto', () => {
  setLang('en')
  useLang.setState({ lang: 'en' })
  useRejectionNotices
    .getState()
    .add({ mode: 'code', directory, sessionID: 'root', requestID: 'p', kind: 'permission', detail: '<script>unsafe()</script>' })
  expect(html('code')).toContain('I did not perform this action because you rejected it.')
  expect(html('code')).toContain('&lt;script&gt;')
  expect(html('code')).not.toContain('<script>')
})

it('el protocolo v2 de Código también produce el cierre local', async () => {
  const v2reply = vi.fn().mockResolvedValue({ data: true })
  useServer.setState({ client: { ...client, v2: { session: { permission: { reply: v2reply } } } } as never })
  await useCode.getState().replyPermission({ ...permission, api: 'v2' }, 'reject')
  expect(v2reply).toHaveBeenCalledWith({ sessionID: 'kid', requestID: 'p1', reply: 'reject' })
  expect(html('code')).toContain('No hice esta acción porque la rechazaste.')
  expect(promptAsync).not.toHaveBeenCalled()
})

it('el rechazo con indicaciones de Tareas conserva el mensaje y no añade una petición al modelo', async () => {
  await replyPermission('p1', 'reject', 'Usa otra carpeta')
  expect(reply).toHaveBeenCalledWith({ requestID: 'p1', directory, reply: 'reject', message: 'Usa otra carpeta' })
  expect(html('tasks')).toContain('No hice esta acción porque la rechazaste.')
  expect(promptAsync).not.toHaveBeenCalled()
})

it('el aviso aparece en el componente ya montado y su botón lo cierra sin llamar al motor', async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<RejectionNotices mode="code" directory={directory} sessionID="root" />))
  try {
    expect(host.innerHTML).toBe('')
    await act(async () => useCode.getState().replyPermission(permission, 'reject'))
    expect(host.querySelector('[role="status"]')?.textContent).toContain('No hice esta acción porque la rechazaste.')
    act(() => host.querySelector('button')?.click())
    expect(host.innerHTML).toBe('')
    expect(reply).toHaveBeenCalledTimes(1)
    expect(promptAsync).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
  }
})
