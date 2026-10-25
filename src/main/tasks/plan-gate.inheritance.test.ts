/**
 * ZONA INTOCABLE (puerta del plan): herencia del plan en las hijas de `task`.
 *
 * Carga el código REAL de `planGatePluginSource()` (el mismo texto que se escribe en
 * `userData/opencode-config/plugins/lazunox-plan-gate.js`) y lo ejecuta con un cliente de motor y un
 * `/plan-status` simulados. Garantías que demuestra:
 *  - una hija hereda la aprobación de su RAÍZ (y solo la de la raíz);
 *  - una hija «aprobada» por sí misma no abre nada si la raíz no está aprobada;
 *  - sesión desconocida, ciclo, cadena demasiado profunda o error del motor → denegar;
 *  - revocar la raíz vuelve a bloquear a las hijas;
 *  - las herramientas de solo planificar siguen pasando sin plan; sin la variable el plugin no hace nada;
 *  - `lazunox_session` de `computer_*` sigue siendo la sesión que llama (no la raíz).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: {},
  app: { getPath: () => tmpdir(), getAppPath: () => process.cwd(), isPackaged: false, getVersion: () => '0.0.0' }
}))

import { PLAN_GATE_ALLOWED_TOOLS, PLAN_GATE_MAX_DEPTH, planGatePluginSource } from './opencode-config'

type Hook = (input: { tool: string; sessionID?: string }, output: { args: Record<string, unknown> }) => Promise<void>
interface Sessions {
  [id: string]: { id: string; parentID?: string } | undefined
}

let dir = ''
let counter = 0
const realFetch = globalThis.fetch

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-gate-'))
})
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.LAZUNOX_PLAN_GATE_URL
  rmSync(dir, { recursive: true, force: true })
})

/** Carga el plugin con `LAZUNOX_PLAN_GATE_URL` (o sin ella) y devuelve su gancho `tool.execute.before`. */
async function load(opts: {
  sessions: Sessions
  approved: Set<string>
  withUrl?: boolean
  clientShape?: 'path' | 'flat' | 'none'
  getFails?: boolean
}): Promise<{ before: Hook | undefined; queried: string[]; gets: string[] }> {
  const queried: string[] = []
  const gets: string[] = []
  if (opts.withUrl !== false) process.env.LAZUNOX_PLAN_GATE_URL = 'http://127.0.0.1:1/t0k3n'
  globalThis.fetch = (async (url: string) => {
    const u = new URL(String(url))
    expect(u.pathname.endsWith('/plan-status')).toBe(true)
    const session = u.searchParams.get('session') ?? ''
    queried.push(session)
    return new Response(JSON.stringify({ approved: opts.approved.has(session) }), { status: 200 })
  }) as typeof fetch
  const lookup = (id: string): { data?: unknown } => {
    gets.push(id)
    if (opts.getFails) throw new Error('motor caído')
    const s = opts.sessions[id]
    return s ? { data: s } : { data: undefined }
  }
  const client =
    opts.clientShape === 'none'
      ? {}
      : {
          session: {
            get: async (args: { sessionID?: string; path?: { id: string } }) => {
              if (opts.clientShape === 'flat') {
                if (!args.sessionID) return { data: undefined }
                return lookup(args.sessionID)
              }
              // forma real del motor 1.19 (verificada con el binario): { path: { id } }
              if (!args.path) return { data: undefined }
              return lookup(args.path.id)
            }
          }
        }
  const file = join(dir, `gate-${counter++}.mjs`)
  writeFileSync(file, planGatePluginSource(), 'utf8')
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    default: { id: string; server: (i: unknown) => Promise<Record<string, Hook>> }
  }
  const hooks = await mod.default.server({ client })
  return { before: hooks['tool.execute.before'], queried, gets }
}

const call = (before: Hook | undefined, tool: string, sessionID: string | undefined, args: Record<string, unknown> = {}) =>
  before!({ tool, sessionID }, { args })

