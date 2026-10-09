/**
 * Memoria aprendida en Code (decisión del dueño, 2026-10-07): el `system` del prompt lleva la memoria
 * global aprobada y la invitación a proponer más, PERO nunca desde el celular (`PROMPT_KEYS` en
 * `remote/policy.ts` no incluye `system`: si el celular pudiera armar uno igual, sería una forma de colar
 * instrucciones de "sistema" sin pasar por la aprobación del dueño en el Mac/PC).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REMOTE_SURFACE } from '@shared/platform-caps'
import { DEFAULT_SETTINGS } from '@shared/types'
import { makeSession, resetEventIds } from '../../../../../test/fixtures/events'

const sendNotification = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/notify', () => ({ sendNotification, setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
let useSettings: (typeof import('../../../stores/settings'))['useSettings']
let useCodeLearnedMemory: (typeof import('./learned-memory-store'))['useCodeLearnedMemory']

const D = '/work/a'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;(globalThis as { window: { api?: { platform?: string } } }).window.api!.platform = 'darwin'
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  ;({ useSettings } = await import('../../../stores/settings'))
  ;({ useCodeLearnedMemory } = await import('./learned-memory-store'))
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, learningEnabled: true } })
  useCodeLearnedMemory.setState({ learnedUser: null })
})

function installClient(promptAsync = vi.fn((_req: { system?: string }) => Promise.resolve({ data: {} }))): {
  promptAsync: typeof promptAsync
} {
  const client = {
    session: {
      list: () => Promise.resolve({ data: [] }),
      status: () => Promise.resolve({ data: {} }),
      messages: () => Promise.resolve({ data: [] }),
      todo: () => Promise.resolve({ data: [] }),
      update: () => Promise.resolve({ data: makeSession('s1', D) }),
      promptAsync
    },
    permission: { list: () => Promise.resolve({ data: [] }) },
    question: { list: () => Promise.resolve({ data: [] }) }
  }
  useServer.setState({ client: client as never })
  return { promptAsync }
}

async function openWithSession(): Promise<void> {
  const session = makeSession('s1', D)
  useCode.setState((s) => ({
    directory: D,
    openDirectories: [D],
    sessions: { ...s.sessions, s1: session },
    sessionProject: { ...s.sessionProject, s1: D },
    activeSessionID: 's1'
  }))
}

describe('system prompt de Code: memoria aprendida', () => {
  it('en escritorio, con memoria aprendida y aprendizaje encendido: el system la lleva, e invita a proponer', async () => {
    const { promptAsync } = installClient()
    await openWithSession()
    useCodeLearnedMemory.setState({ learnedUser: 'Preferencias:\n- prefiere tablas' })
    await useCode.getState().send('hola')
    const call = promptAsync.mock.calls[0]?.[0] as { system?: string }
    expect(call.system).toContain('prefiere tablas')
    expect(call.system).toContain('lazunox-memoria')
  })

  it('con el aprendizaje apagado: el system avisa que está apagado, sin la memoria guardada', async () => {
    const { promptAsync } = installClient()
    await openWithSession()
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, learningEnabled: false } })
    useCodeLearnedMemory.setState({ learnedUser: 'prefiere tablas' })
    await useCode.getState().send('hola')
    const call = promptAsync.mock.calls[0]?.[0] as { system?: string }
    expect(call.system).toContain('desactivado')
    expect(call.system).not.toContain('prefiere tablas')
  })

  it('desde el celular (isRemoteSurface): el system nunca se manda, aunque haya memoria aprendida', async () => {
    ;(globalThis as { window: { api?: { platform?: string } } }).window.api!.platform = REMOTE_SURFACE
    vi.resetModules()
    ;({ useCode } = await import('./store'))
    ;({ useServer } = await import('../../../stores/server'))
    ;({ useSettings } = await import('../../../stores/settings'))
    ;({ useCodeLearnedMemory } = await import('./learned-memory-store'))
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, learningEnabled: true } })
    useCodeLearnedMemory.setState({ learnedUser: 'prefiere tablas' })
    const { promptAsync } = installClient()
    await openWithSession()
    await useCode.getState().send('hola')
    const call = promptAsync.mock.calls[0]?.[0] as { system?: string }
    expect(call.system).toBeUndefined()
  })
})
