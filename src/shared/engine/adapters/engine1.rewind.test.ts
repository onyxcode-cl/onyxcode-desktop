import { describe, expect, it, vi } from 'vitest'
import { Engine1Adapter } from './engine1'
import { Engine2Adapter } from './engine2'

const mk = (fetchImpl: typeof fetch): Engine1Adapter =>
  new Engine1Adapter({ baseUrl: 'http://127.0.0.1:4999', authorization: 'Basic abc', directory: '/work/p', fetch: fetchImpl })
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

describe('adaptador del motor: rebobinar por turno (fetch crudo, sin SDK)', () => {
  it('turns usa la carpeta de la conexión y devuelve null si el motor no tiene la ruta', async () => {
    const f = vi.fn(async () => json([{ messageID: 'm1', time: 1, files: [], restaurable: true }]))
    const turns = await mk(f as never).rewind.turns('ses_1', { limite: 20 })
    expect(turns?.map((t) => t.messageID)).toEqual(['m1'])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/experimental/session/ses_1/turnos?directory=%2Fwork%2Fp&limite=20')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc')
    expect(await mk((async () => json({}, 404)) as never).rewind.turns('ses_1')).toBeNull()
  })

  it('rewind manda messageID, modo y sobrescribir por la ruta exacta', async () => {
    const f = vi.fn(async () =>
      json({ modo: 'codigo', restaurados: [], borrados: [], omitidos: [], mensajesOcultos: 0, puedeDeshacer: true })
    )
    const r = await mk(f as never).rewind.rewind('ses_1', 'msg_1', 'codigo', { sobrescribir: ['a.txt'] })
    expect(r).toMatchObject({ ok: true, result: { modo: 'codigo', puedeDeshacer: true } })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/experimental/session/ses_1/rebobinar?directory=%2Fwork%2Fp')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ messageID: 'msg_1', modo: 'codigo', sobrescribir: ['a.txt'] })
  })

  it('review, turnDiff y undo usan sus rutas', async () => {
    const f = vi.fn(async (url: string) =>
      url.includes('/turnos/')
        ? json({ file: 'a.txt', status: 'modified', additions: 1, deletions: 0, patch: '+x', binary: false, truncated: false })
        : url.endsWith('/deshacer?directory=%2Fwork%2Fp')
          ? json({ restaurados: [], borrados: [], omitidos: [], conflictos: [] })
          : json({
              archivos: [],
              conflictos: [],
              protegidos: [],
              comandos: false,
              commitsDespues: [],
              ayudantesActivos: [],
              mensajes: 1,
              restaurable: true
            })
    )
    const e = mk(f as never)
    expect(await e.rewind.review('s', 'm')).toMatchObject({ ok: true })
    expect(await e.rewind.turnDiff('s', 'm', 'a.txt')).toMatchObject({ ok: true, diff: { file: 'a.txt' } })
    expect(await e.rewind.undo('s')).toMatchObject({ ok: true })
    expect(f.mock.calls.map((c) => new URL((c as unknown as [string])[0]).pathname)).toEqual([
      '/experimental/session/s/rebobinar/m',
      '/experimental/session/s/turnos/m/diff',
      '/experimental/session/s/rebobinar/deshacer'
    ])
  })

  it('el motor 2 aún no lo tiene: sin turnos y las acciones responden «no disponible»', async () => {
    const e2 = new Engine2Adapter()
    expect(await e2.rewind.turns('s')).toBeNull()
    expect(await e2.rewind.rewind('s', 'm', 'todo')).toEqual({ ok: false, kind: 'unavailable' })
    expect(await e2.rewind.undo('s')).toEqual({ ok: false, kind: 'unavailable' })
  })
})
