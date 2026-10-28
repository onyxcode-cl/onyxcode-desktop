/** Modo unificado: con un chat abierto el chip es un menú «Seguir en otra carpeta…»; el chat nunca cambia de carpeta. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const h = vi.hoisted(() => ({
  cw: vi.fn(),
  connectFolder: vi.fn(async (_f: string, _full?: boolean): Promise<void> => undefined),
  unified: false,
  patch: {} as Record<string, unknown>
}))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
vi.mock('./bridge', async (orig) => ({ ...(await orig<typeof import('./bridge')>()), cw: h.cw }))
vi.mock('./unified', async (orig) => ({ ...(await orig<typeof import('./unified')>()), useUnifiedApps: () => h.unified }))
vi.mock('./store', async (orig) => {
  const mod = await orig<typeof import('./store')>()
  const useTasks = Object.assign((sel: (s: unknown) => unknown) => sel({ ...mod.useTasks.getState(), ...h.patch }), mod.useTasks)
  return { ...mod, useTasks, connectFolder: h.connectFolder }
})

import { useSessions } from '../../../stores/sessions'
import { approvePending, cancelPending, continueInOtherFolder } from './actions'
import { UnifiedScopeChip } from './ScopePicker'
import { useTasks } from './store'

const msg = (id: string, role: 'user' | 'assistant', text: string) =>
  ({ info: { id, role, sessionID: 'ses_1' }, parts: [{ id: `p${id}`, type: 'text', text }] }) as never

beforeEach(() => {
  h.cw.mockReset()
  h.connectFolder.mockClear()
  useTasks.setState({ activeTaskId: 'ses_1', folder: '/a/chat', draft: '', folders: [{ path: '/work/p' }] as never, pendingApproval: null })
  useSessions.setState({
    messages: { ses_1: [msg('m1', 'user', 'primero'), msg('m2', 'assistant', 'ok'), msg('m3', 'user', 'segundo')] }
  } as never)
})
afterEach(() => {
  h.unified = false
  h.patch = {}
})

describe('chip de alcance con chat abierto', () => {
  it('con bandera y chat abierto es un menú con la frase de ayuda; sin chat es el chip de siempre', () => {
    h.unified = true
    h.patch = { activeTaskId: 'ses_1', folder: '/work/p' }
    expect(renderToStaticMarkup(<UnifiedScopeChip />)).toContain('aria-haspopup')
    h.patch = { activeTaskId: null, folder: '/work/p' }
    const html = renderToStaticMarkup(<UnifiedScopeChip />)
    expect(html).not.toContain('aria-haspopup')
    expect(html).toContain('Carpeta: p')
  })
})

describe('Seguir en otra carpeta', () => {
  it('carpeta ya autorizada: conecta aislada, abre tarea nueva y deja el último mensaje como borrador', async () => {
    h.cw.mockResolvedValueOnce('/work/p')
    await continueInOtherFolder()
    expect(h.connectFolder).toHaveBeenCalledWith('/work/p', false)
    expect(h.connectFolder.mock.calls.every((c) => c[1] === false)).toBe(true)
    expect(useTasks.getState().activeTaskId).toBeNull()
    expect(useTasks.getState().draft).toBe('segundo')
    expect(useSessions.getState().messages['ses_1']).toHaveLength(3)
  })
  it('sin mensajes del usuario no deja borrador', async () => {
    useSessions.setState({ messages: { ses_1: [msg('m2', 'assistant', 'ok')] } } as never)
    h.cw.mockResolvedValueOnce('/work/p')
    await continueInOtherFolder()
    expect(useTasks.getState().draft).toBe('')
    expect(useTasks.getState().activeTaskId).toBeNull()
  })
  it('cancelar el selector no hace nada', async () => {
    h.cw.mockResolvedValueOnce(null)
    await continueInOtherFolder()
    expect(h.connectFolder).not.toHaveBeenCalled()
    expect(useTasks.getState().activeTaskId).toBe('ses_1')
    expect(useTasks.getState().draft).toBe('')
  })
  it('carpeta nueva: pide la aprobación de siempre y solo después sigue; rechazarla no cambia nada', async () => {
    h.cw.mockResolvedValueOnce('/nueva')
    await continueInOtherFolder()
    expect(useTasks.getState().pendingApproval).toBe('/nueva')
    expect(h.connectFolder).not.toHaveBeenCalled()
    h.cw.mockResolvedValueOnce({ path: '/nueva' }).mockResolvedValue([])
    await approvePending()
    expect(h.connectFolder).toHaveBeenCalledWith('/nueva', false)
    expect(useTasks.getState().draft).toBe('segundo')
    expect(useTasks.getState().activeTaskId).toBeNull()
  })
  it('cancelar la aprobación no conecta ni cambia de tarea', async () => {
    h.cw.mockResolvedValueOnce('/nueva')
    await continueInOtherFolder()
    cancelPending()
    expect(h.connectFolder).not.toHaveBeenCalled()
    expect(useTasks.getState().activeTaskId).toBe('ses_1')
  })
})