describe('lazunox-plan-gate: herencia del plan por la raíz', () => {
  const tree: Sessions = {
    root: { id: 'root' },
    child: { id: 'child', parentID: 'root' },
    grand: { id: 'grand', parentID: 'child' },
    other: { id: 'other' },
    otherChild: { id: 'otherChild', parentID: 'other' }
  }

  it('sesión raíz aprobada: pasa bash; sin aprobar: se bloquea', async () => {
    const ok = await load({ sessions: tree, approved: new Set(['root']) })
    await expect(call(ok.before, 'bash', 'root')).resolves.toBeUndefined()
    const no = await load({ sessions: tree, approved: new Set() })
    await expect(call(no.before, 'bash', 'root')).rejects.toThrow(/plan aprobado/)
  })

  it('una hija hereda la aprobación de la raíz y la consulta se hace con el id de la RAÍZ', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root']) })
    await expect(call(g.before, 'bash', 'child')).resolves.toBeUndefined()
    await expect(call(g.before, 'edit', 'grand')).resolves.toBeUndefined()
    expect(new Set(g.queried)).toEqual(new Set(['root']))
  })

  it('una hija NO se aprueba sola: aprobada ella pero no la raíz, sigue bloqueada', async () => {
    const g = await load({ sessions: tree, approved: new Set(['child', 'grand']) })
    await expect(call(g.before, 'bash', 'child')).rejects.toThrow(/plan aprobado/)
    await expect(call(g.before, 'bash', 'grand')).rejects.toThrow(/plan aprobado/)
    // nunca se consultó el estado de la propia hija
    expect(g.queried.every((s) => s === 'root')).toBe(true)
  })

  it('no hereda de una raíz AJENA aprobada (otra tarea)', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root']) })
    await expect(call(g.before, 'bash', 'otherChild')).rejects.toThrow(/plan aprobado/)
    await expect(call(g.before, 'bash', 'other')).rejects.toThrow(/plan aprobado/)
  })

  it('sesión desconocida (el motor no la devuelve) = denegar, aunque exista una raíz aprobada', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root', 'ghost']) })
    await expect(call(g.before, 'bash', 'ghost')).rejects.toThrow(/plan aprobado/)
    expect(g.queried).not.toContain('ghost')
  })

  it('el padre apunta a una sesión que no existe = denegar', async () => {
    const g = await load({ sessions: { orphan: { id: 'orphan', parentID: 'missing' } }, approved: new Set(['missing', 'orphan']) })
    await expect(call(g.before, 'bash', 'orphan')).rejects.toThrow(/plan aprobado/)
  })

  it('el motor devuelve OTRA sesión distinta de la pedida = denegar', async () => {
    const g = await load({ sessions: { a: { id: 'b' } }, approved: new Set(['a', 'b']) })
    await expect(call(g.before, 'bash', 'a')).rejects.toThrow(/plan aprobado/)
  })

  it('ciclo imposible en la cadena de padres = denegar', async () => {
    const cyc: Sessions = { a: { id: 'a', parentID: 'b' }, b: { id: 'b', parentID: 'a' }, self: { id: 'self', parentID: 'self' } }
    const g = await load({ sessions: cyc, approved: new Set(['a', 'b', 'self']) })
    await expect(call(g.before, 'bash', 'a')).rejects.toThrow(/plan aprobado/)
    await expect(call(g.before, 'bash', 'self')).rejects.toThrow(/plan aprobado/)
  })

  it('cadena más profunda que el tope = denegar; justo en el tope = pasa', async () => {
    const chain: Sessions = { s0: { id: 's0' } }
    for (let i = 1; i <= PLAN_GATE_MAX_DEPTH + 2; i++) chain[`s${i}`] = { id: `s${i}`, parentID: `s${i - 1}` }
    const g = await load({ sessions: chain, approved: new Set(['s0']) })
    await expect(call(g.before, 'bash', `s${PLAN_GATE_MAX_DEPTH}`)).resolves.toBeUndefined()
    await expect(call(g.before, 'bash', `s${PLAN_GATE_MAX_DEPTH + 1}`)).rejects.toThrow(/plan aprobado/)
    await expect(call(g.before, 'bash', `s${PLAN_GATE_MAX_DEPTH + 2}`)).rejects.toThrow(/plan aprobado/)
  })

  it('error del motor al resolver (get lanza) = denegar, no «dejar pasar»', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root', 'child']), getFails: true })
    await expect(call(g.before, 'bash', 'child')).rejects.toThrow(/plan aprobado/)
    await expect(call(g.before, 'bash', 'root')).rejects.toThrow(/plan aprobado/)
  })

  it('sin sessionID = denegar', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root']) })
    await expect(call(g.before, 'bash', undefined)).rejects.toThrow(/plan aprobado/)
  })

  it('si /plan-status falla (red/HTTP) = denegar a la hija', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root']) })
    globalThis.fetch = (async () => {
      throw new Error('sin red')
    }) as typeof fetch
    // la caché de 250 ms puede tener la respuesta anterior: esperar a que caduque
    await new Promise((r) => setTimeout(r, 300))
    await expect(call(g.before, 'bash', 'child')).rejects.toThrow(/plan aprobado/)
  })

  it('revocar la raíz bloquea de nuevo a las hijas', async () => {
    const approved = new Set(['root'])
    const g = await load({ sessions: tree, approved })
    await expect(call(g.before, 'bash', 'child')).resolves.toBeUndefined()
    approved.delete('root')
    await new Promise((r) => setTimeout(r, 300)) // caduca la caché de estado (250 ms)
    await expect(call(g.before, 'bash', 'child')).rejects.toThrow(/plan aprobado/)
  })

  it('las herramientas de solo planificar pasan sin plan y sin consultar nada', async () => {
    const g = await load({ sessions: tree, approved: new Set() })
    for (const tool of PLAN_GATE_ALLOWED_TOOLS) await expect(call(g.before, tool, 'child')).resolves.toBeUndefined()
    expect(g.queried).toEqual([])
    expect(g.gets).toEqual([])
  })

  it('`tool_search` (solo lectura) pasa sin plan; `mcp_call` (ejecuta herramientas de conectores) NO: la puerta sigue bloqueándola', async () => {
    expect(PLAN_GATE_ALLOWED_TOOLS as readonly string[]).toContain('tool_search')
    expect(PLAN_GATE_ALLOWED_TOOLS as readonly string[]).not.toContain('mcp_call')
    const g = await load({ sessions: tree, approved: new Set() })
    await expect(call(g.before, 'tool_search', 'child')).resolves.toBeUndefined()
    await expect(call(g.before, 'mcp_call', 'root')).rejects.toThrow(/plan aprobado/)
    await expect(call(g.before, 'mcp_call', 'child')).rejects.toThrow(/plan aprobado/)
  })

  it('`task` y `execute` no están entre las herramientas libres: una hija sin plan de raíz no las usa', async () => {
    expect(PLAN_GATE_ALLOWED_TOOLS as readonly string[]).not.toContain('task')
    expect(PLAN_GATE_ALLOWED_TOOLS as readonly string[]).not.toContain('execute')
    const g = await load({ sessions: tree, approved: new Set() })
    await expect(call(g.before, 'task', 'root')).rejects.toThrow(/plan aprobado/)
    await expect(call(g.before, 'execute', 'child')).rejects.toThrow(/plan aprobado/)
  })

  it('computer_*: `lazunox_session` sigue siendo la sesión que llama (la hija), no la raíz', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root']) })
    const args: Record<string, unknown> = { lazunox_session: 'FALSO' }
    await call(g.before, 'computer_screenshot', 'child', args)
    expect(args.lazunox_session).toBe('child')
  })

  it('cliente con la forma plana ({ sessionID }) también resuelve la raíz', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root']), clientShape: 'flat' })
    await expect(call(g.before, 'bash', 'child')).resolves.toBeUndefined()
    await expect(call(g.before, 'bash', 'otherChild')).rejects.toThrow(/plan aprobado/)
  })

  it('sin `session.get` en el cliente: comportamiento anterior (la hija queda bloqueada, la raíz aprobada pasa)', async () => {
    const g = await load({ sessions: tree, approved: new Set(['root']), clientShape: 'none' })
    await expect(call(g.before, 'bash', 'root')).resolves.toBeUndefined()
    await expect(call(g.before, 'bash', 'child')).rejects.toThrow(/plan aprobado/)
  })

  it('sin LAZUNOX_PLAN_GATE_URL (sandbox / sidecar principal) el plugin no registra ganchos', async () => {
    const g = await load({ sessions: tree, approved: new Set(), withUrl: false })
    expect(g.before).toBeUndefined()
  })
})
