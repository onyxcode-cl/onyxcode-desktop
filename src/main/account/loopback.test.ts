import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { startLoopback, type LoopbackHandle } from './loopback'

const STATE = 'estado-de-prueba-0123456789'
let open: LoopbackHandle[] = []
afterEach(() => {
  for (const h of open) h.cancel()
  open = []
})

async function start(timeoutMs?: number): Promise<LoopbackHandle> {
  const h = await startLoopback({ state: STATE, timeoutMs })
  open.push(h)
  return h
}

interface Res {
  status: number
  body: string
  headers: Record<string, string | string[] | undefined>
}
function req(port: number, path: string, o: { method?: string; host?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = request(
      { host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: o.host ? { host: o.host } : {}, agent: false },
      (res) => {
        let body = ''
        res.on('data', (d: Buffer) => (body += d.toString()))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
      }
    )
    r.on('error', reject)
    r.end()
  })
}

describe('loopback', () => {
  it('escucha solo en 127.0.0.1, puerto aleatorio, y redirectUri coherente', async () => {
    const h = await start()
    expect(h.port).toBeGreaterThan(1023)
    expect(h.redirectUri).toBe(`http://127.0.0.1:${h.port}/callback`)
  })

  it('petición válida: entrega el código, responde «Puedes volver a la app» y se cierra', async () => {
    const h = await start()
    const r = await req(h.port, `/callback?code=4%2F0AbC-d_e&state=${STATE}`)
    expect(r.status).toBe(200)
    expect(r.body).toContain('Puedes volver a la app')
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    expect(await h.result).toEqual({ ok: true, code: '4/0AbC-d_e' })
  })

  it('una segunda petición (aunque sea válida) ya no se atiende', async () => {
    const h = await start()
    await req(h.port, `/callback?code=abc&state=${STATE}`)
    await h.result
    await new Promise((r) => setTimeout(r, 30))
    await expect(req(h.port, `/callback?code=otro&state=${STATE}`)).rejects.toThrow()
    expect(await h.result).toEqual({ ok: true, code: 'abc' })
  })

  it('state incorrecto o ausente: 400 y NO gasta el turno (la petición buena posterior funciona)', async () => {
    const h = await start()
    expect((await req(h.port, '/callback?code=abc&state=malo')).status).toBe(400)
    expect((await req(h.port, '/callback?code=abc')).status).toBe(400)
    expect((await req(h.port, `/callback?code=abc&state=${STATE}x`)).status).toBe(400)
    expect((await req(h.port, `/callback?code=abc&state=${STATE}`)).status).toBe(200)
    expect(await h.result).toEqual({ ok: true, code: 'abc' })
  })

  it('otras rutas: 404; otros métodos: 405; ninguna gasta el turno', async () => {
    const h = await start()
    expect((await req(h.port, `/`)).status).toBe(404)
    expect((await req(h.port, `/otra?code=abc&state=${STATE}`)).status).toBe(404)
    expect((await req(h.port, `/callback2?code=abc&state=${STATE}`)).status).toBe(404)
    expect((await req(h.port, `/callback?code=abc&state=${STATE}`, { method: 'POST' })).status).toBe(405)
    expect((await req(h.port, `/callback?code=abc&state=${STATE}`, { method: 'PUT' })).status).toBe(405)
    expect((await req(h.port, `/callback?code=abc&state=${STATE}`)).status).toBe(200)
    expect(await h.result).toEqual({ ok: true, code: 'abc' })
  })

  it('Host que no es 127.0.0.1:puerto (DNS rebinding): 400', async () => {
    const h = await start()
    expect((await req(h.port, `/callback?code=abc&state=${STATE}`, { host: 'evil.example' })).status).toBe(400)
    expect((await req(h.port, `/callback?code=abc&state=${STATE}`, { host: `localhost:${h.port}` })).status).toBe(400)
    expect((await req(h.port, `/callback?code=abc&state=${STATE}`)).status).toBe(200)
  })

  it('el usuario rechaza en Google (error=access_denied con state bueno): resultado «denied»', async () => {
    const h = await start()
    const r = await req(h.port, `/callback?error=access_denied&state=${STATE}`)
    expect(r.status).toBe(200)
    expect(await h.result).toEqual({ ok: false, reason: 'denied' })
  })

  it('error con state falso no cancela el intento', async () => {
    const h = await start()
    expect((await req(h.port, '/callback?error=access_denied&state=falso')).status).toBe(400)
    expect((await req(h.port, `/callback?code=abc&state=${STATE}`)).status).toBe(200)
    expect(await h.result).toEqual({ ok: true, code: 'abc' })
  })

  it('state bueno pero sin código o con código raro: «invalid»', async () => {
    const h1 = await start()
    expect((await req(h1.port, `/callback?state=${STATE}`)).status).toBe(400)
    expect(await h1.result).toEqual({ ok: false, reason: 'invalid' })
    const h2 = await start()
    expect((await req(h2.port, `/callback?code=${encodeURIComponent('a b<script>')}&state=${STATE}`)).status).toBe(400)
    expect(await h2.result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('límite de tiempo: «timeout» y libera el puerto', async () => {
    const h = await start(60)
    expect(await h.result).toEqual({ ok: false, reason: 'timeout' })
    await new Promise((r) => setTimeout(r, 30))
    await expect(req(h.port, '/callback')).rejects.toThrow()
  })

  it('cancelar: «cancelled», idempotente, libera el puerto', async () => {
    const h = await start()
    h.cancel()
    h.cancel()
    expect(await h.result).toEqual({ ok: false, reason: 'cancelled' })
    await new Promise((r) => setTimeout(r, 30))
    await expect(req(h.port, `/callback?code=abc&state=${STATE}`)).rejects.toThrow()
  })

  it('inundación de peticiones rechazadas: abandona el intento', async () => {
    const h = await start()
    for (let i = 0; i < 20; i++) await req(h.port, '/x').catch(() => undefined)
    expect(await h.result).toEqual({ ok: false, reason: 'invalid' })
  })
})
