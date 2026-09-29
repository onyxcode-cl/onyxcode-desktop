import { describe, expect, it } from 'vitest'
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  resetEventIds,
  textPart,
  userMessage
} from '../../../test/fixtures/events'
import {
  createBuffers,
  evictMessages,
  forgetOrphansOf,
  markSeen,
  pickEvictions,
  pinClosure,
  reconcileRunStatus,
  ORPHAN_MAX_KEYS,
  ORPHAN_TTL_MS,
  reduceEvent,
  selectSessionsForDirectory,
  type ConvSlice,
  type Effect
} from './session-reducer'

const empty = (): ConvSlice => ({ messages: {}, status: {}, errors: {}, sessions: {} })
const open = { accept: () => true, dedupe: false }
type Ev = Parameters<typeof reduceEvent>[1]
const status = (sessionID: string, type: string, id?: string): Ev =>
  ({ id, type: 'session.status', properties: { sessionID, status: { type } } }) as unknown as Ev

describe('reduceEvent', () => {
  it('devuelve la misma referencia si no hay cambio', () => {
    resetEventIds()
    const b = createBuffers()
    const s = empty()
    // evento desconocido
    expect(reduceEvent(s, { type: 'todo.updated', properties: {} } as unknown as Ev, b, open).slice).toBe(s)
    // delta sobre un mensaje inexistente
    expect(
      reduceEvent(s, partDelta({ sessionID: 'ses', messageID: 'msg_1', partID: 'prt_1', delta: 'x' }, '/d').event, b, open).slice
    ).toBe(s)
    // parte huérfana: no toca el slice, se encola en los buffers
    const r = reduceEvent(s, partUpdated(textPart('prt_1', 'msg_1', 'ses', 'a'), '/d').event, b, open)
    expect(r.slice).toBe(s)
    expect(b.orphanParts.get('msg_1')).toHaveLength(1)
    // ...y se adopta al llegar el mensaje
    const r2 = reduceEvent(s, msgUpdated(userMessage('msg_1', 'ses'), '/d').event, b, open)
    expect(r2.slice).not.toBe(s)
    expect(r2.slice.messages['ses'][0].parts).toHaveLength(1)
    expect(b.orphanParts.has('msg_1')).toBe(false)
  })

  it('emite became-idle solo en la transición busy→idle', () => {
    const b = createBuffers()
    let s = empty()
    const step = (ev: Ev): Effect[] => {
      const r = reduceEvent(s, ev, b, open)
      s = r.slice
      return r.effects
    }
    expect(step(status('s1', 'busy'))).toEqual([])
    expect(step(status('s1', 'idle'))).toEqual([{ type: 'became-idle', sessionID: 's1', prev: 'busy' }])
    expect(s.status['s1']).toBe('idle')
    expect(step(status('s1', 'idle'))).toEqual([])
  })

  it('accept=false no muta ni encola', () => {
    const b = createBuffers()
    const s = empty()
    const no = { accept: () => false, dedupe: false }
    for (const ev of [
      status('s1', 'busy'),
      msgUpdated(assistantMessage('msg_1', 's1'), '/d').event,
      partUpdated(textPart('prt_1', 'msg_1', 's1', 'a'), '/d').event
    ]) {
      const r = reduceEvent(s, ev, b, no)
      expect(r.slice).toBe(s)
      expect(r.effects).toEqual([])
    }
    expect(s).toEqual(empty())
    expect(b.orphanParts.size).toBe(0)
  })

  it('dedupe descarta ids ya vistos', () => {
    const b = createBuffers()
    const dd = { accept: () => true, dedupe: true }
    const first = reduceEvent(empty(), status('s1', 'busy', 'e1'), b, dd)
    expect(first.slice.status['s1']).toBe('busy')
    const s = empty()
    expect(reduceEvent(s, status('s1', 'busy', 'e1'), b, dd).slice).toBe(s)
  })
})

