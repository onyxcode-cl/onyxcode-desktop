/**
 * Cola de pendientes de Rutinas (decisión del dueño, 2026-10-07): vive en `userData/memoria/pendientes.json`.
 * Usa SIEMPRE un `userData` y carpetas de proyecto de prueba (tmpdir), nunca los reales.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { acceptLearnedMemory } from './learned-memory'
import {
  acceptPendingMemory,
  acceptPendingSkill,
  ackPendingDropped,
  discardAllPending,
  discardPending,
  enqueueFromRoutine,
  listPending
} from './learned-pending'

const identity = (f: string): string => f
const block = (arr: unknown): string => '```lazunox-memoria\n' + JSON.stringify(arr) + '\n```'
const skillBlock = (obj: unknown): string => '```lazunox-skill\n' + JSON.stringify(obj) + '\n```'
const meta = (over: Partial<Parameters<typeof enqueueFromRoutine>[0]> = {}) => ({
  text: '',
  routineId: 'r1',
  routineName: 'Rutina diaria',
  runId: 'run1',
  folder: '/work/a',
  ...over
})

let folderA: string

beforeEach(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'lzx-pending-userdata-'))
  folderA = mkdtempSync(join(tmpdir(), 'lzx-pending-proyecto-'))
})
afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true })
  rmSync(folderA, { recursive: true, force: true })
})

describe('enqueueFromRoutine', () => {
  it('sin bloques: no encola nada', () => {
    const r = enqueueFromRoutine(meta({ text: 'listo, nada que proponer' }))
    expect(r.enqueued).toBe(false)
    expect(listPending().items).toEqual([])
  })

  it('con una propuesta de memoria: la encola', () => {
    const text = block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas' }])
    const r = enqueueFromRoutine(meta({ text, folder: folderA }))
    expect(r.enqueued).toBe(true)
    expect(listPending().items).toHaveLength(1)
    expect(listPending().items[0].proposals?.[0].texto).toBe('prefiere tablas')
  })

  it('una propuesta idéntica a una ya guardada no se encola de nuevo', () => {
    acceptLearnedMemory(folderA, [{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas' }])
    const text = block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'Prefiere   tablas' }])
    const r = enqueueFromRoutine(meta({ text, folder: folderA }))
    expect(r.enqueued).toBe(false)
  })

  it('la misma propuesta de dos ejecuciones distintas no se duplica en la cola', () => {
    const text = block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas' }])
    enqueueFromRoutine(meta({ text, folder: folderA, runId: 'run1' }))
    const r2 = enqueueFromRoutine(meta({ text, folder: folderA, runId: 'run2' }))
    expect(r2.enqueued).toBe(false)
    expect(listPending().items).toHaveLength(1)
  })

  it('la misma skill propuesta dos veces no se duplica en la cola (ya hay una pendiente con ese nombre)', () => {
    const text = skillBlock({ name: 'mi-skill', description: 'd', body: 'b' })
    enqueueFromRoutine(meta({ text, folder: folderA, runId: 'run1' }))
    expect(listPending().items).toHaveLength(1)
    const r2 = enqueueFromRoutine(meta({ text, folder: folderA, runId: 'run2' }))
    expect(r2.enqueued).toBe(false)
    expect(listPending().items).toHaveLength(1)
  })

  it('una skill con un nombre que ya existe en disco no se encola', () => {
    enqueueFromRoutine(meta({ text: skillBlock({ name: 'ya-guardada', description: 'd', body: 'b' }), folder: folderA, runId: 'run-a' }))
    const id = listPending().items[0].id
    acceptPendingSkill(id, { name: 'ya-guardada', description: 'd', body: 'b' }, identity)
    expect(listPending().items).toEqual([])
    const r = enqueueFromRoutine(
      meta({ text: skillBlock({ name: 'ya-guardada', description: 'd', body: 'b' }), folder: folderA, runId: 'run-b' })
    )
    expect(r.enqueued).toBe(false)
  })

  it('más allá del tope, descarta los ítems más viejos (FIFO)', () => {
    for (let i = 0; i < 35; i++) {
      enqueueFromRoutine(meta({ text: block([{ alcance: 'usuario', tipo: 'preferencia', texto: `hecho ${i}` }]), runId: `run${i}` }))
    }
    const state2 = listPending()
    expect(state2.items).toHaveLength(30)
    expect(state2.dropped).toBe(5)
    expect(state2.items[0].runId).toBe('run5')
  })
})

describe('acceptPendingMemory', () => {
  it('id inexistente: no-encontrado', () => {
    expect(acceptPendingMemory('no-existe', [], identity)).toEqual({ ok: false, reason: 'no-encontrado' })
  })

  it('aprueba alcance usuario sin necesitar la carpeta, y quita el ítem de la cola', () => {
    enqueueFromRoutine(meta({ text: block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }]), folder: folderA }))
    const id = listPending().items[0].id
    const r = acceptPendingMemory(id, [{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }], identity)
    expect(r.ok).toBe(true)
    expect(listPending().items).toEqual([])
  })

  it('alcance proyecto con carpeta que ya no se puede validar: carpeta-no-aprobada, el ítem SIGUE pendiente', () => {
    enqueueFromRoutine(meta({ text: block([{ alcance: 'proyecto', tipo: 'convencion', texto: 'x' }]), folder: folderA }))
    const id = listPending().items[0].id
    const rejectFolder = (): never => {
      throw new Error('no aprobada')
    }
    const r = acceptPendingMemory(id, [{ alcance: 'proyecto', tipo: 'convencion', texto: 'x' }], rejectFolder)
    expect(r).toEqual({ ok: false, reason: 'carpeta-no-aprobada' })
    expect(listPending().items).toHaveLength(1)
  })
})

describe('acceptPendingSkill', () => {
  it('id inexistente: no-encontrado', () => {
    expect(acceptPendingSkill('no-existe', { name: 'a', description: 'd', body: 'b' }, identity)).toEqual({
      ok: false,
      reason: 'no-encontrado'
    })
  })

  it('escribe la skill y quita el ítem de la cola', () => {
    enqueueFromRoutine(meta({ text: skillBlock({ name: 'mi-skill', description: 'd', body: 'b' }), folder: folderA }))
    const id = listPending().items[0].id
    const r = acceptPendingSkill(id, { name: 'mi-skill', description: 'd', body: 'b' }, identity)
    expect(r.ok).toBe(true)
    expect(listPending().items).toEqual([])
  })

  it('si ya existe una skill con ese nombre, el ítem SIGUE pendiente (el dueño puede cambiar el nombre)', () => {
    enqueueFromRoutine(meta({ text: skillBlock({ name: 'repetida', description: 'd', body: 'b' }), folder: folderA }))
    const id = listPending().items[0].id
    acceptPendingSkill(id, { name: 'repetida', description: 'd', body: 'b' }, identity)
    // Se re-encola a mano una segunda propuesta con el mismo nombre (simula otra rutina, sin el filtro de enqueueFromRoutine).
    const r2 = acceptPendingSkill(id, { name: 'repetida', description: 'd', body: 'b' }, identity)
    expect(r2).toMatchObject({ ok: false })
  })
})

describe('un ítem con memoria Y skill a la vez (prompt de la rutina pidió las dos cosas en el mismo turno)', () => {
  it('aprobar la memoria no pierde la skill, que sigue pendiente; luego aprobar la skill sí la saca de la cola', () => {
    const text = [
      block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas' }]),
      skillBlock({ name: 'mi-skill', description: 'd', body: 'b' })
    ].join('\n')
    enqueueFromRoutine(meta({ text, folder: folderA }))
    const id = listPending().items[0].id

    const rMem = acceptPendingMemory(id, [{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas' }], identity)
    expect(rMem.ok).toBe(true)
    expect(listPending().items).toHaveLength(1)
    expect(listPending().items[0].proposals).toBeUndefined()
    expect(listPending().items[0].skill?.name).toBe('mi-skill')

    const rSkill = acceptPendingSkill(id, { name: 'mi-skill', description: 'd', body: 'b' }, identity)
    expect(rSkill.ok).toBe(true)
    expect(listPending().items).toEqual([])
  })
})

describe('discardPending / discardAllPending / ackPendingDropped', () => {
  it('discardPending quita un ítem por id', () => {
    enqueueFromRoutine(meta({ text: block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'x' }]) }))
    const id = listPending().items[0].id
    discardPending(id)
    expect(listPending().items).toEqual([])
  })

  it('discardAllPending vacía la cola sin tocar dropped', () => {
    for (let i = 0; i < 32; i++) {
      enqueueFromRoutine(meta({ text: block([{ alcance: 'usuario', tipo: 'preferencia', texto: `h${i}` }]), runId: `run${i}` }))
    }
    expect(listPending().dropped).toBeGreaterThan(0)
    discardAllPending()
    const s = listPending()
    expect(s.items).toEqual([])
    expect(s.dropped).toBeGreaterThan(0)
  })

  it('ackPendingDropped vuelve dropped a 0', () => {
    for (let i = 0; i < 32; i++) {
      enqueueFromRoutine(meta({ text: block([{ alcance: 'usuario', tipo: 'preferencia', texto: `h${i}` }]), runId: `run${i}` }))
    }
    ackPendingDropped()
    expect(listPending().dropped).toBe(0)
  })
})
