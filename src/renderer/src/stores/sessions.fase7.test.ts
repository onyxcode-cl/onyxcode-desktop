/**
 * Fase 7 · G3: correcciones de `stores/sessions.ts` (F7-B10..B14, B19). Un store limpio por test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../lib/opencode'
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  resetEventIds,
  sessionDeleted,
  statusBusy,
  textPart,
  userMessage
} from '../../../test/fixtures/events'

type Mod = typeof import('./sessions')
let m: Mod
const D = '/proj'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  m = await import('./sessions')
})

const st = (): ReturnType<Mod['useSessions']['getState']> => m.useSessions.getState()
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}
const clientWith = (messages: () => Promise<unknown>): OpencodeClient => ({ session: { messages } }) as unknown as OpencodeClient

describe('F7-B12: deltas entre part.updated y message.updated (integración con el store)', () => {
  it('part.updated → delta → message.updated conserva el delta', () => {
    st().upsertSession(makeSession('s', D))
    st().applyEvent(partUpdated(textPart('p1', 'm1', 's', 'Hola'), D).event)
    st().applyEvent(partDelta({ sessionID: 's', messageID: 'm1', partID: 'p1', delta: ' mundo' }, D).event)
    st().applyEvent(msgUpdated(assistantMessage('m1', 's'), D).event)
    expect((st().messages['s'][0].parts[0] as { text: string }).text).toBe('Hola mundo')
  })
})

describe('F7-B11: cargas concurrentes de loadMessages', () => {
  it('la segunda llamada reutiliza la carga en vuelo (una sola petición) y no pierde lo del stream', async () => {
    st().upsertSession(makeSession('s', D))
    const d = deferred<unknown>()
    const messages = vi.fn(() => d.promise)
    const client = clientWith(messages)
    const l1 = st().loadMessages(client, 's', D)
    const l2 = st().loadMessages(client, 's', D)
    st().applyEvent(msgUpdated(userMessage('m9', 's'), D).event) // llega durante la carga
    d.resolve({ data: [] })
    await Promise.all([l1, l2])
    expect(messages).toHaveBeenCalledTimes(1)
    expect(st().messages['s'].map((e) => e.info.id)).toEqual(['m9'])
    expect(st().loadingMessages['s']).toBe(false)
    expect(st().loaded['s']).toBe(true)
  })

  it('una carga posterior a la terminada vuelve a pedir el snapshot', async () => {
    st().upsertSession(makeSession('s', D))
    const messages = vi.fn(() => Promise.resolve({ data: [] }))
    const client = clientWith(messages)
    await st().loadMessages(client, 's', D)
    await st().loadMessages(client, 's', D)
    expect(messages).toHaveBeenCalledTimes(2)
  })

  it('si la carga falla, los que esperaban reciben el error y luego se puede reintentar', async () => {
    st().upsertSession(makeSession('s', D))
    const d = deferred<unknown>()
    const messages = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue({ data: [] })
    const client = clientWith(messages)
    const l1 = st().loadMessages(client, 's', D)
    const l2 = st().loadMessages(client, 's', D)
    d.resolve({ error: 'boom' })
    await expect(l1).rejects.toThrow()
    await expect(l2).rejects.toThrow()
    expect(st().loadingMessages['s']).toBe(false)
    await st().loadMessages(client, 's', D)
    expect(st().loaded['s']).toBe(true)
  })
})

describe('F7-B10: removeSession / session.deleted no dejan estado de la sesión', () => {
  it('session.deleted borra status, errors y loadingMessages', () => {
    st().upsertSession(makeSession('s', D))
    st().applyEvent(statusBusy('s', D).event)
    st().setError('s', 'x')
    st().applyEvent(sessionDeleted(makeSession('s', D), D).event)
    expect(st().status['s']).toBeUndefined()
    expect(st().errors['s']).toBeUndefined()
    expect(st().loadingMessages['s']).toBeUndefined()
    expect(st().sessions['s']).toBeUndefined()
  })

  it('borrar durante una carga en vuelo no resucita la sesión ni su loadingMessages', async () => {
    st().upsertSession(makeSession('s', D))
    const d = deferred<unknown>()
    const load = st().loadMessages(
      clientWith(() => d.promise),
      's',
      D
    )
    st().removeSession('s')
    d.resolve({ data: [{ info: userMessage('m1', 's'), parts: [] }] })
    await load
    expect(st().messages['s']).toBeUndefined()
    expect(st().loaded['s']).toBeUndefined()
    expect(st().loadingMessages['s']).toBeUndefined()
  })

  it('purgeSessionState equivale a removeSession (helper compartido para deleteTask de Tasks)', () => {
    st().upsertSession(makeSession('s', D), 'http://cw')
    st().applyEvent(statusBusy('s', D).event)
    st().setError('s', 'x')
    m.purgeSessionState('s')
    expect(st().sessions['s']).toBeUndefined()
    expect(st().sessionSource['s']).toBeUndefined()
    expect(st().status['s']).toBeUndefined()
    expect(st().errors['s']).toBeUndefined()
  })
})

describe('F7-B13: message.removed durante la carga (integración)', () => {
  it('un snapshot anterior al borrado no resucita el mensaje', async () => {
    st().upsertSession(makeSession('s', D))
    st().applyEvent(msgUpdated(userMessage('m1', 's'), D).event)
    const d = deferred<unknown>()
    const load = st().loadMessages(
      clientWith(() => d.promise),
      's',
      D
    )
    st().applyEvent({ id: 'evt_rm', type: 'message.removed', properties: { sessionID: 's', messageID: 'm1' } } as never)
    d.resolve({ data: [{ info: userMessage('m1', 's'), parts: [] }] })
    await load
    expect(st().messages['s'].map((e) => e.info.id)).toEqual([])
  })
})

describe('F7-B14: invalidateLoaded', () => {
  const seedLoaded = (id: string, source?: string): void => {
    st().upsertSession(makeSession(id, D), source)
    m.useSessions.setState((s) => ({ loaded: { ...s.loaded, [id]: true }, messages: { ...s.messages, [id]: [] } }))
  }

  it('marca loaded=false solo en el origen indicado y respeta `keep`; no toca messages', () => {
    seedLoaded('a')
    seedLoaded('b')
    seedLoaded('c', 'http://cw')
    st().invalidateLoaded((src) => src === m.MAIN_SOURCE, ['b'])
    expect(st().loaded).toEqual({ a: false, b: true, c: true })
    expect(Object.keys(st().messages).sort()).toEqual(['a', 'b', 'c'])
  })

  it('sin cambios no hace set (misma referencia)', () => {
    seedLoaded('a')
    st().invalidateLoaded((src) => src === m.MAIN_SOURCE, ['a'])
    const before = st().loaded
    st().invalidateLoaded((src) => src === m.MAIN_SOURCE, ['a'])
    expect(st().loaded).toBe(before)
  })
})

describe('F7-B19: robustez', () => {
  it('un listener de desalojo que lanza no rompe touchSession ni impide el desalojo', () => {
    localStorage.setItem('onyx.lru.max', '1')
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const id of ['a', 'b', 'c']) {
      st().upsertSession(makeSession(id, D))
      st().applyEvent(msgUpdated(userMessage(`m_${id}`, id), D).event)
      m.useSessions.setState((s) => ({ loaded: { ...s.loaded, [id]: true } }))
    }
    st().addEvictionListener(() => {
      throw new Error('listener roto')
    })
    const seen = vi.fn()
    st().addEvictionListener(seen)
    expect(() => st().touchSession('c')).not.toThrow()
    expect(Object.keys(st().messages).length).toBeLessThanOrEqual(1)
    expect(seen).toHaveBeenCalled() // el siguiente listener sigue avisándose
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('los buffers por origen están acotados (no crecen con cada reinicio de un servidor de Tasks)', () => {
    // Cada origen distinto recibe un evento (crea sus buffers); no hay API pública de tamaño: se comprueba que un
    // origen antiguo pierde su `seen` (dedupe) y el principal lo conserva.
    const ev = { id: 'evt_same', type: 'session.status', properties: { sessionID: 's', status: { type: 'busy' } } } as never
    st().applyEvent(ev) // principal
    for (let i = 0; i < 12; i++) st().applyEvent({ ...(ev as object), id: `evt_${i}` } as never, `http://cw${i}`)
    st().setStatus('s', 'idle')
    st().applyEvent(ev) // principal: sigue en `seen` → ignorado
    expect(st().status['s']).toBe('idle')
    st().setStatus('s', 'idle')
    st().applyEvent({ ...(ev as object), id: 'evt_0' } as never, 'http://cw0') // origen antiguo descartado: se reaplica
    expect(st().status['s']).toBe('busy')
  })
})
