/**
 * F8-B79, verificación con el sandbox REAL y el binario de OpenCode REAL, SIN modelos ni Electron: se lanza
 * `startTasksServer` (Seatbelt + `opencode serve` con HOME/XDG aislados) con la configuración MCP generada para el
 * sandbox. Comprueba que (1) el entorno real del proceso (`ps eww`) y su configuración no contienen el secreto,
 * (2) el servidor sandboxeado SÍ conecta con los MCP a través del proxy y el servidor MCP simulado recibe el secreto
 * real, (3) el sandbox no puede hablar directamente con el servidor MCP y (4) al parar no quedan procesos ni puertos.
 * Se salta si no hay binario de OpenCode (resources/opencode-bin/bin/opencode) o no es macOS.
 */
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
// Carpeta de config vacía: el plugin del motor (`@opencode-ai/plugin`) se instalaría por red (denegada en el sandbox)
// y es ajeno a lo que se prueba aquí. El resto del mecanismo (Seatbelt, entorno mínimo, proxies) es el real.
vi.mock('./opencode-config', () => ({
  getOpencodeEnv: () => ({
    OPENCODE_CONFIG_DIR: join(state.userData, 'opencode-config'),
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    XDG_DATA_HOME: join(state.userData, 'opencode-data')
  })
}))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => process.cwd(), isPackaged: false, getVersion: () => '0.0.0' }
}))

import { buildInlineConfig } from './inline-config'
import { McpProxy } from './mcp-proxy'
import { sandboxKey, startTasksServer, type TasksServerHandle } from './sandbox'
import { buildSandboxProfile } from './sandbox-profile'

const execFileP = promisify(execFile)
const BIN = resolve(process.cwd(), 'resources/opencode-bin/bin/opencode')
const HAS_BIN = existsSync(BIN)
const REAL = 'Bearer SECRETO-REAL-USUARIO-7c1d9e30aa55'
const BROWSER = 'TOKEN-NAVEGADOR-REAL-77aa11bb22cc33dd44ee55ff66'

interface Seen {
  auth: string | undefined
  method: string
  body: string
}

function mcpServer(seen: Seen[], expectAuth: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      seen.push({ auth: req.headers.authorization, method: req.method ?? '', body })
      if (req.headers.authorization !== expectAuth) {
        res.writeHead(401).end()
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const msg = JSON.parse(body || '{}') as { id?: number; method?: string; params?: { protocolVersion?: string } }
      const json = (result: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
      }
      if (msg.method === 'initialize') {
        json({
          protocolVersion: msg.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake', version: '1' }
        })
      } else if (msg.method === 'tools/list') {
        json({ tools: [{ name: 'hola', description: 'saluda', inputSchema: { type: 'object', properties: {} } }] })
      } else if (msg.id === undefined) {
        res.writeHead(202).end()
      } else {
        json({})
      }
    })
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: (server.address() as { port: number }).port })))
}

