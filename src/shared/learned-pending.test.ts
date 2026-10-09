import { describe, expect, it } from 'vitest'
import {
  ackDropped,
  buildPendingItem,
  collectRoutineProposals,
  discardAll,
  discardOne,
  enqueue,
  EMPTY_PENDING_STATE,
  normalizeForDedupe,
  resolvePart,
  type PendingLearnedState
} from './learned-pending'

const memBlock = (arr: unknown): string => '```lazunox-memoria\n' + JSON.stringify(arr) + '\n```'
const skillBlock = (obj: unknown): string => '```lazunox-skill\n' + JSON.stringify(obj) + '\n```'
const meta = { routineId: 'r1', routineName: 'Rutina diaria', runId: 'run1', folder: '/work/a' }

describe('normalizeForDedupe', () => {
  it('ignora mayúsculas, tildes y espacios de más', () => {
    expect(normalizeForDedupe('  Usa   Prettier  ')).toBe('usa prettier')
    expect(normalizeForDedupe('Días hábiles')).toBe('dias habiles')
  })
})

describe('collectRoutineProposals', () => {
  it('sin bloques: nada', () => {
    expect(collectRoutineProposals('listo, nada que proponer')).toEqual({})
  })

  it('con memoria y skill a la vez', () => {
    const text =
      memBlock([{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas' }]) +
      '\n' +
      skillBlock({ name: 'mi-skill', description: 'd', body: 'b' })
    const r = collectRoutineProposals(text)
    expect(r.proposals).toHaveLength(1)
    expect(r.skill?.name).toBe('mi-skill')
  })

  it('solo memoria: skill queda ausente (no undefined explícito con clave)', () => {
    const r = collectRoutineProposals(memBlock([{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }]))
    expect(r.proposals).toHaveLength(1)
    expect('skill' in r).toBe(false)
  })

  it('bloque de skill roto: no revienta, queda sin skill', () => {
    const r = collectRoutineProposals('```lazunox-skill\nno es json\n```')
    expect(r).toEqual({})
  })
})

describe('buildPendingItem', () => {
  it('sin nada que encolar: null', () => {
    expect(buildPendingItem({}, meta)).toBeNull()
  })

  it('arma el ítem con los metadatos y un id/fecha propios', () => {
    const item = buildPendingItem({ proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }] }, meta, () => 1000)
    expect(item).toMatchObject({ routineId: 'r1', routineName: 'Rutina diaria', runId: 'run1', folder: '/work/a', createdAt: 1000 })
    expect(typeof item?.id).toBe('string')
    expect(item?.id.length).toBeGreaterThan(0)
  })

  it('sessionId/messageId solo se agregan si vienen', () => {
    const sinExtra = buildPendingItem({ skill: { name: 'a', description: 'd', body: 'b' } }, meta)
    expect('sessionId' in (sinExtra ?? {})).toBe(false)
    const conExtra = buildPendingItem({ skill: { name: 'a', description: 'd', body: 'b' } }, { ...meta, sessionId: 's1', messageId: 'm1' })
    expect(conExtra).toMatchObject({ sessionId: 's1', messageId: 'm1' })
  })
})

describe('enqueue', () => {
  it('item null no cambia el estado', () => {
    expect(enqueue(EMPTY_PENDING_STATE, null)).toBe(EMPTY_PENDING_STATE)
  })

  it('agrega normalmente bajo el tope', () => {
    const item = buildPendingItem({ proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }] }, meta)!
    const next = enqueue(EMPTY_PENDING_STATE, item, 5)
    expect(next.items).toEqual([item])
    expect(next.dropped).toBe(0)
  })

  it('al pasarse del tope, descarta los más viejos (FIFO) y suma a dropped', () => {
    let state: PendingLearnedState = EMPTY_PENDING_STATE
    const items = Array.from({ length: 3 }, (_, i) =>
      buildPendingItem({ proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: `h${i}` }] }, { ...meta, runId: `run${i}` })!
    )
    for (const it of items) state = enqueue(state, it, 2)
    expect(state.items.map((i) => i.runId)).toEqual(['run1', 'run2'])
    expect(state.dropped).toBe(1)
  })
})

describe('discardOne / discardAll / ackDropped', () => {
  it('discardOne quita por id; con un id que no existe, removed: false', () => {
    const item = buildPendingItem({ proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }] }, meta)!
    const state = enqueue(EMPTY_PENDING_STATE, item)
    const ok = discardOne(state, item.id)
    expect(ok.removed).toBe(true)
    expect(ok.state.items).toEqual([])
    const nope = discardOne(state, 'no-existe')
    expect(nope.removed).toBe(false)
    expect(nope.state.items).toEqual(state.items)
  })

  it('discardAll vacía los ítems sin tocar dropped', () => {
    const item = buildPendingItem({ skill: { name: 'a', description: 'd', body: 'b' } }, meta)!
    const state = { ...enqueue(EMPTY_PENDING_STATE, item), dropped: 3 }
    const next = discardAll(state)
    expect(next.items).toEqual([])
    expect(next.dropped).toBe(3)
  })

  it('ackDropped vuelve dropped a 0 sin tocar los ítems', () => {
    const item = buildPendingItem({ skill: { name: 'a', description: 'd', body: 'b' } }, meta)!
    const state = { ...enqueue(EMPTY_PENDING_STATE, item), dropped: 5 }
    const next = ackDropped(state)
    expect(next.dropped).toBe(0)
    expect(next.items).toEqual(state.items)
  })
})

describe('resolvePart', () => {
  it('un ítem con solo memoria: al resolver "proposals" sale entero de la cola', () => {
    const item = buildPendingItem({ proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }] }, meta)!
    const state = enqueue(EMPTY_PENDING_STATE, item)
    expect(resolvePart(state, item.id, 'proposals').items).toEqual([])
  })

  it('un ítem con memoria Y skill: al resolver "proposals" la skill sigue pendiente', () => {
    const item = buildPendingItem(
      { proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }], skill: { name: 'a', description: 'd', body: 'b' } },
      meta
    )!
    const state = enqueue(EMPTY_PENDING_STATE, item)
    const next = resolvePart(state, item.id, 'proposals')
    expect(next.items).toHaveLength(1)
    expect(next.items[0].proposals).toBeUndefined()
    expect(next.items[0].skill?.name).toBe('a')
  })

  it('un ítem con memoria Y skill: al resolver "skill" la memoria sigue pendiente', () => {
    const item = buildPendingItem(
      { proposals: [{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }], skill: { name: 'a', description: 'd', body: 'b' } },
      meta
    )!
    const state = enqueue(EMPTY_PENDING_STATE, item)
    const next = resolvePart(state, item.id, 'skill')
    expect(next.items).toHaveLength(1)
    expect(next.items[0].skill).toBeUndefined()
    expect(next.items[0].proposals).toHaveLength(1)
  })

  it('un id que no existe: no cambia nada', () => {
    const item = buildPendingItem({ skill: { name: 'a', description: 'd', body: 'b' } }, meta)!
    const state = enqueue(EMPTY_PENDING_STATE, item)
    expect(resolvePart(state, 'no-existe', 'skill').items).toEqual(state.items)
  })
})
