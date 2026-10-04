import { describe, expect, it } from 'vitest'
import { EventsHub } from './events-hub'
import { FakeLink } from './fake-link'

const setup = (): { link: FakeLink; hub: EventsHub } => {
  const link = new FakeLink()
  return { link, hub: new EventsHub(link) }
}

describe('EventsHub', () => {
  it('UNA suscripción a `main` compartida: `ch` va a los oyentes IPC y `oc` a los streams', async () => {
    const { link, hub } = setup()
    const ipc: unknown[] = []
    const oc: string[] = []
    hub.onChannel('opencode:status', (p) => ipc.push(p))
    const open = hub.openStream('main', { onEvent: (e) => oc.push(e.oc), onReset: () => undefined, onEnd: () => undefined })
    expect(link.subs).toHaveLength(1)
    link.live('main')!.h.onReady?.(5)
    await open
    const h = link.live('main')!.h
    h.onEvent({ seq: 6, ch: 'opencode:status', p: { state: 'ready' } })
    h.onEvent({ seq: 7, oc: 'session.created', p: {} })
    expect(ipc).toEqual([{ state: 'ready' }])
    expect(oc).toEqual(['session.created'])
  })

  it('no se suscribe mientras el canal está bloqueado y lo hace al quedar en línea', () => {
    const { link, hub } = setup()
    link.set('locked')
    hub.onChannel('a', () => undefined)
    expect(link.subs).toHaveLength(0)
    link.set('online')
    expect(link.subs).toHaveLength(1)
  })

  it('al volver el canal reanuda con `since` = último seq (sin huecos)', () => {
    const { link, hub } = setup()
    hub.onChannel('a', () => undefined)
    const first = link.live('main')!
    first.h.onReady?.(10)
    first.h.onEvent({ seq: 11, ch: 'a', p: 1 })
    first.h.onEvent({ seq: 12, ch: 'a', p: 2 })
    link.set('reconnecting')
    link.end(first, 'disconnected')
    expect(link.live('main')).toBeUndefined()
    link.set('online')
    expect(link.live('main')?.since).toBe(12)
  })

  it('el bloqueo del Mac (`forbidden`) termina la suscripción; no cuenta como en línea y tras desbloquear reanuda con `since`', () => {
    const { link, hub } = setup()
    hub.onChannel('a', () => undefined)
    const first = link.live('main')!
    first.h.onReady?.(10)
    first.h.onEvent({ seq: 11, ch: 'a', p: 1 })
    link.set('locked')
    link.end(first, 'forbidden')
    expect(link.live('main')).toBeUndefined()
    // Mientras sigue bloqueado no se vuelve a suscribir (un oyente nuevo tampoco abre nada).
    hub.onChannel('b', () => undefined)
    expect(link.live('main')).toBeUndefined()
    link.set('online')
    expect(link.live('main')?.since).toBe(11)
  })

  it('sin oyentes IPC, al terminar la suscripción se descarta el motor (no se reabre sola)', () => {
    const { link, hub } = setup()
    void hub
      .openStream('task/abcdefgh1234', { onEvent: () => undefined, onReset: () => undefined, onEnd: () => undefined })
      .catch(() => undefined)
    link.end(link.live('task/abcdefgh1234')!, 'disconnected')
    expect(hub.size).toBe(0)
    link.set('reconnecting')
    link.set('online')
    expect(link.subs).toHaveLength(1)
  })

  it('`reset` y un acuse con seq menor (el Mac se reinició) cierran los streams para resincronizar', async () => {
    const { link, hub } = setup()
    let resets = 0
    hub.onChannel('a', () => undefined) // mantiene viva la entrada entre reconexiones
    const open = hub.openStream('main', { onEvent: () => undefined, onReset: () => resets++, onEnd: () => undefined })
    link.live('main')!.h.onReady?.(3)
    await open
    link.live('main')!.h.onEvent({ seq: 4, oc: 'x' })
    link.live('main')!.h.onReset?.(9)
    expect(resets).toBe(1)
    // Cae y vuelve: se reanuda desde 9; un stream nuevo se engancha a esa entrada y el Mac acusa un seq MENOR (se reinició).
    link.end(link.live('main')!, 'disconnected')
    link.set('reconnecting')
    link.set('online')
    const r = link.live('main')!
    expect(r.since).toBe(9)
    const again = hub.openStream('main', { onEvent: () => undefined, onReset: () => resets++, onEnd: () => undefined })
    r.h.onReady?.(2)
    await again
    expect(resets).toBe(2)
  })

  it('soltar el último oyente/stream cancela la suscripción', async () => {
    const { link, hub } = setup()
    const off = hub.onChannel('a', () => undefined)
    const sub = link.live('main')!
    off()
    expect(sub.cancelled).toBe(true)
    expect(hub.size).toBe(0)
    const open = hub.openStream('main', { onEvent: () => undefined, onReset: () => undefined, onEnd: () => undefined })
    link.live('main')!.h.onReady?.(1)
    const unsub = await open
    const s2 = link.live('main')!
    unsub()
    expect(s2.cancelled).toBe(true)
  })

  it('openStream rechaza sin canal, si el Mac lo niega y al cancelar con AbortSignal', async () => {
    const { link, hub } = setup()
    link.set('offline')
    await expect(hub.openStream('main', { onEvent: () => undefined, onReset: () => undefined, onEnd: () => undefined })).rejects.toThrow(
      'offline'
    )
    link.set('online')
    const denied = hub.openStream('main', { onEvent: () => undefined, onReset: () => undefined, onEnd: () => undefined })
    link.end(link.live('main')!, 'forbidden')
    await expect(denied).rejects.toThrow('forbidden')
    const ac = new AbortController()
    const aborted = hub.openStream('main', { onEvent: () => undefined, onReset: () => undefined, onEnd: () => undefined }, ac.signal)
    ac.abort()
    await expect(aborted).rejects.toThrow('aborted')
    expect(hub.size).toBe(0)
  })

  it('sin suscripción posible (subscribe devuelve null) el stream falla en vez de colgarse', async () => {
    const { link, hub } = setup()
    link.canSubscribe = false
    await expect(hub.openStream('main', { onEvent: () => undefined, onReset: () => undefined, onEnd: () => undefined })).rejects.toThrow(
      'offline'
    )
  })

  it('un oyente que lanza no corta a los demás', () => {
    const { link, hub } = setup()
    const got: unknown[] = []
    hub.onChannel('a', () => {
      throw new Error('boom')
    })
    hub.onChannel('a', (p) => got.push(p))
    link.live('main')!.h.onReady?.(0)
    link.live('main')!.h.onEvent({ seq: 1, ch: 'a', p: 'ok' })
    expect(got).toEqual(['ok'])
  })
})
