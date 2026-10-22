/**
 * Modo automático: nunca aprueba solo una petición de una HIJA (subagente). Lo que pide la raíz y la
 * política permiten se sigue aprobando igual que antes; la misma petición desde una hija queda
 * pendiente para la persona (no se responde al motor). `task` y el resto de NEVER_ALONE siguen
 * sin aprobarse ni desde la raíz.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutoApprover, type AutoServer } from './auto-approver'

const server: AutoServer = { folder: '/work/f', fullAccess: false, baseUrl: 'http://127.0.0.1:1', authorization: 'Basic x' }
let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-auto-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

type P = { id: string; sessionID: string; permission: string; patterns: string[] }

function make(opts: { sessions: Record<string, string | undefined>; pending?: P[] }) {
  const replies: string[] = []
  const grants: string[] = []
  const fetchFn = (async (input: string, init?: { method?: string }) => {
    const u = new URL(String(input))
    const sm = /^\/session\/([^/]+)$/.exec(u.pathname)
    if (sm) {
      const id = decodeURIComponent(sm[1])
      if (!(id in opts.sessions)) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify({ id, parentID: opts.sessions[id] }), { status: 200 })
    }
    if (u.pathname === '/permission' && !init?.method) return new Response(JSON.stringify(opts.pending ?? []), { status: 200 })
    const rm = /^\/permission\/([^/]+)\/reply$/.exec(u.pathname)
    if (rm && init?.method === 'POST') {
      replies.push(decodeURIComponent(rm[1]))
      return new Response('true', { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  const a = new AutoApprover({
    file: join(dir, 'tasks-auto.json'),
    fetch: fetchFn,
    mcpServers: () => ['notas'],
    policyDisabled: () => false,
    onApproved: () => {},
    servers: () => [server],
    grantAutoView: (_s, ids) => void grants.push(...ids),
    revokeAutoView: () => {}
  })
  a.set({ enabled: true, folder: { path: server.folder, on: true }, viewApps: ['com.apple.finder'] })
  return { a, replies, grants }
}

const ls = (id: string, sessionID: string): P => ({ id, sessionID, permission: 'bash', patterns: ['ls -la'] })
const sessions = { root: undefined, kid: 'root', grandkid: 'kid' }

describe('AutoApprover: peticiones de hijas', () => {
  it('la raíz con una petición permitida (bash de solo lectura) se sigue aprobando', async () => {
    const m = make({ sessions })
    await m.a.considerPermissions(server, [ls('r1', 'root')])
    expect(m.replies).toEqual(['r1'])
  })

  it('la MISMA petición desde una hija o una nieta queda pendiente (no se responde al motor)', async () => {
    const m = make({ sessions })
    await m.a.considerPermissions(server, [ls('k1', 'kid'), ls('g1', 'grandkid')])
    expect(m.replies).toEqual([])
    expect(m.a.state().log).toEqual([])
  })

  it('también por la vía rápida considerOne', async () => {
    const m = make({ sessions, pending: [ls('k2', 'kid'), ls('r2', 'root')] })
    expect(await m.a.considerOne(server.folder, false, 'k2')).toBe(false)
    expect(await m.a.considerOne(server.folder, false, 'r2')).toBe(true)
    expect(m.replies).toEqual(['r2'])
  })

  it('MCP de solo lectura marcado: la raíz sí, la hija no', async () => {
    const m = make({ sessions })
    await m.a.considerPermissions(server, [
      { id: 'm1', sessionID: 'root', permission: 'notas_list', patterns: ['*'] },
      { id: 'm2', sessionID: 'kid', permission: 'notas_list', patterns: ['*'] }
    ])
    expect(m.replies).toEqual(['m1'])
  })

  it('si la raíz no se puede resolver (el motor no devuelve la sesión), no se aprueba', async () => {
    const m = make({ sessions: {} })
    await m.a.considerPermissions(server, [ls('x1', 'fantasma')])
    expect(m.replies).toEqual([])
  })

  it('task, edit, write, web y external_directory no se aprueban solos ni desde la raíz', async () => {
    const m = make({ sessions })
    const never = ['task', 'edit', 'write', 'webfetch', 'websearch', 'external_directory', 'doom_loop', 'computer_click', 'browser_open']
    await m.a.considerPermissions(
      server,
      never.map((permission, i) => ({ id: `n${i}`, sessionID: 'root', permission, patterns: ['*'] }))
    )
    expect(m.replies).toEqual([])
  })

  it('acceso a apps «Solo ver»: la raíz se concede, una hija no', async () => {
    const m = make({ sessions })
    const full = { ...server, fullAccess: true }
    const a2 = new AutoApprover({
      file: join(dir, 'b.json'),
      fetch: (async (input: string) => {
        const id = decodeURIComponent(new URL(String(input)).pathname.split('/').pop() ?? '')
        return new Response(JSON.stringify({ id, parentID: sessions[id as keyof typeof sessions] }), { status: 200 })
      }) as unknown as typeof fetch,
      mcpServers: () => [],
      policyDisabled: () => false,
      onApproved: () => {},
      servers: () => [full],
      grantAutoView: (_s, ids) => void m.grants.push(...ids),
      revokeAutoView: () => {}
    })
    a2.set({ enabled: true, folder: { path: full.folder, on: true }, viewApps: ['com.apple.finder'] })
    const apps = [{ bundleId: 'com.apple.finder', name: 'Finder', requested: 'view' as const }]
    expect(await a2.considerAccess({ sessionId: 'kid', apps, kind: 'access' })).toBeNull()
    expect(m.grants).toEqual([])
    expect(await a2.considerAccess({ sessionId: 'root', apps, kind: 'access' })).not.toBeNull()
    expect(m.grants).toEqual(['com.apple.finder'])
  })
})