describe('buffers', () => {
  it('son independientes entre instancias', () => {
    const a = createBuffers()
    const b = createBuffers()
    reduceEvent(empty(), partUpdated(textPart('prt_1', 'msg_1', 'ses', 'a'), '/d').event, a, open)
    expect(a.orphanParts.size).toBe(1)
    expect(b.orphanParts.size).toBe(0)
    expect(markSeen(a.seen, 'x')).toBe(true)
    expect(markSeen(b.seen, 'x')).toBe(true)
    expect(markSeen(a.seen, 'x')).toBe(false)
  })

  it('seen expulsa los 500 más antiguos al pasar seenMax', () => {
    const b = createBuffers({ seenMax: 3 })
    for (const id of ['a', 'b', 'c', 'd']) markSeen(b.seen, id)
    expect(b.seen.order).toEqual([])
    expect(markSeen(b.seen, 'a')).toBe(true)
  })
})

describe('selectSessionsForDirectory (pura)', () => {
  // F6-B10: el resultado dependía de useSessions.getState() y las listas memoizadas por
  // `sessions` no se refrescaban al cambiar solo directorySource/sessionSource.
  it('cambia el resultado si solo cambia directorySource o sessionSource', () => {
    const D = '/proj'
    const main = makeSession('main', D)
    const cw = makeSession('cw', D)
    const sessions = { main, cw }
    const sessionSource: Record<string, string> = { cw: 'http://cw' }
    const ids = (directorySource: Record<string, string>, src = sessionSource): string[] =>
      selectSessionsForDirectory({ sessions, sessionSource: src, directorySource }, D).map((s) => s.id)
    expect(ids({})).toEqual(['main'])
    expect(ids({ [D]: 'http://cw' })).toEqual(['cw'])
    expect(ids({}, {}).sort()).toEqual(['cw', 'main'])
  })
})

