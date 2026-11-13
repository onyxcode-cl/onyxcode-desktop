/**
 * Fixture opcional REAL: wrapper en la distro, Landlock y puente Windows en C: y D:.
 * Requiere PC de pruebas, caché local y que NO exista ya Lazunox-Tareas.
 * LAZUNOX_WSL_IT=1 LAZUNOX_OWN_DELETE_IT=1 vitest run .../own-delete-runtime.win.test.ts
 * No es una prueba con modelo ni acredita la experiencia de tarjetas en la app.
 */
import { createServer } from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWslBackend } from './backends/wsl'
import { createItEnv, IT_ENABLED } from './backends/wsl-it-support'
import { WSL_DISTRO } from './backends/wsl-spec'
import { McpProxy } from './mcp-proxy'
import { createOwnDeleteRuntimeHandler } from './own-delete-runtime'

const ENABLED = IT_ENABLED && process.env.LAZUNOX_OWN_DELETE_IT === '1'
const SID = 'ses_abcdefgh'
const CALL = 'call_landlock_1'
const CASES: Array<{ command: string; missing: string[]; denied?: boolean }> = [
  { command: 'printf hola > borrador.txt && cat borrador.txt && rm borrador.txt && (test ! -e borrador.txt)', missing: ['borrador.txt'] },
  { command: 'printf x > borrador.txt; cat borrador.txt && rm borrador.txt && test ! -e borrador.txt', missing: ['borrador.txt'] },
  {
    command: 'printf x > borrador.txt; test -e borrador.txt && cat borrador.txt && rm borrador.txt; test ! -e borrador.txt',
    missing: ['borrador.txt']
  },
  {
    command: 'cp viejo.txt .lazunox/trabajo/orig.zip && cd .lazunox/trabajo && mkdir x && touch x/tmp && rm -rf x && rm orig.zip',
    missing: ['.lazunox/trabajo/x', '.lazunox/trabajo/orig.zip']
  },
  {
    command:
      'PY=/bin/echo; mkdir .lazunox/trabajo/convenio_x; rm -rf .lazunox/trabajo/convenio_x; "$PY" listo; test ! -e .lazunox/trabajo/convenio_x',
    missing: ['.lazunox/trabajo/convenio_x']
  },
  { command: 'printf x > .lazunox/trabajo/ops.json; rm -rf .lazunox/trabajo/ops.json; ls', missing: ['.lazunox/trabajo/ops.json'] },
  { command: 'printf x > informe-v3.pptx; rm -f informe-v3.pptx && ls -la *.txt', missing: ['informe-v3.pptx'] },
  {
    command:
      'printf x > informe-v2.pptx; printf y > informe-v3.pptx; rm -f informe-v2.pptx; ls -la informe-v3.pptx; test ! -e informe-v2.pptx',
    missing: ['informe-v2.pptx']
  },
  { command: 'rmdir .lazunox/trabajo', missing: [], denied: true },
  { command: 'printf x > nuevo.txt; rm *.txt', missing: ['nuevo.txt'], denied: true },
  { command: "printf x > nuevo.txt; printf '%s\\n' nuevo.txt | xargs rm; test ! -e nuevo.txt", missing: ['nuevo.txt'] },
  { command: 'printf x > nuevo.txt; find . -name nuevo.txt -exec rm {} \\; ; test ! -e nuevo.txt', missing: ['nuevo.txt'] },
  {
    command: "printf x > nuevo.txt; printf '%s\\n' 'rm nuevo.txt' > limpiar.sh; /bin/sh limpiar.sh; test ! -e nuevo.txt",
    missing: ['nuevo.txt']
  },
  { command: '/bin/rm viejo.txt', missing: [], denied: true }
]

const quote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'"
const sha = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function until(ms: number, fn: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await wait(250)
  }
  throw new Error('Tiempo agotado en la integración Landlock del borrado propio')
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

