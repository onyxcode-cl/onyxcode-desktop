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
