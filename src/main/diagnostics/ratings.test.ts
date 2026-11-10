import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { RATING_COMMENT_MAX, type RatingInput } from '@shared/ratings'
import { CHANNEL_ROLES, IPC_SCHEMAS } from '../ipc/schemas'
import { buildRatingRecord, RatingStore } from './ratings'

const ctx = { now: Date.UTC(2026, 10, 10, 12, 0, 0), appVersion: '1.8.15', engineVersion: '2.3.0' }
const base: RatingInput = {
  sessionId: 'ses_1',
  messageId: 'msg_9',
  value: 'good',
  model: 'claude-sonnet-5-5',
  service: 'anthropic',
  mode: 'build',
  durationMs: 4200,
  tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 10, cacheWrite: 5 }
}

describe('buildRatingRecord', () => {
  it('arma la línea con fecha, versiones, modelo, servicio y modo', () => {
    expect(buildRatingRecord(base, ctx)).toEqual({
      t: '2026-11-10T12:00:00.000Z',
      sessionId: 'ses_1',
      messageId: 'msg_9',
      model: 'claude-sonnet-5-5',
      service: 'anthropic',
      mode: 'build',
      appVersion: '1.8.15',
      engineVersion: '2.3.0',
      value: 'good',
      durationMs: 4200,
      tokens: base.tokens
    })
  })
  it('no admite texto de la conversación ni claves de más', () => {
    expect(buildRatingRecord({ ...base, text: 'hola, esto dijo el asistente' }, ctx)).toBeNull()
    expect(buildRatingRecord({ ...base, cwd: '/Users/ana/proyecto' }, ctx)).toBeNull()
  })
  it('rechaza valores y ids inválidos', () => {
    expect(buildRatingRecord({ ...base, value: 'regular' }, ctx)).toBeNull()
    expect(buildRatingRecord({ ...base, value: null }, ctx)).toBeNull()
    expect(buildRatingRecord({ ...base, sessionId: '../x' }, ctx)).toBeNull()
    expect(buildRatingRecord({ ...base, model: 'a\nb' }, ctx)).toBeNull()
    expect(buildRatingRecord({ ...base, durationMs: -1 }, ctx)).toBeNull()
    expect(buildRatingRecord({ ...base, tokens: { input: 1 } }, ctx)).toBeNull()
    expect(buildRatingRecord('x', ctx)).toBeNull()
  })
  it('recorta el comentario, quita rutas y lo descarta con «buena»', () => {
    const long = buildRatingRecord({ ...base, value: 'bad', comment: 'x'.repeat(1000) }, ctx)
    expect(long?.comment).toHaveLength(RATING_COMMENT_MAX)
    const path = buildRatingRecord({ ...base, value: 'bad', comment: 'falló en /Users/ana/app/src/a.ts otra vez' }, ctx)
    expect(path?.comment).toBe('falló en [ruta] otra vez')
    expect(buildRatingRecord({ ...base, value: 'good', comment: 'hola' }, ctx)?.comment).toBeUndefined()
  })
})

describe('RatingStore (manejador de rating:set / rating:list)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lzx-ratings-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const make = (): RatingStore => new RatingStore({ dir, now: () => ctx.now, appVersion: () => '1.8.15', engineVersion: () => '2.3.0' })
  const lines = (): Array<Record<string, unknown>> =>
    readFileSync(join(dir, 'valoraciones.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))

  it('escribe una línea válida (0600) y la devuelve en la lista', () => {
    const s = make()
    expect(s.set(base)).toBe(true)
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toMatchObject({ sessionId: 'ses_1', messageId: 'msg_9', value: 'good', appVersion: '1.8.15' })
    if (process.platform !== 'win32') expect(statSync(join(dir, 'valoraciones.jsonl')).mode & 0o777).toBe(0o600)
    expect(s.list('ses_1')).toEqual([{ messageId: 'msg_9', value: 'good' }])
    expect(s.list('otra')).toEqual([])
  })
  it('cambiar reemplaza la línea; otra respuesta se suma; quitar la borra', () => {
    const s = make()
    s.set(base)
    s.set({ ...base, messageId: 'msg_10' })
    s.set({ ...base, value: 'bad', comment: 'no compila' })
    expect(lines()).toHaveLength(2)
    expect(s.list('ses_1').find((e) => e.messageId === 'msg_9')).toEqual({ messageId: 'msg_9', value: 'bad', comment: 'no compila' })
    expect(s.set({ ...base, value: null })).toBe(true)
    expect(s.list('ses_1')).toEqual([{ messageId: 'msg_10', value: 'good' }])
  })
  it('una entrada inválida no escribe nada', () => {
    const s = make()
    expect(s.set({ ...base, value: 'meh' } as never)).toBe(false)
    expect(s.list('ses_1')).toEqual([])
  })
  it('readLines devuelve las líneas para el diagnóstico, sin texto de conversación', () => {
    const s = make()
    s.set(base)
    expect(s.readLines()).toHaveLength(1)
    expect(s.readLines()[0]).not.toMatch(/\/Users|texto/)
  })
})

describe('canales rating:*', () => {
  it('existen, tienen esquema, son solo de la ventana principal y el celular los tiene negados', () => {
    for (const c of ['rating:set', 'rating:list']) {
      expect(IPC_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })
  it('rating:set valida la entrada', () => {
    const v = IPC_SCHEMAS['rating:set']!
    expect(v(base)).toEqual(base)
    expect(v({ ...base, value: null })).toMatchObject({ value: null })
    expect(() => v({ ...base, value: 'x' })).toThrow()
    expect(() => v({ ...base, text: 'hola' })).toThrow()
    expect(() => v({ ...base, sessionId: 'a/b' })).toThrow()
    expect(() => v({ ...base, comment: 'x'.repeat(2001) })).toThrow()
  })
})