describe('deltas huérfanos (F6-B2)', () => {
  const text = (s: ConvSlice, sid = 'ses'): string => (s.messages[sid][0].parts[0] as { text: string }).text
  const withMessage = (b: ReturnType<typeof createBuffers>): ConvSlice =>
    reduceEvent(empty(), msgUpdated(assistantMessage('msg_1', 'ses'), '/d').event, b, open).slice
  const delta = (partID: string, d: string): Ev => partDelta({ sessionID: 'ses', messageID: 'msg_1', partID, delta: d }, '/d').event

  it('un delta antes de part.updated no se pierde', () => {
    const b = createBuffers()
    let s = withMessage(b)
    s = reduceEvent(s, delta('prt_1', 'Ho'), b, open).slice
    s = reduceEvent(s, delta('prt_1', 'la'), b, open).slice
    s = reduceEvent(s, partUpdated(textPart('prt_1', 'msg_1', 'ses', ''), '/d').event, b, open).slice
    expect(text(s)).toBe('Hola')
    expect(b.orphanDeltas.size).toBe(0)
  })

  it('si part.updated ya incluye el delta, no se duplica', () => {
    const b = createBuffers()
    let s = withMessage(b)
    s = reduceEvent(s, delta('prt_1', 'Ho'), b, open).slice
    s = reduceEvent(s, delta('prt_1', 'la'), b, open).slice
    s = reduceEvent(s, partUpdated(textPart('prt_1', 'msg_1', 'ses', 'Hola'), '/d').event, b, open).slice
    expect(text(s)).toBe('Hola')
    // con solo el primer trozo incluido, añade el resto
    const b2 = createBuffers()
    let s2 = withMessage(b2)
    s2 = reduceEvent(s2, delta('prt_1', 'Ho'), b2, open).slice
    s2 = reduceEvent(s2, delta('prt_1', 'la'), b2, open).slice
    s2 = reduceEvent(s2, partUpdated(textPart('prt_1', 'msg_1', 'ses', 'Ho'), '/d').event, b2, open).slice
    expect(text(s2)).toBe('Hola')
  })

  it('el delta llega antes que el mensaje y la parte: se aplica cuando aparece la parte', () => {
    const b = createBuffers()
    let s = empty()
    s = reduceEvent(s, delta('prt_1', 'xy'), b, open).slice
    s = reduceEvent(s, msgUpdated(assistantMessage('msg_1', 'ses'), '/d').event, b, open).slice
    s = reduceEvent(s, partUpdated(textPart('prt_1', 'msg_1', 'ses', ''), '/d').event, b, open).slice
    expect(text(s)).toBe('xy')
  })

  it('los huérfanos caducan por TTL', () => {
    let t = 1_000
    const b = createBuffers({ now: () => t })
    let s = withMessage(b)
    s = reduceEvent(s, delta('prt_1', 'viejo'), b, open).slice
    t += ORPHAN_TTL_MS + 1
    s = reduceEvent(s, partUpdated(textPart('prt_1', 'msg_1', 'ses', ''), '/d').event, b, open).slice
    expect(text(s)).toBe('')
    expect(b.orphanDeltas.size).toBe(0)
    // partes huérfanas: también caducan
    reduceEvent(empty(), partUpdated(textPart('prt_2', 'msg_9', 'ses', 'a'), '/d').event, b, open)
    expect(b.orphanParts.has('msg_9')).toBe(true)
    t += ORPHAN_TTL_MS + 1
    const r = reduceEvent(empty(), msgUpdated(assistantMessage('msg_9', 'ses'), '/d').event, b, open)
    expect(r.slice.messages['ses'][0].parts).toEqual([])
  })

  it('tope de claves: se descartan las más antiguas', () => {
    const b = createBuffers()
    const s = withMessage(b)
    for (let i = 0; i < ORPHAN_MAX_KEYS + 20; i++) reduceEvent(s, delta(`prt_${i}`, 'x'), b, open)
    expect(b.orphanDeltas.size).toBe(ORPHAN_MAX_KEYS)
    expect(b.orphanDeltas.has('prt_0\u0000text')).toBe(false)
    expect(b.orphanDeltas.has(`prt_${ORPHAN_MAX_KEYS + 19}\u0000text`)).toBe(true)
    for (let i = 0; i < ORPHAN_MAX_KEYS + 20; i++) {
      reduceEvent(empty(), partUpdated(textPart('p', `m_${i}`, 'ses', 'a'), '/d').event, b, open)
    }
    expect(b.orphanParts.size).toBe(ORPHAN_MAX_KEYS)
    expect(b.orphanAt.parts.size).toBe(ORPHAN_MAX_KEYS)
  })
})

describe('reconcileRunStatus (F6-B5)', () => {
  it('ausente del servidor -> idle; busy/retry -> se aplica', () => {
    const next = reconcileRunStatus({ a: 'busy', b: 'idle', c: 'retry' }, { b: { type: 'busy' }, c: { type: 'retry' } }, ['a', 'b', 'c'])
    expect(next).toEqual({ a: 'idle', b: 'busy', c: 'retry' })
  })
  it('fuera de ámbito queda intacto', () => {
    const next = reconcileRunStatus({ a: 'busy', out: 'busy' }, {}, ['a'])
    expect(next).toEqual({ a: 'idle', out: 'busy' })
  })
  it('null si no hay cambio (y no muta la entrada)', () => {
    const cur = { a: 'busy' as const, b: 'idle' as const }
    expect(reconcileRunStatus(cur, { a: { type: 'busy' } }, ['a', 'b', 'nueva'])).toBeNull()
    expect(reconcileRunStatus({}, {}, ['a'])).toBeNull()
    const changed = reconcileRunStatus(cur, {}, ['a'])
    expect(changed).toEqual({ a: 'idle', b: 'idle' })
    expect(cur.a).toBe('busy')
  })
})

