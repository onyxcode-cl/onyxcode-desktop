import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const sent: Array<{ wc: number; ch: string; args: unknown[] }> = []
  const wins: Array<{
    webContents: { id: number; send: (ch: string, ...a: unknown[]) => void; isDestroyed: () => boolean }
    isDestroyed: () => boolean
  }> = []
  const make = (id: number) => ({
    isDestroyed: () => false,
    webContents: { id, isDestroyed: () => false, send: (ch: string, ...args: unknown[]) => void sent.push({ wc: id, ch, args }) }
  })
  return { sent, wins, make }
})
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => h.wins },
  webContents: { fromId: (id: number) => h.wins.find((w) => w.webContents.id === id)?.webContents }
}))

import { _resetEventBus, emit, emitTo, publish, publishTo, publishToSender, subscribeRemote } from './event-bus'
import { broadcast, sendTo } from './handle'
import { createRemoteSender } from '../remote/sender'

beforeEach(() => {
  h.sent.length = 0
  h.wins.length = 0
  _resetEventBus()
})

describe('event-bus', () => {
  it('a ventanas: mismos canal y carga, en orden, a todas', () => {
    h.wins.push(h.make(1), h.make(2))
    broadcast('settings:changed', { a: 1 } as never)
    emit('routines:changed', [] as never)
    expect(h.sent).toEqual([
      { wc: 1, ch: 'settings:changed', args: [{ a: 1 }] },
      { wc: 2, ch: 'settings:changed', args: [{ a: 1 }] },
      { wc: 1, ch: 'routines:changed', args: [[]] },
      { wc: 2, ch: 'routines:changed', args: [[]] }
    ])
  })

  it('sin carga se envía sin argumentos (eventos void de extras)', () => {
    h.wins.push(h.make(1))
    publish('extras:quick-shown' as never)
    expect(h.sent).toEqual([{ wc: 1, ch: 'extras:quick-shown', args: [] }])
  })

  it('un suscriptor remoto recibe aunque no haya ninguna ventana abierta', () => {
    const got: Array<[string, unknown]> = []
    subscribeRemote({ channels: new Set(['opencode:status']), deliver: (c, p) => got.push([c, p]) })
    publish('opencode:status', { state: 'running' } as never)
    expect(got).toEqual([['opencode:status', { state: 'running' }]])
    expect(h.sent).toEqual([])
  })

  it('lista blanca (sin canales = nada) y recorte antes de salir', () => {
    const got: Array<[string, unknown]> = []
    subscribeRemote({ channels: new Set(), deliver: (c, p) => got.push([c, p]) })
    const unsub = subscribeRemote({
      channels: new Set(['settings:changed', 'routines:run']),
      trim: (c, p) => (c === 'routines:run' ? null : { only: (p as { keep: number }).keep }),
      deliver: (c, p) => got.push([c, p])
    })
    emit('settings:changed', { keep: 1, secret: 'x' } as never)
    emit('routines:run', {} as never)
    emit('app:updateState', {} as never)
    expect(got).toEqual([['settings:changed', { only: 1 }]])
    unsub()
    emit('settings:changed', { keep: 2 } as never)
    expect(got).toHaveLength(1)
  })

  it('un suscriptor que falla no afecta a ventanas ni a otros suscriptores', () => {
    h.wins.push(h.make(1))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const got: string[] = []
    subscribeRemote({
      channels: new Set(['settings:changed']),
      deliver: () => {
        throw new Error('boom')
      }
    })
    subscribeRemote({ channels: new Set(['settings:changed']), deliver: (c) => got.push(c) })
    emit('settings:changed', {} as never)
    expect(h.sent).toHaveLength(1)
    expect(got).toEqual(['settings:changed'])
    err.mockRestore()
  })

  it('el envío dirigido a una ventana no llega al celular ni a otras ventanas', () => {
    h.wins.push(h.make(1), h.make(2))
    const got: string[] = []
    subscribeRemote({ channels: new Set(['app:openTarget']), deliver: (c) => got.push(c) })
    emitTo(h.wins[1] as never, 'app:openTarget', { mode: 'chat' } as never)
    publishTo([h.wins[0]!.webContents, null] as never, 'app:openTarget', { mode: 'tasks' } as never)
    sendTo(h.wins[1]!.webContents as never, 'settings:changed', {} as never)
    expect(h.sent.map((s) => s.wc)).toEqual([2, 1, 2])
    expect(got).toEqual([])
  })

  it('ventanas destruidas se saltan', () => {
    const w = h.make(1)
    w.webContents.isDestroyed = () => true
    h.wins.push(w)
    publish('settings:changed', {} as never)
    expect(h.sent).toEqual([])
  })

  it('publishToSender: ventana real por id y remitente virtual por id negativo', () => {
    h.wins.push(h.make(3))
    const sent: unknown[][] = []
    const virtual = createRemoteSender((ch, ...a) => sent.push([ch, ...a]))
    publishToSender(3, 'pty:data' as never, { id: 'p', data: 'd' })
    publishToSender(virtual.id, 'pty:data' as never, { id: 'p', data: 'v' })
    expect(h.sent).toEqual([{ wc: 3, ch: 'pty:data', args: [{ id: 'p', data: 'd' }] }])
    expect(sent).toEqual([['pty:data', { id: 'p', data: 'v' }]])
    virtual.destroy()
    publishToSender(virtual.id, 'pty:data' as never, {})
    expect(sent).toHaveLength(1)
  })
})
