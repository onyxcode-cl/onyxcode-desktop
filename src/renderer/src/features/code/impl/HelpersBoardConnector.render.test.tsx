// @vitest-environment jsdom
/** El tablero «Ayudantes» solo le pide cosas al motor (leer una hija, abortar) con la carpeta con foco y confianza vigente. */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
import { useServer } from '../../../stores/server'
import { useCode } from './store'
import { markVerified, unmarkVerified } from './verified-folders'
import { CodeHelpersBoard } from './HelpersBoardConnector'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const F = '/work/a'
const OTRA = '/work/otra'
const now = Date.now()
const sess = (id: string, parentID?: string): never => ({ id, parentID, title: id, time: { created: now - 30_000, updated: now } }) as never
const task = (child: string): never =>
  ({
    type: 'tool',
    tool: 'task',
    state: { status: 'running', input: { description: `Hace ${child}` }, metadata: { sessionId: child } }
  }) as never

const abort = vi.fn(() => Promise.resolve({ data: true }))
const messages = vi.fn(() => Promise.resolve({ data: [] }))
let host: HTMLDivElement
let root: Root

const seed = (dir: string | null, trusted: string[]): void =>
  useCode.setState({
    directory: dir,
    openDirectories: dir ? [dir] : [],
    trustedFolders: trusted,
    activeSessionID: 'root',
    sessions: { root: sess('root'), kid: sess('kid', 'root') },
    sessionProject: { root: F, kid: F },
    runState: { root: 'busy', kid: 'busy' },
    messages: { root: [{ info: { id: 'm1' } as never, parts: [task('kid')] }] },
    permissions: {},
    questions: {},
    elicitations: {},
    errors: {}
  } as never)

beforeEach(() => {
  vi.unstubAllGlobals()
  abort.mockClear()
  messages.mockClear()
  unmarkVerified(F)
  useServer.setState({ client: { session: { abort, messages } } } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})
const mount = (): void => act(() => root.render(createElement(CodeHelpersBoard)))
const click = async (re: RegExp): Promise<void> => {
  const b = [...host.querySelectorAll('button')].find((x) => re.test(x.getAttribute('aria-label') ?? x.textContent ?? ''))
  expect(b, String(re)).toBeDefined()
  await act(async () => b!.click())
}

describe('CodeHelpersBoard', () => {
  it('con foco, confianza y verificación: muestra al ayudante y «Detener» aborta su sesión con la carpeta', async () => {
    markVerified(F)
    seed(F, [F])
    mount()
    expect(host.textContent).toContain('Hace kid')
    await click(/Detener «Hace kid»/)
    expect(abort).toHaveBeenCalledWith({ sessionID: 'kid', directory: F })
  })

  it('«Detener todos» aborta a cada ayudante vivo', async () => {
    markVerified(F)
    seed(F, [F])
    mount()
    await click(/Detener todos/)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('«Ver» lee los mensajes de la hija con la carpeta', async () => {
    markVerified(F)
    seed(F, [F])
    mount()
    await click(/Ver la conversación/)
    expect(messages).toHaveBeenCalledWith({ sessionID: 'kid', directory: F })
  })

  it('carpeta de confianza pero sin verificar en esta ejecución: no hay acciones y nunca se pide nada al motor', () => {
    seed(F, [F])
    mount()
    expect(host.textContent).toContain('Hace kid')
    expect(host.textContent).toContain('Abre esta carpeta con confianza')
    expect(host.querySelector('button[aria-label^="Detener"]')).toBeNull()
    expect(abort).not.toHaveBeenCalled()
    expect(messages).not.toHaveBeenCalled()
  })

  it('la conversación pertenece a una carpeta que no tiene el foco: no hay acciones ni peticiones', () => {
    markVerified(F)
    seed(OTRA, [F, OTRA])
    mount()
    expect(host.textContent).toContain('Abre esta carpeta con confianza')
    expect(host.querySelector('button[aria-label^="Ver"]')).toBeNull()
    expect(abort).not.toHaveBeenCalled()
    expect(messages).not.toHaveBeenCalled()
  })

  it('sin confianza vigente tampoco', () => {
    markVerified(F)
    seed(F, [])
    mount()
    expect(host.querySelector('button[aria-label^="Detener"]')).toBeNull()
    expect(abort).not.toHaveBeenCalled()
  })

  it('sin ayudantes no pinta nada', () => {
    markVerified(F)
    seed(F, [F])
    useCode.setState({ messages: { root: [] } } as never)
    mount()
    expect(host.innerHTML).toBe('')
  })
})
