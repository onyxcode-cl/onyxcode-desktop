import { describe, expect, it } from 'vitest'
import { createEngineClient } from './factory'
import { Engine1Adapter } from './adapters/engine1'
import { Engine2Adapter } from './adapters/engine2'
import { EngineError, engineErrorText, kindFromStatus, toEngineError } from './errors'

describe('createEngineClient', () => {
  it('por defecto devuelve el adaptador del motor 1', () => {
    const c = createEngineClient({ baseUrl: 'http://127.0.0.1:1' })
    expect(c).toBeInstanceOf(Engine1Adapter)
    expect(c.kind).toBe('engine1')
  })

  it("engine '2' devuelve el esqueleto: todo rechaza con unsupported", async () => {
    const c = createEngineClient({ baseUrl: 'http://127.0.0.1:1', engine: '2' })
    expect(c).toBeInstanceOf(Engine2Adapter)
    expect(c.kind).toBe('engine2')
    const err = await c.sessions.list().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).kind).toBe('unsupported')
    await expect(c.permissions.list()).rejects.toMatchObject({ kind: 'unsupported' })
    await expect(c.providers.refresh()).rejects.toMatchObject({ kind: 'unsupported' })
    expect(() => c.events.subscribe(() => undefined)).toThrow(EngineError)
    expect(await c.health()).toEqual({ ok: false })
  })
})

describe('errores', () => {
  it('kindFromStatus', () => {
    expect(kindFromStatus(401)).toBe('unauthorized')
    expect(kindFromStatus(403)).toBe('unauthorized')
    expect(kindFromStatus(404)).toBe('notFound')
    expect(kindFromStatus(409)).toBe('conflict')
    expect(kindFromStatus(400)).toBe('badRequest')
    expect(kindFromStatus(500)).toBe('engine')
  })

  it('engineErrorText reconoce las formas que hoy adivina errorMessage()', () => {
    expect(engineErrorText('texto')).toBe('texto')
    expect(engineErrorText(new Error('boom'))).toBe('boom')
    expect(engineErrorText({ data: { message: 'del motor' } })).toBe('del motor')
    expect(engineErrorText({ message: 'plano' })).toBe('plano')
    expect(engineErrorText({ name: 'NotFoundError' })).toBe('NotFoundError')
    expect(engineErrorText(undefined)).toBeUndefined()
    expect(engineErrorText({ a: 1 })).toBe('{"a":1}')
  })

  it('toEngineError clasifica aborto, red y cuerpos del motor', () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' })
    expect(toEngineError(abort).kind).toBe('aborted')
    expect(toEngineError(new TypeError('fetch failed')).kind).toBe('network')
    const e = toEngineError({ data: { message: 'no existe' } }, 404)
    expect(e).toMatchObject({ kind: 'notFound', status: 404, message: 'no existe' })
    const same = new EngineError('conflict')
    expect(toEngineError(same)).toBe(same)
  })
})
