/**
 * Seatbelt REAL (`sandbox-exec`): la config global privada del motor (`<privada>/config/opencode`) es de SOLO LECTURA desde dentro (1.8.19).
 * El motor vuelve a leer de ahí complementos, herramientas, comandos, agentes y `opencode.json` en cada instancia nueva: un proceso de la
 * tarea vivo ya no los puede dejar para la siguiente. El resto de `<privada>/config` (p. ej. el `gitconfig` propio) sigue escribible.
 * Con `LAZUNOX_MOTOR=<binario opencode>`, además: el motor publicado arranca, crea una sesión y corre una orden con esa carpeta de solo
 * lectura (la app deja antes su `.gitignore`, que es lo único que el motor escribe ahí). Todo en una carpeta temporal. Solo macOS.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import { ENGINE_GITIGNORE } from './private-dir'
import { quarantineEngineUserConfig } from './project-code'
import { buildSandboxProfile, sandboxDirs, sandboxEnv, type SandboxProfileOptions } from './sandbox-profile'

const HAS_SBX = macOnly && existsSync('/usr/bin/sandbox-exec')
const MOTOR = process.env.LAZUNOX_MOTOR ?? ''
const HAS_MOTOR = HAS_SBX && !!MOTOR && existsSync(MOTOR)
const BUILDERS: Array<[string, (o: SandboxProfileOptions) => string]> = [['V1', buildSandboxProfile]]

const freePort = (): Promise<number> =>
  new Promise((res) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => res(p))
    })
  })

describe.skipIf(!HAS_SBX).each(BUILDERS)('Seatbelt real (%s): config privada del motor de solo lectura', (_j, build) => {
  let dir: string
  let folder: string
  let userData: string
  let privateDir: string
  let conf: string

  beforeAll(() => {
    // Fuera del temporal del usuario (la jaula V2 no deja leerlo).
    dir = realpathSync(mkdtempSync('/private/tmp/lazunox-engcfg-'))
    folder = join(dir, 'carpeta')
    userData = join(dir, 'ud')
    privateDir = join(userData, 'tasks-sandbox', 'abc')
    conf = join(privateDir, 'config', 'opencode')
    for (const d of [join(folder, '.lazunox', 'trabajo'), join(userData, 'opencode-config'), ...Object.values(sandboxDirs(privateDir))])
      mkdirSync(d, { recursive: true })
    writeFileSync(join(userData, 'opencode-config', '.gitignore'), ENGINE_GITIGNORE) // como la app
    quarantineEngineUserConfig(privateDir, () => {})
  })
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const opts = (allowDelete: boolean, port?: number): SandboxProfileOptions => ({
    folder,
    privateDir,
    userData,
    readOnly: [join(userData, 'opencode-config')],
    home: join(dir, 'home'),
    allowDelete,
    ...(port ? { serverPort: port } : {})
  })
  const env = (): Record<string, string> => ({
    PATH: '/usr/bin:/bin',
    HOME: join(dir, 'home'),
    ...sandboxEnv(sandboxDirs(privateDir)),
    C: conf
  })

  it.each([false, true])('desde dentro no se crea, cambia, borra ni renombra nada ahí (Permitir borrar = %s)', (allowDelete) => {
    const script = `mkdir "$C/plugin"; echo x > "$C/opencode.json"; echo x >> "$C/.gitignore"; rm -f "$C/.gitignore"
ln -s /tmp "$C/tool"; mv "$C" "$C.x"; echo ok > "$XDG_CONFIG_HOME/escribible.txt"; exit 0`
    spawnSync('/usr/bin/sandbox-exec', ['-p', build(opts(allowDelete)), '/bin/sh', '-c', script], {
      cwd: folder,
      env: env(),
      timeout: 60000
    })
    expect(readdirSync(conf)).toEqual(['.gitignore'])
    expect(readFileSync(join(conf, '.gitignore'), 'utf8')).toBe(ENGINE_GITIGNORE)
    expect(existsSync(`${conf}.x`)).toBe(false)
    // El resto de la config privada sigue escribible (gitconfig propio, etc.).
    expect(readFileSync(join(privateDir, 'config', 'escribible.txt'), 'utf8')).toBe('ok\n')
  })

  it.skipIf(!HAS_MOTOR)(
    'el motor publicado arranca, crea una sesión y corre una orden con la config privada de solo lectura',
    async () => {
      const port = await freePort()
      const user = 'tasks'
      const pass = randomBytes(12).toString('base64url')
      const child = spawn(
        '/usr/bin/sandbox-exec',
        ['-p', build(opts(false, port)), MOTOR, 'serve', '--port', String(port), '--hostname', '127.0.0.1'],
        {
          cwd: folder,
          env: {
            ...env(),
            LANG: 'en_US.UTF-8',
            OPENCODE_SERVER_USERNAME: user,
            OPENCODE_SERVER_PASSWORD: pass,
            OPENCODE_CONFIG_DIR: join(userData, 'opencode-config'),
            OPENCODE_DISABLE_PROJECT_CONFIG: '1',
            OPENCODE_DISABLE_MODELS_FETCH: '1'
          },
          stdio: 'ignore',
          detached: true
        }
      )
      const auth = { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` }
      const q = `?directory=${encodeURIComponent(folder)}`
      try {
        let healthy = false
        for (let i = 0; i < 120 && !healthy; i++) {
          healthy = await fetch(`http://127.0.0.1:${port}/global/health`, { headers: auth, signal: AbortSignal.timeout(2000) })
            .then(async (r) => r.ok && ((await r.json()) as { healthy?: boolean }).healthy === true)
            .catch(() => false)
          if (!healthy) await new Promise((r) => setTimeout(r, 250))
        }
        expect(healthy).toBe(true)
        const s = await fetch(`http://127.0.0.1:${port}/session${q}`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: '{}'
        })
        const id = ((await s.json()) as { id: string }).id
        expect(id).toMatch(/^ses/)
        const sh = await fetch(`http://127.0.0.1:${port}/session/${id}/shell${q}`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ agent: 'build', command: 'echo hola-motor' })
        })
        expect(await sh.text()).toContain('hola-motor')
        expect(readdirSync(conf)).toEqual(['.gitignore'])
      } finally {
        try {
          process.kill(-child.pid!, 'SIGKILL')
        } catch {
          /* ya terminó */
        }
      }
    },
    120000
  )
})
