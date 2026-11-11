/**
 * H5 con el MOTOR REAL (binario publicado, sin modelos ni red): una carpeta de prueba trae un complemento (`.opencode/plugin`), una
 * herramienta (`.opencode/tool`) y un MCP local (`opencode.json`), y la config global privada del motor (`XDG_CONFIG_HOME/opencode`) trae
 * otro complemento. Todos son INOFENSIVOS: solo añaden una línea a `centinela.txt` dentro de la carpeta de prueba.
 *  - Control (como antes): el motor los carga y aparece el centinela. Así se sabe que la prueba mide algo.
 *  - Con el arreglo (`projectCodeEnv` + cuarentena + config inline de `buildInlineConfig`): el centinela NO aparece, y el texto de la carpeta
 *    (`AGENTS.md`, `.opencode/skills`) sigue llegando al motor.
 * Sin jaula (no hace falta para medir qué carga el motor). Solo con `LAZUNOX_H5_MOTOR=<ruta del binario opencode>`; si no, se salta.
 * Todo vive en una carpeta temporal; el motor se mata (grupo entero) al terminar cada arranque.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildInlineConfig } from './inline-config'
import { projectCodeEnv, projectText, quarantineEngineUserConfig } from './project-code'

const BIN = process.env.LAZUNOX_H5_MOTOR ?? ''
const HAS_BIN = !!BIN && existsSync(BIN)

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      const port = typeof a === 'object' && a ? a.port : 0
      s.close(() => resolve(port))
    })
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Lab {
  root: string
  folder: string
  privateDir: string
  sentinel: string
}

/** Carpeta de prueba con lo que una tarea podría dejar escrito. */
function makeLab(): Lab {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-h5-')))
  const folder = join(root, 'carpeta')
  const privateDir = join(root, 'privada')
  const sentinel = join(folder, 'centinela.txt')
  const line = (tag: string): string =>
    `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(sentinel)}, ${JSON.stringify(tag + '\n')})\n`
  mkdirSync(join(folder, '.opencode', 'plugin'), { recursive: true })
  mkdirSync(join(folder, '.opencode', 'tool'), { recursive: true })
  mkdirSync(join(folder, '.opencode', 'skills', 'prueba-h5'), { recursive: true })
  writeFileSync(join(folder, '.opencode', 'plugin', 'centinela.js'), line('complemento-proyecto') + `export default { id: 'centinela-h5', server: async () => ({}) }\n`)
  writeFileSync(join(folder, '.opencode', 'tool', 'centinela.js'), line('herramienta-proyecto') + `export const nada = 1\n`)
  writeFileSync(
    join(folder, 'opencode.json'),
    JSON.stringify({
      mcp: { centinela: { type: 'local', command: ['/bin/sh', '-c', `echo mcp-proyecto >> '${sentinel}'`], enabled: true } }
    })
  )
  writeFileSync(join(folder, 'AGENTS.md'), 'Instrucción de prueba H5.\n')
  writeFileSync(join(folder, '.opencode', 'skills', 'prueba-h5', 'SKILL.md'), '---\nname: prueba-h5\ndescription: Skill de prueba H5\n---\nNada.\n')
  // Config global privada del motor (XDG_CONFIG_HOME/opencode), escribible desde la jaula.
  mkdirSync(join(privateDir, 'config', 'opencode', 'plugin'), { recursive: true })
  writeFileSync(join(privateDir, 'config', 'opencode', 'plugin', 'centinela.js'), line('complemento-privado') + `export default { id: 'centinela-h5-priv', server: async () => ({}) }\n`)
  for (const d of ['data', 'cache', 'state', 'tmp', 'home', 'appconfig']) mkdirSync(join(privateDir, d), { recursive: true })
  return { root, folder, privateDir, sentinel }
}

const alive = new Set<ChildProcess>()
function killGroup(child: ChildProcess): void {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
  alive.delete(child)
}

interface RunResult {
  config: Record<string, unknown>
  skills: string[]
  instructionsSeen: boolean
}

