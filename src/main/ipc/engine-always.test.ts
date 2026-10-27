import { describe, expect, it, vi } from 'vitest'
import { fetchAlwaysRules, revokeAlwaysRule } from './engine-always'

const conn = { baseUrl: 'http://127.0.0.1:4096', authorization: 'Basic abc' }
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status })
type Call = [string, RequestInit | undefined]
const callsOf = (f: ReturnType<typeof vi.fn>): Call[] => f.mock.calls as unknown as Call[]

describe('«siempre» guardados (fetch crudo)', () => {
  it('GET: ruta del contrato con autorización y carpeta codificada; normaliza las reglas', async () => {
    const f = vi.fn(async () =>
      json(200, { activo: true, reglas: [{ id: 'ab12', permission: 'bash', pattern: 'git status' }], aviso: 'Una regla se ignoró' })
    )
    const r = await fetchAlwaysRules(conn, { directory: '/a b' }, f as never)
    expect(r).toEqual({
      available: true,
      active: true,
      rules: [{ id: 'ab12', permission: 'bash', pattern: 'git status' }],
      notice: 'Una regla se ignoró',
      truncated: false
    })
    const [url, init] = callsOf(f)[0]!
    expect(url).toBe(`http://127.0.0.1:4096/permission/siempre?directory=${encodeURIComponent('/a b')}`)
    expect((init!.headers as Record<string, string>).Authorization).toBe('Basic abc')
  })

  it('GET: descarta reglas mal formadas, limpia saltos de línea y acota el largo', async () => {
    const f = async (): Promise<Response> =>
      json(200, {
        activo: false,
        reglas: [
          { id: 'ok1', permission: 'bash', pattern: 'ls\nrm -rf /' },
          { id: '../mal', permission: 'bash', pattern: 'x' },
          { id: 'ok2', permission: 5, pattern: 'x' },
          { id: 'ok3', permission: 'read', pattern: 'y'.repeat(2000) },
          null,
          'texto'
        ]
      })
    const r = await fetchAlwaysRules(conn, { directory: '/a' }, f as never)
    expect(r.available && r.rules.map((x) => x.id)).toEqual(['ok1', 'ok3'])
    if (r.available) {
      expect(r.rules[0]!.pattern).toBe('ls rm -rf /')
      expect(r.rules[1]!.pattern.length).toBe(500)
      expect(r.active).toBe(false)
    }
  })

  it('GET: 404/405 = motor sin la ruta; 500, red y respuesta ilegible se propagan', async () => {
    for (const status of [404, 405])
      expect(await fetchAlwaysRules(conn, { directory: '/a' }, (async () => json(status, {})) as never)).toEqual({ available: false })
    await expect(fetchAlwaysRules(conn, { directory: '/a' }, (async () => json(500, {})) as never)).rejects.toThrow('500')
    await expect(fetchAlwaysRules(conn, { directory: '/a' }, (async () => json(200, { reglas: 'no' })) as never)).rejects.toThrow(
      'ilegible'
    )
    await expect(
      fetchAlwaysRules(conn, { directory: '/a' }, (async () => new Response('<html>', { status: 200 })) as never)
    ).rejects.toThrow('ilegible')
  })

  it('DELETE: una sola regla por su id, con método y carpeta; 404 = ya no existía', async () => {
    const f = vi.fn(async () => json(200, true))
    expect(await revokeAlwaysRule(conn, { directory: '/a', id: 'ab12' }, f as never)).toEqual({ available: true, ok: true })
    const [url, init] = callsOf(f)[0]!
    expect(url).toBe(`http://127.0.0.1:4096/permission/siempre/ab12?directory=${encodeURIComponent('/a')}`)
    expect(init!.method).toBe('DELETE')
    expect(await revokeAlwaysRule(conn, { directory: '/a', id: 'x' }, (async () => json(404, {})) as never)).toEqual({
      available: true,
      ok: false
    })
    await expect(revokeAlwaysRule(conn, { directory: '/a', id: 'x' }, (async () => json(500, {})) as never)).rejects.toThrow('500')
  })

  it('DELETE: un id raro ni siquiera llega a la red', async () => {
    const f = vi.fn()
    for (const id of ['', '../x', 'a/b', 'a?b', 'a\nb'])
      await expect(revokeAlwaysRule(conn, { directory: '/a', id }, f as never)).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })
})
