import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeSession,
  sessionCreated,
  resetEventIds,
  msgUpdated,
  partUpdated,
  assistantMessage,
  toolPart
} from '../../../../../test/fixtures/events'
import { rulesetFor } from './permission-rules'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
let useCode: (typeof import('./store'))['useCode']
const reply = vi.fn(async (_args: unknown) => ({ data: true }))
beforeEach(async () => {
  vi.resetModules()
  resetEventIds()
  reply.mockClear()
  ;({ useCode } = await import('./store'))
  const { useServer } = await import('../../../stores/server')
  useServer.setState({ client: { permission: { reply } } as never })
})

for (const directory of ['/work/code', 'C:\\work\\code']) {
  describe(`ayudantes en Automático: ${directory}`, () => {
    const open = (mode: 'auto' | 'manual' | 'plan' = 'auto'): void => {
      useCode.setState({ directory, activeSessionID: 'root' })
      for (const session of [
        makeSession('root', directory, { permission: rulesetFor(mode) }),
        makeSession('kid', directory, { parentID: 'root' })
      ]) {
        const event = sessionCreated(session)
        useCode.getState().applyEvent(event.event, directory)
      }
    }
    const ask = (id: string, permission: string, patterns: string[], metadata = {}): void => {
      useCode
        .getState()
        .applyEvent(
          { type: 'permission.asked', properties: { id, sessionID: 'kid', permission, patterns, metadata, always: ['*'] } } as never,
          directory
        )
    }
    it('edita dentro del proyecto sin tarjeta, una vez, sin ampliar las reglas', async () => {
      open()
      const rules = useCode.getState().sessions.root.permission
      ask('edit', 'edit', [`${directory}/suma.js`, 'test.js'])
      await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ requestID: 'edit', reply: 'once', directory }))
      expect(useCode.getState().permissions.edit).toBeUndefined()
      expect(useCode.getState().sessions.root.permission).toEqual(rules)
    })
    it('deja tarjeta para borrar, salir del proyecto, instalar global, rutas protegidas y patrones desconocidos', () => {
      open()
      ask('delete', 'bash', ['rm suma.js'], { command: 'rm suma.js' })
      ask('global', 'bash', ['npm install -g test'], { command: 'npm install -g test' })
      ask('outside', 'edit', [`${directory}-other/suma.js`])
      ask('traversal', 'edit', ['../outside.js'])
      ask('protected', 'edit', ['suma.js'], { lazunoxProtegido: true })
      ask('config', 'edit', ['.git/config'])
      ask('all', 'edit', ['*'])
      ask('external', 'external_directory', ['/other'])
      expect(reply).not.toHaveBeenCalled()
      expect(Object.keys(useCode.getState().permissions)).toHaveLength(8)
    })
    it('reintenta el comando de la hija cuando llega su entrada por SSE', async () => {
      open()
      const askEvent = {
        type: 'permission.asked',
        properties: {
          id: 'late',
          sessionID: 'kid',
          permission: 'bash',
          patterns: ['ls'],
          metadata: { command: 'ls' },
          always: ['*'],
          tool: { messageID: 'a1', callID: 'call1' }
        }
      }
      useCode.getState().applyEvent(askEvent as never, directory)
      expect(reply).not.toHaveBeenCalled()
      for (const event of [
        msgUpdated(assistantMessage('a1', 'kid'), directory),
        partUpdated(toolPart('p1', 'a1', 'kid', 'bash', { status: 'running', input: { command: 'ls' } }, 'call1'), directory)
      ])
        useCode.getState().applyEvent(event.event, directory)
      await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ requestID: 'late', reply: 'once', directory }))
    })
    it.each(['manual', 'plan'] as const)('no hereda edición en %s', (mode) => {
      open(mode)
      ask('edit', 'edit', ['suma.js'])
      expect(reply).not.toHaveBeenCalled()
    })
    it('no hereda desde una raíz desconocida ni de otra carpeta', () => {
      open()
      useCode.setState((s) => ({ sessionProject: { ...s.sessionProject, root: '/other' } }))
      ask('other', 'edit', ['suma.js'])
      useCode.setState((s) => ({ sessions: { ...s.sessions, kid: { ...s.sessions.kid, parentID: 'missing' } } }))
      ask('missing', 'edit', ['test.js'])
      expect(reply).not.toHaveBeenCalled()
    })
  })
}