describe.skipIf(!ENABLED).sequential('rm propio con Landlock real (PC Windows, distro exclusiva de prueba)', () => {
  it.each(['C', 'D'])(
    '14 órdenes en %s:, previo intacto, errores nativos y scratch protegido',
    async (drive) => {
      expect(existsSync(`${drive}:\\`), `La comprobación exige la unidad ${drive}:`).toBe(true)
      const itEnv = await createItEnv({ real: true })
      const backend = createWslBackend(itEnv.deps)
      const before = await itEnv.list()
      expect(before.includes(WSL_DISTRO), 'Ya existe Lazunox-Tareas: no se pisa ni se elimina').toBe(false)
      const runDir = join(`${drive}:\\lazunox-it`, 'lzx-rm-' + randomBytes(6).toString('hex'))
      const folder = join(runDir, 'work')
      const configDir = join(runDir, 'cfg')
      const privateDir = join(runDir, randomBytes(8).toString('hex'))
      const linuxFolder = `/win/${drive.toLowerCase()}/lazunox-it/${runDir.split('\\').at(-1)!}/work`
      const baselinePaths = ['viejo.txt']
      const previous = Buffer.from('Archivo anterior: debe quedar exactamente igual.\n')
      const previousHash = sha(previous)
      const proxy = new McpProxy()
      let launched: Awaited<ReturnType<typeof backend.launch>> | undefined
      let setupStarted = false
      let source = ':'
      const created = Date.now()
      try {
        await mkdir(join(folder, '.lazunox', 'trabajo'), { recursive: true })
        await mkdir(join(folder, 'ev'), { recursive: true })
        await mkdir(configDir, { recursive: true })
        await mkdir(privateDir, { recursive: true })
        await writeFile(join(folder, 'viejo.txt'), previous)
        await writeFile(join(configDir, '.gitignore'), 'node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n')
        const runtime = createOwnDeleteRuntimeHandler({
          folder,
          platform: 'win32',
          excluded: [],
          enabled: () => true,
          server: () => ({ baseUrl: 'http://127.0.0.1:1', authorization: 'Basic fake-engine', directory: linuxFolder }),
          baseline: () => ({ version: 1, notBefore: 0, paths: baselinePaths, unknown: [] }),
          fetchImpl: async (input) => {
            const path = new URL(String(input)).pathname
            const value =
              path === '/agent'
                ? [{ name: 'tasks', permission: [{ permission: '*', pattern: '*', action: 'allow' }] }]
                : path.endsWith('/message')
                  ? [
                      {
                        info: { sessionID: SID, role: 'assistant', time: {} },
                        parts: [
                          {
                            type: 'tool',
                            tool: 'bash',
                            sessionID: SID,
                            callID: CALL,
                            state: { status: 'running', input: { command: source } }
                          }
                        ]
                      }
                    ]
                  : { id: SID, agent: 'tasks', permission: [], time: { created } }
            return new Response(JSON.stringify(value))
          }
        })
        await proxy.start()
        const local = proxy.setLocalPostHandler('/rm-it', runtime.handle, runtime.acceptsTicket)
        const issued = (await runtime.handle({ action: 'ticket', sessionId: SID, callId: CALL })) as { ticket?: string }
        expect(issued.ticket).toBeTruthy()
        setupStarted = true
        await backend.setup!(() => undefined)
        expect((await backend.status()).state).toBe('ready')
        const port = await freePort()
        const password = randomBytes(24).toString('base64url')
        const authorization = 'Basic ' + Buffer.from('tasks:' + password).toString('base64')
        launched = await backend.launch({
          folder,
          bin: '',
          serveArgs: ['serve', '--port', String(port), '--hostname', '127.0.0.1'],
          serverPort: port,
          isolation: { privateDir, userData: join(runDir, 'userdata') },
          configDir,
          allowDelete: false,
          outboundPorts: [proxy.port],
          baseEnv: {
            OPENCODE_SERVER_USERNAME: 'tasks',
            OPENCODE_SERVER_PASSWORD: password,
            OPENCODE_DISABLE_MODELS_FETCH: '1',
            OPENCODE_DISABLE_AUTOUPDATE: '1',
            LAZUNOX_OWN_DELETE_RUNTIME: '1',
            LAZUNOX_RM_URL: local.url,
            LAZUNOX_RM_BILLETE: issued.ticket!
          },
          proxyEnv: {}
        })
        const api = (path: string, init: RequestInit = {}) =>
          fetch(`http://127.0.0.1:${port}${path}`, {
            ...init,
            headers: { authorization, 'content-type': 'application/json' },
            signal: AbortSignal.timeout(15000)
          })
        await until(120000, async () => {
          if (launched!.child.exitCode !== null) throw new Error('El lanzador WSL terminó antes de responder')
          try {
            return (await api('/global/health')).ok
          } catch {
            return false
          }
        })
        // El servidor real solo lanza el shell; el motor falso de main atestigua la llamada de prueba.
        // Cada caso guarda su salida y código antes de comprobar el siguiente; sin modelo ni permisos aprobados.
        source = [
          'export PATH=/opt/lazunox/own-delete-bin:/usr/bin:/bin',
          'id -u > ev/uid',
          "grep -E '^(CapEff|NoNewPrivs):' /proc/self/status > ev/status",
          'command -v rm > ev/rm-path',
          ...CASES.flatMap((test, i) => [
            `(${test.command}) > ev/${i}.out 2>&1`,
            `printf '%s' "$?" > ev/${i}.code`,
            ...test.missing.map((path, j) => `if test -e ${quote(path)}; then echo exists; else echo missing; fi > ev/${i}-${j}.state`)
          ]),
          "find . -maxdepth 1 -name '.lazunox-own-delete-*' > ev/leftovers",
          'if test -d .lazunox/trabajo; then echo yes; fi > ev/scratch',
          'echo done > ev/done'
        ].join('\n')
        const pty = await api(`/pty?directory=${encodeURIComponent(linuxFolder)}`, {
          method: 'POST',
          body: JSON.stringify({ command: '/bin/sh', args: ['-c', source], cwd: linuxFolder })
        })
        if (!pty.ok) {
          const response = await api(`/session?directory=${encodeURIComponent(linuxFolder)}`, {
            method: 'POST',
            body: JSON.stringify({ title: 'own-delete-it' })
          })
          expect(response.ok, 'No se pudo crear la sesión de ejecución de prueba').toBe(true)
          const session = (await response.json()) as { id: string }
          const shell = await api(`/session/${session.id}/shell?directory=${encodeURIComponent(linuxFolder)}`, {
            method: 'POST',
            body: JSON.stringify({ agent: 'build', command: source })
          })
          expect(shell.ok, 'No se pudo ejecutar el shell dentro de Landlock').toBe(true)
        }
        await until(120000, async () => (await readFile(join(folder, 'ev', 'done'), 'utf8').catch(() => '')).trim() === 'done')
        for (const [i, test] of CASES.entries()) {
          const code = Number(await readFile(join(folder, 'ev', `${i}.code`), 'utf8'))
          const output = await readFile(join(folder, 'ev', `${i}.out`), 'utf8')
          expect(sha(await readFile(join(folder, 'viejo.txt'))), `caso ${i}: ${output}`).toBe(previousHash)
          if (test.denied) {
            expect(code, `caso ${i}: ${output}`).not.toBe(0)
            expect(output, `caso ${i}`).toMatch(/Permission denied|Operation not permitted/)
          } else expect(code, `caso ${i}: ${output}`).toBe(0)
          for (const [j, path] of test.missing.entries())
            expect((await readFile(join(folder, 'ev', `${i}-${j}.state`), 'utf8')).trim(), `caso ${i}: ${path}`).toBe('missing')
        }
        expect((await readFile(join(folder, 'ev', 'uid'), 'utf8')).trim()).toBe('1000')
        expect(await readFile(join(folder, 'ev', 'status'), 'utf8')).toMatch(/^NoNewPrivs:\s+1$/m)
        expect(await readFile(join(folder, 'ev', 'status'), 'utf8')).toMatch(/^CapEff:\s+0+$/m)
        expect((await readFile(join(folder, 'ev', 'rm-path'), 'utf8')).trim()).toBe('/opt/lazunox/own-delete-bin/rm')
        expect((await readFile(join(folder, 'ev', 'scratch'), 'utf8')).trim()).toBe('yes')
        expect((await readFile(join(folder, 'ev', 'leftovers'), 'utf8')).trim()).toBe('')
      } finally {
        if (launched) {
          launched.child.kill('SIGKILL')
          await launched.dispose()
        }
        await proxy.stop()
        // Solo se quita la distro que esta prueba creó tras comprobar que no existía.
        if (setupStarted) await backend.remove!()
        await rm(runDir, { recursive: true, force: true })
      }
      expect(await itEnv.list()).toEqual(before)
    },
    20 * 60 * 1000
  )
})
