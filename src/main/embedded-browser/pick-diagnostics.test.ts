import { describe, expect, it } from 'vitest'
import type { CdpSession } from './api'
import { startDiagnostics } from './pick-diagnostics'

function fakeSession(): { session: CdpSession; emit: (event: string, params: unknown) => void; sent: string[]; listeners: () => number } {
  const handlers = new Map<string, Set<(p: unknown) => void>>()
  const sent: string[] = []
  const session = {
    send: async (method: string) => {
      sent.push(method)
      return undefined
    },
    on: (event: string, fn: (p: unknown) => void) => {
      const set = handlers.get(event) ?? new Set()
      set.add(fn)
      handlers.set(event, set)
      return () => set.delete(fn)
    },
    isolatedContext: async () => 1
  } as unknown as CdpSession
  return {
    session,
    sent,
    emit: (event, params) => handlers.get(event)?.forEach((fn) => fn(params)),
    listeners: () => [...handlers.values()].reduce((n, s) => n + s.size, 0)
  }
}

describe('startDiagnostics', () => {
  it('recoge errores de consola, excepciones y fallos de red desde ahora', async () => {
    let clock = 1_000_000
    const f = fakeSession()
    const c = await startDiagnostics(f.session, () => clock)
    expect(f.sent).toEqual(['Runtime.enable', 'Log.enable', 'Network.enable'])

    f.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'hola' }], timestamp: clock + 1 })
    f.emit('Runtime.consoleAPICalled', {
      type: 'error',
      args: [
        { type: 'string', value: 'boom' },
        { type: 'number', value: 3 }
      ],
      timestamp: clock + 2
    })
    f.emit('Runtime.consoleAPICalled', { type: 'warning', args: [{ type: 'object', description: 'Object' }], timestamp: clock + 3 })
    f.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'viejo' }], timestamp: clock - 5000 })
    f.emit('Runtime.exceptionThrown', {
      timestamp: clock + 4,
      exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x is undefined\n    at a.js:1' } }
    })
    f.emit('Log.entryAdded', { entry: { level: 'info', text: 'no', timestamp: clock + 5 } })
    f.emit('Log.entryAdded', { entry: { level: 'error', text: 'Failed to load resource', timestamp: clock + 5 } })

    f.emit('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://a.com/missing?x=1', method: 'GET' } })
    f.emit('Network.responseReceived', { requestId: '1', response: { status: 404, url: 'https://a.com/missing?x=1' } })
    f.emit('Network.requestWillBeSent', { requestId: '2', request: { url: 'https://a.com/ok', method: 'GET' } })
    f.emit('Network.responseReceived', { requestId: '2', response: { status: 200, url: 'https://a.com/ok' } })
    f.emit('Network.requestWillBeSent', { requestId: '3', request: { url: 'https://b.com/api', method: 'POST' } })
    f.emit('Network.loadingFailed', { requestId: '3', errorText: 'net::ERR_CONNECTION_REFUSED' })
    f.emit('Network.requestWillBeSent', { requestId: '4', request: { url: 'https://a.com/x', method: 'GET' } })
    f.emit('Network.loadingFailed', { requestId: '4', errorText: 'net::ERR_ABORTED', canceled: true })

    clock += 777
    const snap = c.snapshot()
    expect(snap.console).toEqual([
      { level: 'error', text: 'boom 3' },
      { level: 'warning', text: 'Object' },
      { level: 'error', text: 'TypeError: x is undefined' },
      { level: 'error', text: 'Failed to load resource' }
    ])
    expect(snap.network).toEqual([
      { method: 'GET', url: 'https://a.com/missing?x=1', status: 404 },
      { method: 'POST', url: 'https://b.com/api', error: 'net::ERR_CONNECTION_REFUSED' }
    ])
    expect(snap.sinceMs).toBe(777)
  })

  it('dispose suelta todos los oyentes y se puede repetir', async () => {
    const f = fakeSession()
    const c = await startDiagnostics(f.session)
    expect(f.listeners()).toBeGreaterThan(0)
    c.dispose()
    c.dispose()
    expect(f.listeners()).toBe(0)
    f.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'tarde' }] })
    expect(c.snapshot().console).toEqual([])
  })

  it('si un dominio falla al activarse, sigue funcionando', async () => {
    const f = fakeSession()
    ;(f.session as unknown as { send: () => Promise<never> }).send = () => Promise.reject(new Error('no'))
    const c = await startDiagnostics(f.session)
    expect(c.snapshot()).toMatchObject({ console: [], network: [] })
  })

  it('guarda solo las últimas entradas', async () => {
    const f = fakeSession()
    const c = await startDiagnostics(f.session)
    for (let i = 0; i < 100; i++) f.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: `e${i}` }] })
    const snap = c.snapshot()
    expect(snap.console.length).toBe(10)
    expect(snap.console[9].text).toBe('e99')
  })
})
