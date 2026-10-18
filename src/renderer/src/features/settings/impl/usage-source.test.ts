import type { GlobalSession, Session } from '@opencode-ai/sdk/v2/client'
import { describe, expect, it, vi } from 'vitest'
import { USAGE_LIMIT, isFreeModel, modeOf, readUsage, type UsageClient } from './usage-source'

const gs = (id: string, over: Record<string, unknown> = {}): GlobalSession =>
  ({
    id,
    directory: '/code/app',
    time: { created: 1, updated: 1000 },
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    ...over
  }) as unknown as GlobalSession

const client = (data: GlobalSession[] | undefined, error?: unknown): { c: UsageClient; list: ReturnType<typeof vi.fn> } => {
  const list = vi.fn(async () => ({ data, error }))
  return { c: { experimental: { session: { list } } }, list }
}
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? 'sin detalle'))

describe('modeOf', () => {
  it('reconoce el modo por el agente y, si no lo trae, por la carpeta de Chat', () => {
    expect(modeOf({ agent: 'chat', directory: '/x' }, '/chat')).toBe('chat')
    expect(modeOf({ agent: 'tasks', directory: '/x' }, '/chat')).toBe('tasks')
    expect(modeOf({ agent: 'computer', directory: '/x' }, '/chat')).toBe('tasks')
    expect(modeOf({ agent: 'build', directory: '/code/app' }, '/chat')).toBe('code')
    expect(modeOf({ directory: '/chat' }, '/chat')).toBe('chat')
    expect(modeOf({ directory: '/code/app' }, '/chat')).toBe('code')
    expect(modeOf({ directory: '/chat' }, null)).toBe('code')
  })
})

