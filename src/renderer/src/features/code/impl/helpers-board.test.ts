import { describe, expect, it } from 'vitest'
import { canQueryFolder, selectHelperBoard, usageOfMessages, type HelperBoardInput } from './helpers-board'

const NOW = 1_000_000
const sess = (id: string, parentID?: string, created = NOW - 60_000): never =>
  ({ id, parentID, title: id, time: { created, updated: NOW - 5_000 } }) as never
const task = (child: string, over: Record<string, unknown> = {}, status = 'completed'): never =>
  ({
    type: 'tool',
    tool: 'task',
    state: { status, input: { description: `Hace ${child}`, subagent_type: 'explore' }, metadata: { sessionId: child, ...over } }
  }) as never
const asst = (tokens: unknown, cost = 0, extra: Record<string, unknown> = {}): { info: unknown; parts: never[] } => ({
  info: { id: 'a', role: 'assistant', providerID: 'p', modelID: 'm1', cost, tokens, ...extra },
  parts: []
})
const base = (over: Partial<HelperBoardInput> = {}): HelperBoardInput => ({
  rootId: 'root',
  sessions: { root: sess('root'), k1: sess('k1', 'root'), k2: sess('k2', 'root') },
  status: {},
  messages: { root: [{ info: {}, parts: [task('k1', { background: true }), task('k2')] }] },
  now: NOW,
  ...over
})

describe('selectHelperBoard', () => {
  it('sin raíz o sin ayudantes no hay filas', () => {
    expect(selectHelperBoard(base({ rootId: null })).rows).toEqual([])
    expect(selectHelperBoard(base({ messages: {} })).rows).toEqual([])
  })

  it('incluye ayudantes en primer y segundo plano; ignora hijas sin parte task', () => {
    const b = selectHelperBoard(
      base({ sessions: { root: sess('root'), k1: sess('k1', 'root'), k2: sess('k2', 'root'), side: sess('side', 'root') } })
    )
    expect(b.rows.map((r) => r.id).sort()).toEqual(['k1', 'k2'])
    expect(b.rows.find((r) => r.id === 'k1')?.background).toBe(true)
    expect(b.rows.find((r) => r.id === 'k2')?.background).toBe(false)
  })

  it('estados: trabajando, esperando permiso, bloqueado, error, detenido y terminado', () => {
    const st = (over: Partial<HelperBoardInput>): Record<string, string> =>
      Object.fromEntries(selectHelperBoard(base(over)).rows.map((r) => [r.id, r.state]))
    expect(st({ status: { k1: 'busy', k2: 'retry' } })).toEqual({ k1: 'working', k2: 'blocked' })
    expect(st({ status: { k1: 'busy' }, pendingSessionIds: ['k1'] }).k1).toBe('waiting')
    expect(st({ errors: { k2: 'boom' } }).k2).toBe('error')
    expect(st({}).k1).toBe('done')
    expect(
      st({
        messages: {
          root: base().messages.root!,
          k1: [asst({ input: 1, output: 1, reasoning: 0, cache: {} }, 0, { error: { name: 'MessageAbortedError' } })]
        }
      }).k1
    ).toBe('stopped')
  })

  it('una hija recién creada y sin mensajes cuenta como trabajando', () => {
    const b = selectHelperBoard(base({ sessions: { root: sess('root'), k1: sess('k1', 'root', NOW - 500), k2: sess('k2', 'root') } }))
    expect(b.rows.find((r) => r.id === 'k1')?.state).toBe('working')
  })

  it('tokens, modelo y costo salen de los mensajes; sin ellos son «sin dato» (null), no cero', () => {
    const b = selectHelperBoard(
      base({
        status: { k1: 'busy' },
        messages: {
          root: base().messages.root!,
          k1: [
            asst({ input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 0 } }, 0.5),
            asst({ total: 300, input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }, 0.25)
          ]
        }
      })
    )
    const k1 = b.rows.find((r) => r.id === 'k1')!
    expect(k1.tokens).toEqual({ total: 135 + 300, input: 300, output: 120 })
    expect(k1.cost).toBeCloseTo(0.75)
    expect(k1.model).toBe('p/m1')
    const k2 = b.rows.find((r) => r.id === 'k2')!
    expect(k2.tokens).toBeNull()
    expect(k2.cost).toBeNull()
    expect(k2.model).toBeNull()
    expect(b.totalTokens).toBe(435)
    expect(b.unknownTokens).toBe(1)
    expect(b.totalCost).toBeCloseTo(0.75)
  })

  it('mensaje del asistente aún sin cifras (en curso) no inventa tokens', () => {
    expect(usageOfMessages([asst({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })]).tokens).toBeNull()
    expect(usageOfMessages(undefined).tokens).toBeNull()
  })

  it('el modelo cae al pedido en el mensaje del usuario si aún no hay respuesta', () => {
    const u = { info: { role: 'user', model: { providerID: 'x', modelID: 'y' } }, parts: [] as never[] }
    expect(usageOfMessages([u]).model).toBe('x/y')
  })

  it('vivos primero, luego terminados; cuenta los vivos', () => {
    const b = selectHelperBoard(base({ status: { k2: 'busy' } }))
    expect(b.rows.map((r) => r.id)).toEqual(['k2', 'k1'])
    expect(b.liveCount).toBe(1)
    expect(b.rows[1].endedAt).not.toBeNull()
  })

  it('el tiempo corre mientras vive y se congela al terminar', () => {
    const live = selectHelperBoard(base({ status: { k1: 'busy' }, now: NOW + 10_000 })).rows.find((r) => r.id === 'k1')!
    expect(live.elapsedMs).toBe(70_000)
    const done = selectHelperBoard(base({ now: NOW + 10_000 })).rows.find((r) => r.id === 'k1')!
    expect(done.elapsedMs).toBe(55_000)
  })
})

describe('canQueryFolder (carpeta con foco y confianza vigente)', () => {
  const st = (directory: string | null, trusted: boolean) => ({ directory, isTrusted: () => trusted })
  it('solo con foco, confianza y verificación', () => {
    expect(canQueryFolder('/w/a', st('/w/a', true), () => true)).toBe(true)
    expect(canQueryFolder('/w/a/', st('/w/a', true), () => true)).toBe(true)
  })
  it('sin foco, sin confianza, sin verificar o sin carpeta: no', () => {
    expect(canQueryFolder('/w/b', st('/w/a', true), () => true)).toBe(false)
    expect(canQueryFolder('/w/a', st('/w/a', false), () => true)).toBe(false)
    expect(canQueryFolder('/w/a', st('/w/a', true), () => false)).toBe(false)
    expect(canQueryFolder(undefined, st('/w/a', true), () => true)).toBe(false)
    expect(canQueryFolder('/w/a', st(null, true), () => true)).toBe(false)
  })
})
