/**
 * W-A3 (RI, hallazgo 1): «Permitir siempre» sobre una tarjeta de EDICIÓN de un ayudante (`general`) no debe llegar al motor como «siempre»:
 * el motor guardaría `edit *` para toda la carpeta y saltaría los `ask` de `opencode.json`/`.opencode/*` (W-A1), también para el padre.
 * La contención está solo en la interfaz (`replyPermission` de store.ts); estas pruebas la fijan.
 * Limite conocido (pendiente, ver docs/SEGURIDAD.md): una petición de una sesión que la app aún no conoce y SIN conversación activa no se
 * considera hija (`isChildRequest`, child-sessions.ts), así que ahí «siempre» llegaría tal cual.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, type TraceEvent } from '../../../../../test/fixtures/events'
import { rulesetFor } from './permission-rules'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'

beforeEach(async () => {
  vi.resetModules()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const apply = (te: TraceEvent): void => st().applyEvent(te.event, te.directory)
const raw = (e: unknown): void => st().applyEvent(e as never, D)

function install(): { reply: ReturnType<typeof vi.fn>; v2reply: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const reply = vi.fn(() => Promise.resolve({ data: true }))
  const v2reply = vi.fn(() => Promise.resolve({ data: true }))
  const update = vi.fn(() => Promise.resolve({ data: {} }))
  useServer.setState({
    client: {
      permission: { reply, list: () => Promise.resolve({ data: [] }) },
      v2: { session: { permission: { reply: v2reply } } },
      session: { abort: vi.fn(), update, status: () => Promise.resolve({ data: {} }) },
      question: { list: () => Promise.resolve({ data: [] }) }
    } as never
  })
  return { reply, v2reply, update }
}

/** Petición de edición como la que manda el motor (`always: ['*']`: guardaría `edit *` para toda la carpeta). */
const askEdit = (id: string, sessionID: string, file = 'opencode.json'): void =>
  raw({
    type: 'permission.asked',
    properties: { id, sessionID, permission: 'edit', patterns: [file], metadata: { filepath: file }, always: ['*'] }
  })

describe('«siempre» desde un ayudante que edita (general)', () => {
  it('hija conocida: la edición con always:["*"] se responde «una vez» y no se tocan las reglas de la sesión', async () => {
    const { reply, update } = install()
    apply(sessionCreated(makeSession('root', D, { permission: rulesetFor('auto') })))
    apply(sessionCreated(makeSession('kid', D, { parentID: 'root', title: 'trabajo (@general subagent)' })))
    useCode.setState({ activeSessionID: 'root' })
    askEdit('p1', 'kid')
    await st().replyPermission(st().permissions['p1']!, 'always')
    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply).toHaveBeenCalledWith({ requestID: 'p1', reply: 'once', directory: D })
    expect(update).not.toHaveBeenCalled()
  })

  it('hija todavía desconocida pero con otra conversación abierta: también «una vez»', async () => {
    const { reply } = install()
    apply(sessionCreated(makeSession('root', D, { permission: rulesetFor('manual') })))
    useCode.setState({ activeSessionID: 'root' })
    askEdit('p2', 'kid-nueva')
    await st().replyPermission(st().permissions['p2']!, 'always')
    expect(reply).toHaveBeenCalledWith({ requestID: 'p2', reply: 'once', directory: D })
  })

  it('protocolo v2: «siempre» de una hija que edita también va como «una vez»', async () => {
    const { v2reply } = install()
    apply(sessionCreated(makeSession('root', D, { permission: rulesetFor('auto') })))
    apply(sessionCreated(makeSession('kid', D, { parentID: 'root' })))
    useCode.setState({ activeSessionID: 'root' })
    raw({
      type: 'permission.v2.asked',
      properties: { id: 'p3', sessionID: 'kid', action: 'edit', resources: ['opencode.json'], metadata: {}, save: ['*'] }
    })
    await st().replyPermission(st().permissions['p3']!, 'always')
    expect(v2reply).toHaveBeenCalledWith({ sessionID: 'kid', requestID: 'p3', reply: 'once' })
  })

  it('«una vez» y «rechazar» de la hija llegan tal cual', async () => {
    const { reply } = install()
    apply(sessionCreated(makeSession('root', D, { permission: rulesetFor('auto') })))
    apply(sessionCreated(makeSession('kid', D, { parentID: 'root' })))
    useCode.setState({ activeSessionID: 'root' })
    askEdit('p4', 'kid')
    askEdit('p5', 'kid')
    await st().replyPermission(st().permissions['p4']!, 'once')
    await st().replyPermission(st().permissions['p5']!, 'reject')
    expect(reply).toHaveBeenNthCalledWith(1, { requestID: 'p4', reply: 'once', directory: D })
    expect(reply).toHaveBeenNthCalledWith(2, { requestID: 'p5', reply: 'reject', directory: D })
  })

  it('LÍMITE CONOCIDO (pendiente): sesión desconocida y SIN conversación activa no cuenta como hija y «siempre» pasa tal cual', async () => {
    const { reply } = install()
    useCode.setState({ activeSessionID: null })
    askEdit('p6', 'kid-fantasma')
    await st().replyPermission(st().permissions['p6']!, 'always')
    // Si algún día se cierra (isChildRequest o el motor), este caso debe pasar a «once» y esta prueba se invierte.
    expect(reply).toHaveBeenCalledWith({ requestID: 'p6', reply: 'always', directory: D })
  })
})
