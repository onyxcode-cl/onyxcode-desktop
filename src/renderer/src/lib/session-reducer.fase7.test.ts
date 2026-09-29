/**
 * Fase 7 · G3: correcciones del reductor común (F7-B12, F7-B13, F7-B15). Puras, sin Zustand.
 */
import { describe, expect, it } from 'vitest'
import type { OcEvent } from './opencode'
import {
  appendWithoutOverlap,
  createBuffers,
  createLoadTracker,
  mergeSnapshot,
  reduceEvent,
  runStatusScope,
  type ConvSlice,
  type MessageEntry
} from './session-reducer'
import { assistantMessage, makeSession, partDelta, partUpdated, resetEventIds, textPart, userMessage } from '../../../test/fixtures/events'

const D = '/proj'
const empty = (): ConvSlice => ({ messages: {}, status: {}, errors: {}, sessions: { s: makeSession('s', D) } })
const opt = { accept: () => true, dedupe: false }
const ev = (type: string, properties: unknown): OcEvent => ({ id: `evt_${Math.random()}`, type, properties }) as unknown as OcEvent
const text = (s: ConvSlice, sid = 's'): string => (s.messages[sid][0].parts[0] as { text: string }).text

describe('F7-B12: message.updated aplica los deltas huérfanos a las partes huérfanas que adopta', () => {
  it('part.updated (mensaje desconocido) → delta → message.updated', () => {
    resetEventIds()
    const b = createBuffers()
    let s = empty()
    s = reduceEvent(s, partUpdated(textPart('p1', 'm1', 's', 'Hola'), D).event, b, opt).slice
    s = reduceEvent(s, partDelta({ sessionID: 's', messageID: 'm1', partID: 'p1', delta: ' mundo' }, D).event, b, opt).slice
    s = reduceEvent(s, ev('message.updated', { info: assistantMessage('m1', 's') }), b, opt).slice
    expect(text(s)).toBe('Hola mundo')
    expect(b.orphanDeltas.size).toBe(0) // consumidos
  })
})

describe('F7-B13: borrados durante una carga no se resucitan al fusionar el snapshot', () => {
  const entry = (id: string, parts: MessageEntry['parts'] = []): MessageEntry => ({ info: userMessage(id, 's'), parts })

  it('message.removed durante la carga', () => {
    const b = createBuffers()
    const t = createLoadTracker()
    b.loading.set('s', t)
    let s: ConvSlice = { ...empty(), messages: { s: [entry('m1'), entry('m2')] } }
    s = reduceEvent(s, ev('message.removed', { sessionID: 's', messageID: 'm1' }), b, opt).slice
    const merged = mergeSnapshot([entry('m1'), entry('m2')], s.messages['s'], t)
    expect(merged.map((m) => m.info.id)).toEqual(['m2'])
  })

  it('message.part.removed durante la carga', () => {
    const b = createBuffers()
    const t = createLoadTracker()
    b.loading.set('s', t)
    const p1 = textPart('p1', 'm1', 's', 'a')
    const p2 = textPart('p2', 'm1', 's', 'b')
    let s: ConvSlice = { ...empty(), messages: { s: [entry('m1', [p1, p2])] } }
    s = reduceEvent(s, ev('message.part.removed', { sessionID: 's', messageID: 'm1', partID: 'p1' }), b, opt).slice
    const merged = mergeSnapshot([entry('m1', [p1, p2])], s.messages['s'], t)
    expect(merged[0].parts.map((p) => p.id)).toEqual(['p2'])
  })

  it('un mensaje borrado y vuelto a crear durante la carga sí se conserva', () => {
    const b = createBuffers()
    const t = createLoadTracker()
    b.loading.set('s', t)
    let s: ConvSlice = { ...empty(), messages: { s: [entry('m1')] } }
    s = reduceEvent(s, ev('message.removed', { sessionID: 's', messageID: 'm1' }), b, opt).slice
    s = reduceEvent(s, ev('message.updated', { info: userMessage('m1', 's') }), b, opt).slice
    expect(mergeSnapshot([entry('m1')], s.messages['s'], t).map((m) => m.info.id)).toEqual(['m1'])
  })

  it('sin carga en curso message.removed sigue funcionando igual', () => {
    const b = createBuffers()
    const s0: ConvSlice = { ...empty(), messages: { s: [entry('m1')] } }
    expect(reduceEvent(s0, ev('message.removed', { sessionID: 's', messageID: 'm1' }), b, opt).slice.messages['s']).toEqual([])
  })
})

describe('F7-B15: appendWithoutOverlap conserva su heurística (límite documentado)', () => {
  it('trozo repetido igual al final de la base: se interpreta como ya incluido (ambiguo, se pierde el «\\n»)', () => {
    expect(appendWithoutOverlap('text\n', ['\n', 'Next'])).toBe('text\nNext')
  })
  it('un trozo de un carácter repetido idéntico al final de la base se descarta', () => {
    expect(appendWithoutOverlap('aa', ['a'])).toBe('aa')
  })
  it('con un trozo distinto delante del repetido, se añade todo', () => {
    expect(appendWithoutOverlap('aa', ['b', 'a'])).toBe('aaba')
  })
})

describe('F7-B10: runStatusScope', () => {
  const sess = (id: string, dir = D): ReturnType<typeof makeSession> => makeSession(id, dir)
  const isMain = (src: string): boolean => src === 'main'
  it('incluye sesiones del directorio y origen, y claves de status sin sesión con origen válido', () => {
    const scope = runStatusScope(
      {
        sessions: { a: sess('a'), b: sess('b', '/otro'), c: sess('c') },
        sessionSource: { c: 'http://x' },
        status: { a: 'busy', orphan: 'busy', orphanX: 'busy', b: 'busy' }
      },
      D,
      isMain
    )
    expect(scope.sort()).toEqual(['a', 'orphan', 'orphanX'])
  })
  it('un huérfano con origen de otro servidor queda fuera', () => {
    const scope = runStatusScope({ sessions: {}, sessionSource: { gone: 'http://x' }, status: { gone: 'busy' } }, D, isMain)
    expect(scope).toEqual([])
  })
})