describe('LRU de messages: primitivas puras', () => {
  const pin = (...ids: string[]): Set<string> => new Set(ids)
  const empty = { candidates: [] as string[], pinned: new Set<string>(), lastAccess: new Map<string, number>(), max: 2 }

  it('pickEvictions: no desaloja si hay ≤ max', () => {
    expect(pickEvictions({ ...empty, candidates: ['a', 'b'], max: 2 })).toEqual([])
    expect(pickEvictions({ ...empty, candidates: [], max: 0 })).toEqual([])
  })
  it('pickEvictions: primero las nunca accedidas', () => {
    const lastAccess = new Map([
      ['a', 5],
      ['c', 9]
    ])
    expect(pickEvictions({ ...empty, candidates: ['a', 'b', 'c'], lastAccess, max: 2 })).toEqual(['b'])
  })
  it('pickEvictions: orden por lastAccess ascendente', () => {
    const lastAccess = new Map([
      ['a', 30],
      ['b', 10],
      ['c', 20],
      ['d', 40]
    ])
    expect(pickEvictions({ ...empty, candidates: ['a', 'b', 'c', 'd'], lastAccess, max: 1 })).toEqual(['b', 'c', 'a'])
  })
  it('pickEvictions: nunca devuelve fijadas y el tope cuenta solo las no fijadas', () => {
    const lastAccess = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
    expect(pickEvictions({ ...empty, candidates: ['a', 'b', 'c'], pinned: pin('a'), lastAccess, max: 1 })).toEqual(['b'])
    expect(pickEvictions({ ...empty, candidates: ['a', 'b', 'c'], pinned: pin('a', 'b', 'c'), max: 0 })).toEqual([])
  })
  it('evictMessages: misma referencia sin ids o sin coincidencias', () => {
    const s = { messages: { a: [] }, loaded: { a: true }, loadingMessages: {} }
    expect(evictMessages(s, [])).toBe(s)
    expect(evictMessages(s, ['zzz'])).toBe(s)
  })
  it('evictMessages: limpia messages, loaded y loadingMessages juntos y no muta el original', () => {
    const s = { messages: { a: [], b: [] }, loaded: { a: true, b: true }, loadingMessages: { a: false } }
    const r = evictMessages(s, ['a'])
    expect(r).not.toBe(s)
    expect(Object.keys(r.messages)).toEqual(['b'])
    expect(r.loaded).toEqual({ b: true })
    expect(r.loadingMessages).toEqual({})
    expect(Object.keys(s.messages)).toEqual(['a', 'b'])
  })
  it('forgetOrphansOf: filtra por part.sessionID y conserva el resto', () => {
    const b = createBuffers()
    b.orphanParts.set('m1', [textPart('p1', 'm1', 'sA', 'x')])
    b.orphanAt.parts.set('m1', 1)
    b.orphanParts.set('m2', [textPart('p2', 'm2', 'sA', 'x'), textPart('p3', 'm2', 'sB', 'y')])
    b.orphanAt.parts.set('m2', 1)
    b.orphanParts.set('m3', [textPart('p4', 'm3', 'sB', 'z')])
    forgetOrphansOf(b, new Set(['sA']))
    expect(b.orphanParts.has('m1')).toBe(false)
    expect(b.orphanAt.parts.has('m1')).toBe(false)
    expect(b.orphanParts.get('m2')?.map((p) => p.id)).toEqual(['p3'])
    expect(b.orphanParts.get('m3')).toHaveLength(1)
  })
  it('pinClosure: incluye raíz e hijas de las fijadas y no a las demás', () => {
    const sessions = {
      root: makeSession('root', '/d'),
      kid: makeSession('kid', '/d', { parentID: 'root' }),
      grandkid: makeSession('grandkid', '/d', { parentID: 'kid' }),
      sibling: makeSession('sibling', '/d', { parentID: 'root' }),
      other: makeSession('other', '/d')
    }
    expect([...pinClosure(sessions, ['kid'])].sort()).toEqual(['grandkid', 'kid', 'root'])
    expect([...pinClosure(sessions, ['root'])].sort()).toEqual(['grandkid', 'kid', 'root', 'sibling'])
    expect([...pinClosure(sessions, ['other'])]).toEqual(['other'])
  })
})
