/**
 * Calidad T1 · H1: un adjunto sin texto es un mensaje válido (solo partes `file`) en send/enqueue/sendNow;
 * `send`/`sendNow` devuelven si el motor aceptó el envío (el compositor restaura el borrador si no).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'
const IMG = { id: 'a1', name: 'captura.png', mime: 'image/png', url: 'data:image/png;base64,AAAA' }

function install(promptAsync: () => Promise<unknown> = () => Promise.resolve({ data: {} })): ReturnType<typeof vi.fn> {
  const p = vi.fn(promptAsync)
  useServer.setState({
    client: { session: { promptAsync: p, abort: () => Promise.resolve({ data: true }) } } as never
  })
  return p
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
  useCode.getState().applyEvent(sessionCreated(makeSession('s1', D)).event, D)
  useCode.setState({ activeSessionID: 's1' })
})

describe('H1: adjunto sin texto', () => {
  it('send con solo una imagen manda únicamente la parte file (sin bloque de texto vacío)', async () => {
    const p = install()
    const ok = await useCode.getState().send('   ', [], [IMG])
    expect(ok).toBe(true)
    const parts = (p.mock.calls[0][0] as { parts: { type: string; url?: string }[] }).parts
    expect(parts).toEqual([{ type: 'file', mime: 'image/png', filename: 'captura.png', url: IMG.url }])
  })

  it('sin texto ni adjuntos no se envía nada', async () => {
    const p = install()
    expect(await useCode.getState().send('  ')).toBe(false)
    expect(await useCode.getState().sendNow('')).toBe(false)
    expect(useCode.getState().enqueue('s1', '')).toBe(false)
    expect(p).not.toHaveBeenCalled()
  })

  it('enqueue y sendNow aceptan un adjunto sin texto', async () => {
    const p = install()
    expect(useCode.getState().enqueue('s1', '', [], [IMG])).toBe(true)
    expect(useCode.getState().queue['s1']).toHaveLength(1)
    expect(await useCode.getState().sendNow('', [], [IMG])).toBe(true)
    expect(p).toHaveBeenCalledTimes(1)
  })

  it('con texto sigue mandando el bloque de texto primero', async () => {
    const p = install()
    await useCode.getState().send('hola', [], [IMG])
    const parts = (p.mock.calls[0][0] as { parts: { type: string }[] }).parts
    expect(parts.map((x) => x.type)).toEqual(['text', 'file'])
  })
})

describe('H3: resultado del envío', () => {
  it('si promptAsync falla, send devuelve false, la sesión vuelve a idle y queda el error', async () => {
    install(() => Promise.reject(new Error('sin red')))
    expect(await useCode.getState().send('hola')).toBe(false)
    expect(useCode.getState().runState['s1']).toBe('idle')
    expect(useCode.getState().errors['s1']).toBeTruthy()
  })
})
