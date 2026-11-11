/**
 * REAL (macOS): el motor de Tareas encerrado con el perfil de verdad (`buildSandboxProfile`, `sandbox-exec -p`, `sandboxEnv`) y
 * el `rg` INCLUIDO en su PATH (1.8.17). Antes el motor no hallaba `rg`, intentaba bajarlo de github.com («downloading ripgrep»), el encierro
 * lo impedía y fallaban `grep`, `glob` y la herramienta que carga las skills («ripgrep execution failed»).
 *
 * Se omite si no hay macOS con `sandbox-exec`, el `rg` fijado (`npm run fetch:ripgrep`) o un motor (`LAZUNOX_REAL_ENGINE`, o
 * `resources/opencode-bin/bin/opencode` si existe). Proveedor de modelo FALSO en 127.0.0.1 (sin red real, sin claves). Carpeta de tarea
 * y HOME de prueba, todo temporal; el motor se mata por PID al terminar.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as httpServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import { seedConfigModels } from './models-cache'
import { ensureEngineGitignore } from './private-dir'
import { ripgrepPathEnv } from './ripgrep-runtime'
import { buildSandboxProfile, sandboxDirs, sandboxEnv } from './sandbox-profile'

const RG = join(process.cwd(), 'resources', 'ripgrep-bin', 'bin', 'rg')
const ENGINE = process.env.LAZUNOX_REAL_ENGINE ?? join(process.cwd(), 'resources', 'opencode-bin', 'bin', 'opencode')
const CONFIG = join(process.cwd(), 'resources', 'opencode')
const ENABLED = macOnly && existsSync('/usr/bin/sandbox-exec') && existsSync(RG) && existsSync(ENGINE)

interface Outcome {
  skills: string[]
  /** Proveedores que el motor conoce (`GET /provider`, campo `all`) con sus modelos. */
  providers: Record<string, string[]>
  /** Lo que quedó en la caché privada de la tarea (`cache/opencode`). */
  privateCache: string[]
  findStatus: number
  findBody: string
  skillTool: { status?: string; text: string }
  log: string
}

const servers: Server[] = []
const temps: string[] = []
const pids: number[] = []
afterAll(() => {
  for (const pid of pids) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* ya terminó */
    }
  }
  for (const s of servers) s.close()
  for (const d of temps) rmSync(d, { recursive: true, force: true })
})

/** Modelo falso: primero pide cargar la skill `xlsx`; con el resultado de la herramienta responde «listo». */
function fakeModel(): Promise<number> {
  const server = httpServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      let j: { messages?: Array<{ role: string }>; tools?: Array<{ function?: { name?: string } }> } = {}
      try {
        j = JSON.parse(body)
      } catch {
        /* vacío */
      }
      const send = (o: unknown): boolean => res.write('data: ' + JSON.stringify(o) + '\n\n')
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const hasTool = (j.tools ?? []).some((t) => t.function?.name === 'skill')
      const hasResult = (j.messages ?? []).some((m) => m.role === 'tool')
      const chunk = (choice: unknown): unknown => ({
        id: 'c',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, ...(choice as object) }]
      })
      if (!hasResult && hasTool) {
        send(
          chunk({
            delta: {
              role: 'assistant',
              tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'skill', arguments: '{"name":"xlsx"}' } }]
            }
          })
        )
        send(chunk({ delta: {}, finish_reason: 'tool_calls' }))
      } else {
        send(chunk({ delta: { role: 'assistant', content: 'listo' } }))
        send(chunk({ delta: {}, finish_reason: 'stop' }))
      }
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  servers.push(server)
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok((server.address() as { port: number }).port)))
}

const freePort = (): Promise<number> =>
  new Promise((ok) => {
    const s = httpServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => ok(p))
    })
  })

/** Catálogo como lo deja la app desde 1.8.18: `seedConfigModels` a la config + `OPENCODE_MODELS_PATH`; `fetch` = sin `OPENCODE_DISABLE_MODELS_FETCH`. */
type CatalogMode = 'none' | 'config' | 'config-fetch'

