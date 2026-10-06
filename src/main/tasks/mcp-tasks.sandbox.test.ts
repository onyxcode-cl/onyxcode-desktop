/**
 * F8-B79 (hallazgo 6): los secretos de los MCP no llegan al entorno ni a la configuración del servidor sandboxeado.
 * Incluye lectura REAL de `ps eww` de un proceso lanzado con ese entorno (el ataque del agente: leer el `environ`
 * de `opencode serve`). El control (modo sin proxy = comportamiento anterior) DEMUESTRA que el ataque funcionaba.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData, getAppPath: () => process.cwd(), isPackaged: false } }))

import { buildInlineConfig } from './inline-config'
import { McpProxy } from './mcp-proxy'
import { tasksMcpContribution, TasksMcpPrefs } from './mcp-tasks'

const S = {
  remoteAuth: 'Bearer TOKEN-REMOTO-usuario-9f3a1c7d',
  remoteKey: 'CLAVE-X-API-usuario-b27e55a0',
  localEnv: 'TOKEN-LOCAL-ENV-usuario-5d0c88e1',
  browser: 'TOKEN-NAVEGADOR-REAL-0a1b2c3d4e5f60718293a4b5c6d7e8f90123456789'
}
const ALL_SECRETS = [S.remoteAuth, S.remoteAuth.slice(7), S.remoteKey, S.localEnv, S.browser]

let root: string
let proxy: McpProxy | null = null
const procs: ChildProcess[] = []

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lazunox-mcpsb-'))
  state.userData = root
  mkdirSync(join(root, 'opencode'), { recursive: true })
  writeFileSync(
    join(root, 'opencode', 'opencode.json'),
    JSON.stringify({
      mcp: {
        gh: {
          type: 'remote',
          url: 'https://api.mcp-prueba.test/mcp?k=q',
          headers: { Authorization: S.remoteAuth, 'X-Api-Key': S.remoteKey }
        },
        publico: { type: 'remote', url: 'https://publico.test/mcp', oauth: false },
        oa: { type: 'remote', url: 'https://oauth.test/mcp', oauth: { clientId: 'cid', clientSecret: 'CLIENT-SECRET-oauth-1234' } },
        loc: { type: 'local', command: ['npx', 'mcp-x'], environment: { API_TOKEN: S.localEnv } },
        locsin: { type: 'local', command: ['npx', 'mcp-y'] }
      }
    })
  )
  writeFileSync(
    join(root, 'tasks-mcp.json'),
    JSON.stringify({
      servers: Object.fromEntries(['gh', 'publico', 'oa', 'loc', 'locsin'].map((n) => [n, { tasks: true, askEachTool: n === 'gh' }]))
    })
  )
})
afterEach(async () => {
  for (const p of procs.splice(0)) if (p.pid) p.kill('SIGKILL')
  await proxy?.stop()
  proxy = null
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

async function sandboxConfig(): Promise<{ json: string; blocked: string[]; hosts: string[]; contributionMcp: Record<string, unknown> }> {
  proxy = new McpProxy()
  await proxy.start()
  const px = proxy
  const browser = px.addRoute({ name: 'browser', url: 'http://127.0.0.1:9/mcp', headers: { Authorization: `Bearer ${S.browser}` } })
  const c = tasksMcpContribution({ sandboxed: true, registerRoute: (spec) => px.addRoute(spec) })
  const cfg = buildInlineConfig({
    fullAccess: false,
    extras: [],
    browserMcp: { type: 'remote', url: browser.url, headers: browser.headers, oauth: false, enabled: true },
    computerMcp: null,
    mcpContribution: c,
    rulesPermission: {},
    skills: {}
  })
  return { json: JSON.stringify(cfg), blocked: c.blocked, hosts: c.hosts, contributionMcp: c.mcp }
}

describe('configuración MCP del servidor sandboxeado', () => {
  it('no contiene ningún secreto real: ni token del navegador, ni cabeceras, ni variables, ni clientSecret', async () => {
    const { json } = await sandboxConfig()
    for (const s of ALL_SECRETS) expect(json, s).not.toContain(s)
    expect(json).not.toContain('CLIENT-SECRET-oauth-1234')
    expect(json).not.toContain('?k=q')
  })

  it('los MCP remotos con cabeceras van por el proxy (URL loopback + token de sesión) y conservan «preguntar»', async () => {
    const { json, contributionMcp } = await sandboxConfig()
    const cfg = JSON.parse(json) as {
      mcp: Record<string, { url: string; headers?: { Authorization: string } }>
      agent: { tasks: { permission: Record<string, string> } }
    }
    expect(cfg.mcp.gh.url).toBe(`http://127.0.0.1:${proxy!.port}/mcp`)
    expect(cfg.mcp.gh.headers?.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/)
    expect(cfg.mcp.browser.url).toBe(`http://127.0.0.1:${proxy!.port}/mcp`)
    expect(cfg.mcp.gh.headers?.Authorization).not.toBe(cfg.mcp.browser.headers?.Authorization)
    expect(cfg.agent.tasks.permission['gh_*']).toBe('ask')
    expect(Object.keys(contributionMcp).sort()).toEqual(['gh', 'locsin', 'oa', 'publico'])
  })

  it('un MCP local con variables secretas NO entra (falla cerrado) y se informa; el local sin variables sí', async () => {
    const { json, blocked } = await sandboxConfig()
    expect(blocked).toEqual(['loc'])
    expect(JSON.parse(json).mcp.loc).toBeUndefined()
    expect(JSON.parse(json).mcp.locsin.command.at(-1)).toBe('mcp-y')
  })

  it('sin proxy registrado, un remoto con cabeceras tampoco entra (nunca vuelve al texto plano)', () => {
    const c = tasksMcpContribution({ sandboxed: true })
    expect(c.blocked.sort()).toEqual(['gh', 'loc'])
    expect(JSON.stringify(c.mcp)).not.toContain(S.remoteAuth)
    expect(Object.keys(c.mcp).sort()).toEqual(['locsin', 'oa', 'publico'])
  })

  it('el host de un MCP proxificado no se suma a la red del sandbox (solo los remotos sin secretos)', async () => {
    const { hosts } = await sandboxConfig()
    expect(hosts.sort()).toEqual(['oauth.test', 'publico.test'])
  })

  it('Control total (sin sandbox) no cambia: sigue con la config tal cual', () => {
    const c = tasksMcpContribution({ sandboxed: false })
    expect(c.blocked).toEqual([])
    expect(JSON.stringify(c.mcp)).toContain(S.remoteAuth)
    expect(JSON.stringify(c.mcp)).toContain(S.localEnv)
  })

  it('la lista de Ajustes marca el local con secretos y no anuncia host de red para el proxificado', () => {
    const list = new TasksMcpPrefs().list()
    expect(list.find((i) => i.name === 'loc')?.localSecrets).toBe(true)
    expect(list.find((i) => i.name === 'locsin')?.localSecrets).toBeUndefined()
    expect(list.find((i) => i.name === 'gh')?.hosts).toEqual([])
    expect(list.find((i) => i.name === 'publico')?.hosts).toEqual(['publico.test'])
  })
})

/** Lo que haría el agente del sandbox: leer el entorno de OTRO proceso del mismo usuario con `ps eww`. */
function psEnv(pid: number): string {
  const r = spawnSync('/bin/ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 10_000 })
  return `${r.stdout}${r.stderr}`
}
async function launchWithEnv(config: string): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
    env: { PATH: process.env.PATH ?? '', OPENCODE_CONFIG_CONTENT: config },
    stdio: 'ignore'
  })
  procs.push(child)
  await new Promise((r) => setTimeout(r, 400))
  return child.pid!
}

describe.skipIf(!macOnly)('`ps eww` real del proceso lanzado con la configuración generada', () => {
  it('control (comportamiento anterior, sin proxy): el entorno SÍ revela los secretos', async () => {
    const c = tasksMcpContribution({ sandboxed: false })
    const raw = JSON.stringify(
      buildInlineConfig({
        fullAccess: false,
        extras: [],
        browserMcp: null,
        computerMcp: null,
        mcpContribution: c,
        rulesPermission: {},
        skills: {}
      })
    )
    const out = psEnv(await launchWithEnv(raw))
    expect(out).toContain(S.remoteAuth.slice(7))
    expect(out).toContain(S.localEnv)
  })

  it('con el proxy: ni un solo secreto aparece en `ps eww`, solo URL loopback y tokens de sesión', async () => {
    const { json } = await sandboxConfig()
    const out = psEnv(await launchWithEnv(json))
    expect(out).toContain('OPENCODE_CONFIG_CONTENT')
    expect(out).toContain(`127.0.0.1:${proxy!.port}`)
    for (const s of ALL_SECRETS) expect(out, s).not.toContain(s)
    expect(out).not.toContain('CLIENT-SECRET-oauth-1234')
  })
})