describe('readUsage', () => {
  it('pide solo las 300 más recientes en UNA llamada al motor local', async () => {
    const { c, list } = client([gs('a'), gs('b')])
    const r = await readUsage(c, { chatDirectory: null }, msg)
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ limit: USAGE_LIMIT })
    expect(USAGE_LIMIT).toBe(300)
    expect(r.capped).toBe(false)
    expect(r.sessions).toHaveLength(2)
  })

  it('marca el tope cuando la respuesta llena el límite y guarda la actividad más antigua', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => gs(`s${i}`, { time: { created: 1, updated: 5000 - i * 100 } }))
    const { c } = client(rows)
    const r = await readUsage(c, { chatDirectory: null, limit: 5 }, msg)
    expect(r.capped).toBe(true)
    expect(r.oldestRead).toBe(4600)
  })

  it('reparte en modos, conserva modelo, costo y tokens, y no repite sesiones', async () => {
    const { c } = client([
      gs('c1', { agent: 'chat', cost: 0, model: { id: 'm', providerID: 'p' } }),
      gs('c1'),
      gs('k1', { agent: 'build', parentID: 'raiz', cost: 0.5 })
    ])
    const r = await readUsage(c, { chatDirectory: '/chat' }, msg)
    expect(r.sessions.map((s) => [s.id, s.mode, s.parentID ?? null])).toEqual([
      ['c1', 'chat', null],
      ['k1', 'code', 'raiz']
    ])
    expect(r.sessions[0]).toMatchObject({ cost: 0, model: { id: 'm', providerID: 'p' }, tokens: { input: 10, output: 5 } })
    expect(r.sessions[1].cost).toBe(0.5)
  })

  it('suma las tareas de Overdrive que la app ya tiene cargadas, sin duplicarlas', async () => {
    const { c } = client([gs('a')])
    const tasks = [gs('t1', { agent: 'tasks' }), gs('a')] as unknown as Session[]
    const r = await readUsage(c, { chatDirectory: null, tasks }, msg)
    expect(r.sessions.map((s) => [s.id, s.mode])).toEqual([
      ['a', 'code'],
      ['t1', 'tasks']
    ])
    expect(r.tasksSessions).toBe(1)
  })

  it('F8-B198: el resumen de main aporta las tareas de las carpetas aprobadas, con su origen y sin duplicar lo cargado', async () => {
    const { c } = client([])
    const tok = { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }
    const r = await readUsage(
      c,
      {
        chatDirectory: '/chat',
        tasks: [{ id: 'o1', time: { updated: 5 } } as unknown as Session],
        tasksUsage: {
          supported: true,
          folders: 2,
          unreadable: 1,
          capped: false,
          sessions: [
            { id: 'o1', tokens: tok, cost: 0, updated: 7, model: { id: 'm', providerID: 'p' } },
            { id: 'o2', parentID: 'o1', tokens: tok, updated: 6 }
          ]
        }
      },
      msg
    )
    expect(r.sessions.map((s) => [s.id, s.mode])).toEqual([
      ['o1', 'tasks'],
      ['o2', 'tasks']
    ])
    expect(r.sessions[0]).toMatchObject({ model: { id: 'm', providerID: 'p' }, updated: 7 })
    expect(r.sessions[1]).toMatchObject({ parentID: 'o1' })
    expect(r).toMatchObject({ tasksSessions: 2, tasksSource: 'read', tasksUnreadable: 1, capped: false })
  })

  it('F8-B198: sin resumen (no soportado o no disponible) lo dice, y las tareas en memoria se siguen sumando', async () => {
    const { c } = client([])
    const mem = [{ id: 't1', time: { updated: 5 } } as unknown as Session]
    const unsupported = { supported: false, folders: 0, unreadable: 0, sessions: [], capped: false }
    expect(await readUsage(c, { chatDirectory: null, tasks: mem, tasksUsage: unsupported }, msg)).toMatchObject({
      tasksSource: 'unsupported',
      tasksSessions: 1
    })
    expect(await readUsage(c, { chatDirectory: null, tasks: mem, tasksUsage: null }, msg)).toMatchObject({
      tasksSource: 'unavailable',
      tasksSessions: 1
    })
    expect(await readUsage(c, { chatDirectory: null }, msg)).toMatchObject({ tasksSource: 'unavailable', tasksSessions: 0 })
  })

  it('F8-B198: si Overdrive llegó a su tope, el período es incompleto desde su sesión más antigua leída', async () => {
    const tok = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
    const { c } = client([gs('a', { time: { created: 1, updated: 100 } })])
    const r = await readUsage(
      c,
      {
        chatDirectory: null,
        tasksUsage: {
          supported: true,
          folders: 1,
          unreadable: 0,
          capped: true,
          sessions: [{ id: 'o1', tokens: tok, updated: 500 }]
        }
      },
      msg
    )
    // El motor principal no llegó al tope (1 < 300); Overdrive sí: manda su fecha.
    expect(r.capped).toBe(true)
    expect(r.oldestRead).toBe(500)
  })

  it('un error del motor se propaga con su mensaje; sin datos también', async () => {
    await expect(readUsage(client(undefined, new Error('motor caído')).c, { chatDirectory: null }, msg)).rejects.toThrow('motor caído')
    await expect(readUsage(client(undefined).c, { chatDirectory: null }, msg)).rejects.toThrow()
  })
})

describe('isFreeModel', () => {
  const catalog = [
    {
      id: 'opencode',
      models: { 'a-free': { cost: { input: 0, output: 0 } }, pago: { cost: { input: 1, output: 2 } }, sinficha: undefined }
    },
    { id: 'otro', models: { local: { cost: { input: 0, output: 0 } } } }
  ]
  it('solo el servicio gratuito puede ser «gratuito»', () => {
    expect(isFreeModel('opencode', 'a-free', catalog)).toBe(true)
    expect(isFreeModel('opencode', 'pago', catalog)).toBe(false)
    // Cualquier otro servicio con tarifa cero puede ser una tarifa que falta: queda «sin dato».
    expect(isFreeModel('otro', 'local', catalog)).toBe(false)
  })
  it('sin ficha en el catálogo, solo cuenta el sufijo -free del servicio gratuito', () => {
    expect(isFreeModel('opencode', 'nuevo-free', catalog)).toBe(true)
    expect(isFreeModel('opencode', 'sinficha', catalog)).toBe(false)
    expect(isFreeModel('opencode', 'x-free', [])).toBe(true)
    expect(isFreeModel('otro', 'x-free', [])).toBe(false)
  })
})
