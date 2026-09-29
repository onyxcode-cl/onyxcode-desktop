/**
 * Tests de caracterización de `stores/sessions.ts` (Fase 6.0): congelan el comportamiento ACTUAL,
 * incluidos los bugs conocidos (marcados `F6-B<n>`), antes de extraer el reductor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import type { OpencodeClient } from '../lib/opencode'
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  resetEventIds,
  sessionCreated,
  sessionDeleted,
  textPart,
  userMessage
} from '../../../test/fixtures/events'

type Mod = typeof import('./sessions')
let m: Mod
const D = '/proj'

beforeEach(async () => {
  vi.resetModules() // orphanParts/loading son estado de módulo: un store limpio por test
  resetEventIds()
  m = await import('./sessions')
})

const st = (): ReturnType<Mod['useSessions']['getState']> => m.useSessions.getState()
const apply = (te: { event: Parameters<ReturnType<Mod['useSessions']['getState']>['applyEvent']>[0] }, source?: string): void =>
  st().applyEvent(te.event, source)

function fakeClient(over: {
  list?: () => Promise<{ data: Session[] }>
  messages?: () => Promise<{ data: { info: unknown; parts: unknown[] }[] }>
}): OpencodeClient {
  return { session: { list: over.list, messages: over.messages } } as unknown as OpencodeClient
}

/** Promesa controlable a mano. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('upsertSorted', () => {
  it('inserta al final si ya está ordenado', () => {
    expect(m.upsertSorted([{ id: 'a' }, { id: 'b' }], { id: 'c' }).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('inserta ordenado si llega fuera de orden', () => {
    expect(m.upsertSorted([{ id: 'a' }, { id: 'c' }], { id: 'b' }).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('reemplaza por id sin mutar la lista original', () => {
    const list = [
      { id: 'a', v: 1 },
      { id: 'b', v: 1 }
    ]
    const next = m.upsertSorted(list, { id: 'a', v: 2 })
    expect(next).toEqual([
      { id: 'a', v: 2 },
      { id: 'b', v: 1 }
    ])
    expect(list[0].v).toBe(1)
  })
})

describe('appendWithoutOverlap', () => {
  it('sin solape: concatena todos los trozos', () => {
    expect(m.appendWithoutOverlap('Hola', [' mundo', '!'])).toBe('Hola mundo!')
  })
  it('solape total: el snapshot ya incluía todos los trozos', () => {
    expect(m.appendWithoutOverlap('Hola mundo', [' mun', 'do'])).toBe('Hola mundo')
  })
  it('solape parcial en frontera de trozo: solo añade el resto', () => {
    expect(m.appendWithoutOverlap('xa', ['a', 'b'])).toBe('xab')
  })
  it('no se come coincidencias casuales dentro de un trozo', () => {
    expect(m.appendWithoutOverlap('x a', ['a b'])).toBe('x aa b')
  })
  it('sin trozos devuelve la base', () => {
    expect(m.appendWithoutOverlap('base', [])).toBe('base')
  })
})

describe('applyEvent: mensajes y partes', () => {
  it('message.updated adopta las partes huérfanas que llegaron antes', () => {
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', 'hola'), D))
    expect(st().messages['s1']).toBeUndefined()
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    expect(st().messages['s1'][0].parts.map((p) => p.id)).toEqual(['prt_1'])
  })

  it('mantiene los mensajes ordenados por id', () => {
    apply(msgUpdated(userMessage('msg_2', 's1'), D))
    apply(msgUpdated(userMessage('msg_1', 's1'), D))
    expect(st().messages['s1'].map((e) => e.info.id)).toEqual(['msg_1', 'msg_2'])
  })

  it('message.part.delta acumula texto sobre una parte existente', () => {
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', ''), D))
    apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'ho' }, D))
    apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'la' }, D))
    expect((st().messages['s1'][0].parts[0] as { text: string }).text).toBe('hola')
  })

  it('F6-B2: message.part.delta sobre una parte inexistente no se pierde: se aplica al llegar su part.updated', () => {
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_x', delta: 'guardado' }, D))
    expect(st().messages['s1'][0].parts).toEqual([]) // sigue sin parte: el delta espera en el buffer
    apply(partUpdated(textPart('prt_x', 'msg_2', 's1', ''), D))
    expect((st().messages['s1'][0].parts[0] as { text: string }).text).toBe('guardado')
  })

  it('F6-B3: un delta repetido con el mismo event.id se aplica una sola vez', () => {
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', ''), D))
    const d = partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'ab' }, D, 'evt_dup')
    apply(d)
    apply(d)
    expect((st().messages['s1'][0].parts[0] as { text: string }).text).toBe('ab')
  })

  it('F6-B3: el mismo event.id en otro origen sí se aplica', () => {
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', ''), D))
    const d = partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'ab' }, D, 'evt_dup')
    apply(d)
    apply(d, 'http://cw')
    apply(d, 'http://cw') // repetido dentro del mismo origen: no
    // main una vez + cw una vez (el store comparte `messages`); el repetido de cw se descarta
    expect((st().messages['s1'][0].parts[0] as { text: string }).text).toBe('ab'.repeat(2))
  })
})

describe('loadMessages: snapshot + stream en vuelo', () => {
  it('fusiona sin retroceso ni duplicado y conserva mensajes creados durante la carga', async () => {
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', ''), D))
    const d = deferred<{ data: { info: unknown; parts: unknown[] }[] }>()
    const load = st().loadMessages(fakeClient({ messages: () => d.promise }), 's1', D)
    // durante la carga llegan dos deltas y un mensaje nuevo
    apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'Hel' }, D))
    apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'lo' }, D))
    apply(msgUpdated(userMessage('msg_3', 's1'), D))
    expect(st().loadingMessages['s1']).toBe(true)
    // el snapshot ya incluía el primer delta
    d.resolve({
      data: [{ info: assistantMessage('msg_2', 's1'), parts: [textPart('prt_1', 'msg_2', 's1', 'Hel')] }]
    })
    await load
    const list = st().messages['s1']
    expect(list.map((e) => e.info.id)).toEqual(['msg_2', 'msg_3'])
    expect((list[0].parts[0] as { text: string }).text).toBe('Hello')
    expect(st().loadingMessages['s1']).toBe(false)
  })

  it('sin eventos en vuelo, el snapshot reemplaza y ordena', async () => {
    const client = fakeClient({
      messages: () =>
        Promise.resolve({
          data: [
            { info: userMessage('msg_2', 's1'), parts: [textPart('prt_b', 'msg_2', 's1', 'b'), textPart('prt_a', 'msg_2', 's1', 'a')] },
            { info: userMessage('msg_1', 's1'), parts: [] }
          ]
        })
    })
    await st().loadMessages(client, 's1', D)
    expect(st().messages['s1'].map((e) => e.info.id)).toEqual(['msg_1', 'msg_2'])
    expect(st().messages['s1'][1].parts.map((p) => p.id)).toEqual(['prt_a', 'prt_b'])
  })

  it('si falla, lanza y apaga loadingMessages', async () => {
    const client = fakeClient({ messages: () => Promise.resolve({ data: undefined as never, error: { message: 'boom' } } as never) })
    await expect(st().loadMessages(client, 's1', D)).rejects.toThrow()
    expect(st().loadingMessages['s1']).toBe(false)
  })
})

describe('loadSessions / origen', () => {
  const list =
    (...s: Session[]) =>
    (): Promise<{ data: Session[] }> =>
      Promise.resolve({ data: s })

  it('reemplaza solo las sesiones del origen dado en ese directorio', async () => {
    st().upsertSession(makeSession('a', D), 'main')
    st().upsertSession(makeSession('b', D), 'http://cw')
    await st().loadSessions(fakeClient({ list: list(makeSession('c', D)) }), D)
    expect(Object.keys(st().sessions).sort()).toEqual(['b', 'c'])
    await st().loadSessions(fakeClient({ list: list() }), D, 'http://cw')
    expect(Object.keys(st().sessions)).toEqual(['c'])
    // estado actual: loadSessions no limpia sessionSource de las sesiones que borra (entrada residual)
    expect(st().sessionSource).toEqual({ b: 'http://cw' })
  })

  it('no toca sesiones de otros directorios', async () => {
    st().upsertSession(makeSession('other', '/otro'), 'main')
    await st().loadSessions(fakeClient({ list: list(makeSession('c', D)) }), D)
    expect(Object.keys(st().sessions).sort()).toEqual(['c', 'other'])
  })

  it('F6-B4: conserva las sesiones hijas cuya raíz sigue en la lista (roots:true no las incluye)', async () => {
    st().upsertSession(makeSession('root', D))
    st().upsertSession(makeSession('child', D, { parentID: 'root' }))
    st().upsertSession(makeSession('grand', D, { parentID: 'child' }))
    apply(msgUpdated(assistantMessage('msg_1', 'child'), D))
    await st().loadSessions(fakeClient({ list: list(makeSession('root', D)) }), D)
    expect(Object.keys(st().sessions).sort()).toEqual(['child', 'grand', 'root'])
    // los mensajes del subagente siguen entrando
    apply(partUpdated(textPart('prt_1', 'msg_1', 'child', 'hola'), D))
    expect(st().messages['child'][0].parts).toHaveLength(1)
  })

  it('F6-B4: una hija cuya raíz ya no está en la lista sí se elimina', async () => {
    st().upsertSession(makeSession('gone', D))
    st().upsertSession(makeSession('child', D, { parentID: 'gone' }))
    await st().loadSessions(fakeClient({ list: list(makeSession('root', D)) }), D)
    expect(Object.keys(st().sessions)).toEqual(['root'])
  })

  it('session.deleted de otro origen no borra', () => {
    apply(sessionCreated(makeSession('x', D)), 'http://cw')
    apply(sessionDeleted(makeSession('x', D)), 'main')
    expect(st().sessions['x']).toBeDefined()
    apply(sessionDeleted(makeSession('x', D)), 'http://cw')
    expect(st().sessions['x']).toBeUndefined()
  })

  it('upsertSession sin origen usa el conocido, luego el del directorio, luego main', () => {
    st().setDirectorySource(D, 'http://cw')
    st().upsertSession(makeSession('n', D))
    expect(st().sessionSource['n']).toBe('http://cw')
    st().upsertSession(makeSession('n', D), 'main')
    expect(st().sessionSource['n']).toBeUndefined()
    st().upsertSession(makeSession('n', D))
    // main no queda registrado (ausente), así que sin origen vuelve a mandar el del directorio
    expect(st().sessionSource['n']).toBe('http://cw')
  })
})

describe('selectSessionsForDirectory', () => {
  it('filtra por origen visible, archivadas, hijas y directorio; ordena por updated desc', () => {
    const t = (updated: number, extra: Partial<Session['time']> = {}): Session['time'] => ({ created: 1, updated, ...extra })
    st().upsertSession(makeSession('old', D, { time: t(10) }))
    st().upsertSession(makeSession('new', D, { time: t(20) }))
    st().upsertSession(makeSession('child', D, { parentID: 'new', time: t(30) }))
    st().upsertSession(makeSession('arch', D, { time: t(40, { archived: 5 }) }))
    st().upsertSession(makeSession('unarch', D, { time: t(50, { archived: 5 }), metadata: { unarchivedAt: 6 } }))
    st().upsertSession(makeSession('cw', D, { time: t(60) }), 'http://cw')
    st().upsertSession(makeSession('elsewhere', '/otro', { time: t(70) }))
    const ids = (): string[] => m.selectSessionsForDirectory(st().sessions, D).map((s) => s.id)
    expect(ids()).toEqual(['unarch', 'new', 'old'])
    st().setDirectorySource(D, 'http://cw')
    expect(ids()).toEqual(['cw'])
  })
})

describe('applyEvent sin origen (estado actual, 6a)', () => {
  it('escribe los mensajes de sesiones de Code en useSessions (no filtra por directorio)', () => {
    // sesión que en la app pertenece a Code: el store genérico igual la acumula
    apply(msgUpdated(userMessage('msg_1', 'ses_code'), '/work/code'))
    apply(partUpdated(textPart('prt_1', 'msg_1', 'ses_code', 'hola'), '/work/code'))
    expect(st().messages['ses_code'][0].parts).toHaveLength(1)
    expect(st().sessions['ses_code']).toBeUndefined()
  })

  it('session.status/idle/error actualizan status y errors', () => {
    st().applyEvent({ id: 'e1', type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } } as never)
    expect(st().status['s1']).toBe('busy')
    st().applyEvent({ id: 'e2', type: 'session.idle', properties: { sessionID: 's1' } } as never)
    expect(st().status['s1']).toBe('idle')
    st().applyEvent({
      id: 'e3',
      type: 'session.error',
      properties: { sessionID: 's1', error: { name: 'UnknownError', data: { message: 'x' } } }
    } as never)
    expect(st().errors['s1']).toBeTruthy()
    st().applyEvent({
      id: 'e4',
      type: 'session.error',
      properties: { sessionID: 's2', error: { name: 'MessageAbortedError', data: { message: 'x' } } }
    } as never)
    expect(st().errors['s2']).toBeUndefined()
  })
})