describe.skipIf(!macOnly || !HAS_BIN)('sandbox real + opencode real: el proxy MCP', () => {
  let root: string
  let handle: TasksServerHandle | null = null
  let proxy: McpProxy | null = null
  let ps1: Server
  let ps2: Server
  const browserSeen: Seen[] = []
  const userSeen: Seen[] = []
  let config = ''
  let proxyPort = 0
  let browserPort = 0
  let userPort = 0
  let statusJson: Record<string, { status: string }> = {}
  let envDump = ''
  let pid = 0
  const prevBin = process.env.OPENCODE_BIN
  const prevDisclaim = process.env.ONYXCODE_NO_DISCLAIM

  beforeAll(async () => {
    process.env.OPENCODE_BIN = BIN
    // Sin el lanzador `onyxcode-disclaim` (ajeno a lo que se prueba; se cuelga bajo un arnés ya sandboxeado).
    process.env.ONYXCODE_NO_DISCLAIM = '1'
    root = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-mcpreal-')))
    state.userData = join(root, 'userData')
    mkdirSync(join(state.userData, 'opencode-config'), { recursive: true })
    writeFileSync(join(state.userData, 'opencode-config', '.gitignore'), 'node_modules\n')
    const folder = join(root, 'folder')
    mkdirSync(folder, { recursive: true })

    const b = await mcpServer(browserSeen, `Bearer ${BROWSER}`)
    const u = await mcpServer(userSeen, REAL)
    ps1 = b.server
    ps2 = u.server
    browserPort = b.port
    userPort = u.port

    proxy = new McpProxy()
    proxyPort = await proxy.start()
    const px = proxy
    const browser = px.addRoute({
      name: 'browser',
      url: `http://127.0.0.1:${browserPort}/mcp`,
      headers: { Authorization: `Bearer ${BROWSER}` }
    })
    const gh = px.addRoute({ name: 'gh', url: `http://127.0.0.1:${userPort}/mcp`, headers: { Authorization: REAL } })
    config = JSON.stringify(
      buildInlineConfig({
        fullAccess: false,
        extras: [],
        browserMcp: { type: 'remote', url: browser.url, headers: browser.headers, oauth: false, enabled: true, timeout: 15000 },
        computerMcp: null,
        mcpContribution: { mcp: { gh: { type: 'remote', url: gh.url, headers: gh.headers, oauth: false, enabled: true } }, permission: {} },
        rulesPermission: {},
        skills: {}
      })
    )
    handle = await startTasksServer(folder, {
      isolation: { privateDir: join(state.userData, 'tasks-sandbox', sandboxKey(folder)), userData: state.userData },
      extraEnv: { OPENCODE_CONFIG_CONTENT: config },
      extraOutboundPorts: [proxyPort],
      networkAllowlist: () => []
    })
    pid = handle.pid!
    const r = await fetch(`${handle.baseUrl}/mcp`, {
      headers: { authorization: handle.authorization },
      signal: AbortSignal.timeout(20_000)
    })
    statusJson = (await r.json()) as typeof statusJson
    const ps = spawnSync('/bin/ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 10_000 })
    envDump = `${ps.stdout}${ps.stderr}`
  }, 90_000)

  afterAll(async () => {
    await handle?.stop().catch(() => undefined)
    await proxy?.stop()
    for (const s of [ps1, ps2]) {
      s?.closeAllConnections()
      s?.close()
    }
    if (prevDisclaim === undefined) delete process.env.ONYXCODE_NO_DISCLAIM
    else process.env.ONYXCODE_NO_DISCLAIM = prevDisclaim
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    rmSync(root, { recursive: true, force: true })
  })

  it('el entorno real de `opencode serve` (ps eww) y su configuración no contienen ningún secreto', () => {
    expect(envDump).toContain('OPENCODE_CONFIG_CONTENT')
    expect(envDump).toContain(`127.0.0.1:${proxyPort}`)
    for (const s of [REAL, REAL.slice(7), BROWSER]) {
      expect(envDump, s).not.toContain(s)
      expect(config, s).not.toContain(s)
    }
    // el puerto real del MCP del navegador tampoco está en la configuración del sandbox
    expect(config).not.toContain(`127.0.0.1:${browserPort}`)
    expect(config).not.toContain(`127.0.0.1:${userPort}`)
  })

  it('el servidor sandboxeado conecta con los MCP a través del proxy y el servidor MCP recibe el secreto real', () => {
    expect(statusJson.browser?.status).toBe('connected')
    expect(statusJson.gh?.status).toBe('connected')
    expect(browserSeen.length).toBeGreaterThan(0)
    expect(userSeen.length).toBeGreaterThan(0)
    expect(browserSeen.every((s) => s.auth === `Bearer ${BROWSER}`)).toBe(true)
    expect(userSeen.every((s) => s.auth === REAL)).toBe(true)
    expect(userSeen.some((s) => s.body.includes('tools/list'))).toBe(true)
  })

  it('dentro del sandbox (mismo perfil de red) el puerto real de cada MCP no es alcanzable; el del proxy sí', async () => {
    const profile = buildSandboxProfile({
      folder: join(root, 'folder'),
      privateDir: join(state.userData, 'tasks-sandbox', 'probe'),
      userData: state.userData,
      allowedOutboundPorts: [proxyPort],
      serverPort: 45999
    })
    // Asíncrono: los servidores simulados viven en este mismo proceso y `spawnSync` los bloquearía.
    const probe = async (sandboxed: boolean, port: number, headers: string[] = []): Promise<string> => {
      const curl = [
        '/usr/bin/curl',
        '-s',
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        '-m',
        '4',
        '-X',
        'POST',
        '-d',
        '{}',
        ...headers.flatMap((h) => ['-H', h]),
        `http://127.0.0.1:${port}/mcp`
      ]
      const argv = sandboxed ? ['/usr/bin/sandbox-exec', '-p', profile, ...curl] : curl
      return (
        await execFileP(argv[0], argv.slice(1), { timeout: 15_000 }).then(
          (r) => r.stdout,
          (e: { stdout?: string }) => e.stdout ?? ''
        )
      ).trim()
    }
    // Controles: fuera del sandbox ambos MCP responden (401 sin credencial).
    expect(await probe(false, userPort)).toBe('401')
    expect(await probe(false, browserPort)).toBe('401')
    // Dentro: el sandbox no llega a ninguno (Seatbelt solo abre el puerto del proxy)...
    expect(await probe(true, userPort)).toBe('000')
    expect(await probe(true, browserPort)).toBe('000')
    // ...y el proxy rechaza a quien no lleve un token de sesión válido.
    expect(await probe(true, proxyPort)).toBe('401')
    expect(await probe(true, proxyPort, ['Authorization: Bearer ' + REAL.slice(7)])).toBe('401')
  })

  it('al parar no quedan procesos ni puertos', async () => {
    const h = handle!
    await h.stop()
    handle = null
    const alive = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid='], { encoding: 'utf8' }).stdout.trim()
    expect(alive).toBe('')
    await proxy!.stop()
    await expect(fetch(`http://127.0.0.1:${proxyPort}/mcp`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
  })
})