async function scenario(withRg: boolean, catalog: CatalogMode = 'none'): Promise<Outcome> {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-rgreal-')))
  temps.push(tmp)
  const home = join(tmp, 'home')
  const userData = join(tmp, 'userData')
  const folder = join(tmp, 'carpeta')
  const privateDir = join(userData, 'tasks-sandbox', 'abc')
  const configDir = join(userData, 'opencode-config')
  const dirs = sandboxDirs(privateDir)
  for (const d of [home, folder, dirs.config, dirs.data, dirs.cache, dirs.state, dirs.tmp]) mkdirSync(d, { recursive: true })
  // Config privada del motor con su `.gitignore`, como la deja la app (1.8.19: el perfil la deja de solo lectura desde dentro).
  mkdirSync(join(dirs.config, 'opencode'), { recursive: true })
  ensureEngineGitignore(join(dirs.config, 'opencode'))
  writeFileSync(join(folder, 'hola.txt'), 'palabra-unica-xyz\n')
  // Copia de las skills y agentes de la app, con el `.gitignore` que la app deja (el perfil solo da lectura a esta carpeta).
  spawnSync('cp', ['-R', CONFIG, configDir])
  writeFileSync(join(configDir, '.gitignore'), 'node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n')
  let modelsPath: string | null = null
  if (catalog !== 'none') {
    // Caché del motor PRINCIPAL (fuera del encierro) con un catálogo mínimo; la app lo copia a la config (de solo lectura dentro).
    const mainCache = join(tmp, 'cache-principal')
    mkdirSync(mainCache, { recursive: true })
    writeFileSync(
      join(mainCache, 'models.json'),
      JSON.stringify({
        'catalogo-prueba': {
          id: 'catalogo-prueba',
          name: 'Catálogo de prueba',
          env: ['CATALOGO_PRUEBA_KEY'],
          npm: '@ai-sdk/openai-compatible',
          api: 'http://127.0.0.1:9/v1',
          models: {
            'modelo-del-catalogo': {
              id: 'modelo-del-catalogo',
              name: 'Modelo del catálogo',
              release_date: '2026-01-01',
              attachment: false,
              reasoning: false,
              temperature: true,
              tool_call: true,
              limit: { context: 100000, output: 4000 },
              cost: { input: 0, output: 0 },
              options: {}
            }
          }
        }
      })
    )
    modelsPath = seedConfigModels(configDir, mainCache)
  }
  const fakePort = await fakeModel()
  const port = await freePort()
  const profile = buildSandboxProfile({
    folder,
    privateDir,
    userData,
    home,
    readOnly: [configDir],
    serverPort: port,
    allowedOutboundPorts: [fakePort]
  })
  const user = 'tasks'
  const pass = randomBytes(12).toString('base64url')
  const basePath = '/usr/bin:/bin:/usr/sbin:/sbin'
  const env = {
    // El PATH como lo arma la app para el encierro: con `rg` incluido primero, o el mínimo de antes.
    PATH: withRg ? ripgrepPathEnv(RG, basePath, 'darwin').PATH : basePath,
    HOME: home,
    LANG: 'en_US.UTF-8',
    ...sandboxEnv(dirs),
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_SERVER_USERNAME: user,
    OPENCODE_SERVER_PASSWORD: pass,
    LAZUNOX_TASKS_FOLDER: folder,
    ...(modelsPath ? { OPENCODE_MODELS_PATH: modelsPath } : {}),
    ...(catalog === 'config' ? { OPENCODE_DISABLE_MODELS_FETCH: '1' } : {}),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      permission: { '*': 'allow' },
      provider: {
        fake: {
          npm: '@ai-sdk/openai-compatible',
          name: 'fake',
          options: { baseURL: `http://127.0.0.1:${fakePort}/v1`, apiKey: 'x' },
          models: { m: { name: 'm', tool_call: true, limit: { context: 100000, output: 4000 } } }
        }
      }
    })
  }
  let log = ''
  const child = spawn(
    '/usr/bin/sandbox-exec',
    ['-p', profile, ENGINE, 'serve', '--port', String(port), '--hostname', '127.0.0.1', '--print-logs'],
    {
      cwd: folder,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    }
  )
  if (child.pid) pids.push(child.pid)
  child.stdout?.on('data', (d) => (log += d.toString()))
  child.stderr?.on('data', (d) => (log += d.toString()))
  const headers = {
    authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
    'x-opencode-directory': folder,
    'content-type': 'application/json'
  }
  const url = (p: string): string => `http://127.0.0.1:${port}${p}`
  try {
    for (let i = 0; i < 100; i++) {
      const ok = await fetch(url('/global/health'), { headers })
        .then((r) => r.ok)
        .catch(() => false)
      if (ok) break
      await new Promise((r) => setTimeout(r, 300))
    }
    const skills = ((await fetch(url('/skill'), { headers }).then((r) => r.json())) as Array<{ name: string }>).map((s) => s.name)
    const prov = (await fetch(url('/provider'), { headers })
      .then((r) => r.json())
      .catch(() => ({ all: [] }))) as { all?: Array<{ id: string; models?: Record<string, unknown> }> }
    const providers = Object.fromEntries((prov.all ?? []).map((p) => [p.id, Object.keys(p.models ?? {})]))
    const find = await fetch(url('/find?pattern=palabra-unica-xyz'), { headers })
    const findBody = await find.text()
    const ses = (await fetch(url('/session'), { method: 'POST', headers, body: '{}' }).then((r) => r.json())) as { id: string }
    await fetch(url(`/session/${ses.id}/message`), {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: { providerID: 'fake', modelID: 'm' }, parts: [{ type: 'text', text: 'carga la skill xlsx' }] }),
      signal: AbortSignal.timeout(90_000)
    })
    const msgs = (await fetch(url(`/session/${ses.id}/message`), { headers }).then((r) => r.json())) as Array<{
      parts?: Array<{ type: string; tool?: string; state?: { status?: string; output?: string; error?: string } }>
    }>
    const part = msgs.flatMap((m) => m.parts ?? []).find((p) => p.type === 'tool' && p.tool === 'skill')
    await new Promise((r) => setTimeout(r, 500))
    let privateCache: string[] = []
    try {
      privateCache = readdirSync(join(dirs.cache, 'opencode'))
    } catch {
      privateCache = []
    }
    return {
      skills,
      providers,
      privateCache,
      findStatus: find.status,
      findBody,
      skillTool: { status: part?.state?.status, text: String(part?.state?.output ?? part?.state?.error ?? '') },
      log
    }
  } finally {
    try {
      process.kill(-(child.pid as number), 'SIGKILL')
    } catch {
      /* ya terminó */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

describe.skipIf(!ENABLED)('Tareas (Seatbelt real): el motor usa el rg incluido y el catálogo de la config, y no descarga nada', () => {
  it('CONTROL, sin rg en el PATH: intenta bajarlo, la búsqueda y la carga de la skill fallan', async () => {
    const o = await scenario(false)
    expect(o.log).toContain('downloading ripgrep')
    expect(o.findStatus).toBe(500)
    expect(o.skillTool.status).toBe('error')
    expect(o.skillTool.text).toContain('ripgrep execution failed')
  }, 180_000)

  it('con el rg incluido en el PATH: no descarga, las skills aparecen, la búsqueda y la carga de la skill funcionan', async () => {
    const o = await scenario(true)
    expect(o.log).not.toContain('downloading ripgrep')
    expect(o.log).not.toContain('github.com')
    expect(o.skills).toContain('xlsx')
    expect(o.findStatus).toBe(200)
    expect(o.findBody).toContain('hola.txt')
    expect(o.skillTool.status).toBe('completed')
    expect(o.skillTool.text).toContain('<skill_content name="xlsx">')
    expect(o.skillTool.text).toContain('<skill_files>')
  }, 180_000)

  it('CONTROL, catálogo en la config SIN OPENCODE_DISABLE_MODELS_FETCH: el motor intenta bajar el catálogo de models.dev', async () => {
    const o = await scenario(true, 'config-fetch')
    expect(o.providers['catalogo-prueba']).toContain('modelo-del-catalogo')
    expect(o.log).toContain('models.dev')
  }, 180_000)

  it('catálogo en la config como lanza la app (1.8.18): lista sus modelos, busca, carga la skill, no descarga ni escribe su caché', async () => {
    const o = await scenario(true, 'config')
    expect(o.providers['catalogo-prueba']).toContain('modelo-del-catalogo')
    expect(o.log).not.toContain('downloading ripgrep')
    expect(o.log).not.toContain('models.dev')
    expect(o.privateCache).not.toContain('models.json')
    expect(o.findStatus).toBe(200)
    expect(o.findBody).toContain('hola.txt')
    expect(o.skills).toContain('xlsx')
    expect(o.skillTool.status).toBe('completed')
    expect(o.skillTool.text).toContain('<skill_content name="xlsx">')
  }, 180_000)
})