/** Arranca el motor, pide config, MCP, herramientas y skills de la carpeta, espera y lo mata. */
async function runEngine(lab: Lab, extraEnv: Record<string, string>, inline: Record<string, unknown>): Promise<RunResult> {
  const port = await freePort()
  const password = randomBytes(16).toString('hex')
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: join(lab.privateDir, 'home'),
    OPENCODE_TEST_HOME: join(lab.privateDir, 'home'),
    TMPDIR: join(lab.privateDir, 'tmp'),
    XDG_CONFIG_HOME: join(lab.privateDir, 'config'),
    XDG_DATA_HOME: join(lab.privateDir, 'data'),
    XDG_CACHE_HOME: join(lab.privateDir, 'cache'),
    XDG_STATE_HOME: join(lab.privateDir, 'state'),
    OPENCODE_CONFIG_DIR: join(lab.privateDir, 'appconfig'),
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(inline),
    ...extraEnv
  }
  const child = spawn(BIN, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: lab.folder,
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  })
  alive.add(child)
  const auth = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')
  const base = `http://127.0.0.1:${port}`
  const q = `directory=${encodeURIComponent(lab.folder)}`
  const get = async (path: string): Promise<unknown> => {
    const r = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}${q}`, { headers: { authorization: auth } })
    return r.ok ? r.json().catch(() => null) : null
  }
  try {
    let up = false
    for (let i = 0; i < 100 && !up; i++) {
      up = await fetch(`${base}/global/health`, { headers: { authorization: auth } })
        .then((r) => r.ok)
        .catch(() => false)
      if (!up) await sleep(200)
    }
    expect(up).toBe(true)
    const config = ((await get('/config')) ?? {}) as Record<string, unknown>
    await get('/mcp')
    await get('/experimental/tool/ids')
    const skillsRaw = (await get('/skill')) as Array<{ name?: string }> | null
    const skills = Array.isArray(skillsRaw) ? skillsRaw.map((s) => String(s.name)) : []
    const instr = Array.isArray(config.instructions) ? (config.instructions as string[]) : []
    await sleep(2500) // MCP local y complementos: dar tiempo a que corran si se cargaran
    return { config, skills, instructionsSeen: instr.some((p) => p.endsWith('AGENTS.md')) }
  } finally {
    killGroup(child)
  }
}

describe.skipIf(!HAS_BIN)('H5 con el motor real: nada ejecutable de la carpeta ni de la config privada', () => {
  const labs: string[] = []
  afterAll(() => {
    for (const c of [...alive]) killGroup(c)
    for (const r of labs) rmSync(r, { recursive: true, force: true })
  })

  it('control (como antes): el motor carga complemento, herramienta y MCP local, y aparece el centinela', async () => {
    const lab = makeLab()
    labs.push(lab.root)
    await runEngine(lab, {}, { autoupdate: false, share: 'disabled' })
    expect(existsSync(lab.sentinel)).toBe(true)
    const lines = readFileSync(lab.sentinel, 'utf8')
    expect(lines).toContain('complemento-proyecto')
    expect(lines).toContain('complemento-privado')
    expect(lines).toContain('mcp-proyecto')
    expect(lines).toContain('herramienta-proyecto')
  }, 60_000)

  it('con el arreglo: no aparece el centinela y el texto de la carpeta (AGENTS.md, skills) sigue llegando', async () => {
    const lab = makeLab()
    labs.push(lab.root)
    const moved = quarantineEngineUserConfig(lab.privateDir, () => undefined)
    expect(moved).toContain('plugin')
    const inline = buildInlineConfig({
      fullAccess: false,
      extras: [],
      browserMcp: null,
      computerMcp: null,
      mcpContribution: { mcp: {}, permission: {} },
      rulesPermission: {},
      skills: {},
      projectText: projectText(lab.folder)
    })
    const r = await runEngine(lab, projectCodeEnv(false), inline)
    expect(existsSync(lab.sentinel) ? readFileSync(lab.sentinel, 'utf8') : '').toBe('')
    expect(r.instructionsSeen).toBe(true)
    expect(r.skills).toContain('prueba-h5')
    expect((r.config.mcp as Record<string, unknown> | undefined)?.centinela).toBeUndefined()
  }, 60_000)
})
