import { describe, expect, it, vi } from 'vitest'
import { fetchEngineJobs, stopEngineJob } from './engine-jobs'

const conn = { baseUrl: 'http://127.0.0.1:4096', authorization: 'Basic abc' }
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status })

describe('fetchEngineJobs', () => {
  it('pide la ruta del contrato con la autorización y normaliza la respuesta', async () => {
    const f = vi.fn(async () =>
      json(200, { trabajos: [{ id: 'sh_1', tipo: 'shell', titulo: 'make', estado: 'en_curso', codigo: null, inicio: 5, fin: null }] })
    )
    const r = await fetchEngineJobs(conn, { sessionID: 'ses_1' }, f as never)
    expect(r).toEqual({
      available: true,
      jobs: [{ id: 'sh_1', kind: 'shell', title: 'make', state: 'en_curso', code: null, startedAt: 5, endedAt: null }]
    })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4096/experimental/session/ses_1/trabajos')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc')
  })

  it('manda la carpeta codificada cuando la hay', async () => {
    const f = vi.fn(async () => json(200, { trabajos: [] }))
    await fetchEngineJobs(conn, { sessionID: 'ses_1', directory: '/a b/ñ' }, f as never)
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      `http://127.0.0.1:4096/experimental/session/ses_1/trabajos?directory=${encodeURIComponent('/a b/ñ')}`
    )
  })

  it('404/405 (motor sin la ruta) = no disponible, sin error', async () => {
    for (const status of [404, 405]) {
      expect(await fetchEngineJobs(conn, { sessionID: 's' }, (async () => json(status, {})) as never)).toEqual({ available: false })
    }
  })

  it('otros errores HTTP y de red se propagan (el panel conserva lo último)', async () => {
    await expect(fetchEngineJobs(conn, { sessionID: 's' }, (async () => json(500, {})) as never)).rejects.toThrow('500')
    await expect(
      fetchEngineJobs(conn, { sessionID: 's' }, (async () => {
        throw new TypeError('fetch failed')
      }) as never)
    ).rejects.toThrow('fetch failed')
  })

  it('cuerpo ilegible = lista vacía disponible', async () => {
    const r = await fetchEngineJobs(conn, { sessionID: 's' }, (async () => new Response('no json', { status: 200 })) as never)
    expect(r).toEqual({ available: true, jobs: [] })
  })
})

describe('stopEngineJob', () => {
  it('hace POST a …/trabajos/{id}/terminar y devuelve ok', async () => {
    const f = vi.fn(async () => json(200, { ok: true }))
    expect(await stopEngineJob(conn, { sessionID: 'ses_1', jobId: 'sh_9' }, f as never)).toEqual({ ok: true })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4096/experimental/session/ses_1/trabajos/sh_9/terminar')
    expect(init.method).toBe('POST')
  })

  it('ok:false del motor, 404 y cuerpos raros dan ok:false; un 500 lanza', async () => {
    expect(await stopEngineJob(conn, { sessionID: 's', jobId: 'j' }, (async () => json(200, { ok: false })) as never)).toEqual({
      ok: false
    })
    expect(await stopEngineJob(conn, { sessionID: 's', jobId: 'j' }, (async () => json(404, {})) as never)).toEqual({ ok: false })
    expect(await stopEngineJob(conn, { sessionID: 's', jobId: 'j' }, (async () => json(200, { ok: 'sí' })) as never)).toEqual({ ok: false })
    await expect(stopEngineJob(conn, { sessionID: 's', jobId: 'j' }, (async () => json(500, {})) as never)).rejects.toThrow('500')
  })
})
