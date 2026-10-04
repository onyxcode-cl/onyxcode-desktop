import { afterEach, describe, expect, it } from 'vitest'
import { EmbeddedBrowserMcpServer } from './mcp-server'

/** F8-B69 (hallazgo 10): los tokens del MCP del navegador se revocan y no se acumulan. */
describe('EmbeddedBrowserMcpServer: ciclo de vida del token', () => {
  const servers: EmbeddedBrowserMcpServer[] = []
  afterEach(() => {
    servers.length = 0
  })

  async function setup(): Promise<{ s: EmbeddedBrowserMcpServer; call: (token: string) => Promise<number> }> {
    const s = new EmbeddedBrowserMcpServer()
    servers.push(s)
    const call = async (token: string): Promise<number> => {
      const port = s.currentPort()!
      const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
      })
      return r.status
    }
    return { s, call }
  }
  const tokenOf = (cfg: Record<string, unknown> | null): string => (cfg!.headers as { Authorization: string }).Authorization.slice(7)

  it('un token revocado deja de autenticar', async () => {
    const { s, call } = await setup()
    const cfg = await s.configFor({ product: 'tasks', folder: '/tmp/a', sandboxed: true })
    const token = tokenOf(cfg)
    expect(await call(token)).toBe(200)
    expect(s.revokeToken(token)).toBe(true)
    expect(await call(token)).toBe(401)
    expect(s.revokeToken(token)).toBe(false)
  })

  it('un servidor que se relanza con la misma atadura invalida el token anterior', async () => {
    const { s, call } = await setup()
    const first = tokenOf(await s.configFor({ product: 'tasks', folder: '/tmp/a', sandboxed: true }))
    const other = tokenOf(await s.configFor({ product: 'tasks', folder: '/tmp/b', sandboxed: true }))
    const second = tokenOf(await s.configFor({ product: 'tasks', folder: '/tmp/a', sandboxed: true }))
    expect(await call(first)).toBe(401)
    expect(await call(second)).toBe(200)
    expect(await call(other)).toBe(200)
  })

  it('knownTokens conserva los emitidos (para el redactor) aunque estén revocados', async () => {
    const { s } = await setup()
    const t1 = tokenOf(await s.configFor({ product: 'code', folder: null, sandboxed: false }))
    s.revokeToken(t1)
    expect(s.knownTokens()).toContain(t1)
  })
})
