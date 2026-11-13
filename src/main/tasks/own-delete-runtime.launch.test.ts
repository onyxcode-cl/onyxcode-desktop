/**
 * Integración REAL del rm propio con Seatbelt, Python y HTTP (sin modelo/Electron).
 * Ejecución deliberada: LAZUNOX_OWN_DELETE_IT=1 vitest run .../own-delete-runtime.launch.test.ts.
 * No se salta una denegación de listen o sandbox-exec: con la bandera activa el fallo se informa.
 * Todo usa carpetas temporales; no modifica perfiles, permisos ni datos de la persona.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import { McpProxy } from './mcp-proxy'
import { createOwnDeleteRuntimeHandler } from './own-delete-runtime'
import { prepareOwnDeleteBin } from './own-delete-runtime-files'
import { buildSandboxProfile, sandboxDirs, sandboxEnv } from './sandbox-profile'

const ENABLED = process.env.LAZUNOX_OWN_DELETE_IT === '1'
const SID = 'ses_abcdefgh'
const CALL = 'call_launch_1'
const PYTHONS = [process.env.LAZUNOX_OWN_DELETE_IT_PYTHON, join(process.cwd(), 'resources/python-bin/mac-arm64/python/bin/python3')].filter(
  (p): p is string => !!p
)
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
interface Case {
  label: string
  command: string
  missing: string[]
  kept?: string[]
  denied?: boolean
}
const CASES: Case[] = [
  {
    label: 'crear, leer, borrar y subshell',
    command: "printf 'hola\\n' > borrador.txt && cat borrador.txt && rm borrador.txt && (test ! -e borrador.txt)",
    missing: ['borrador.txt']
  },
  {
    label: 'leer antes de borrar',
    command: 'printf x > borrador.txt; cat borrador.txt && rm borrador.txt && test ! -e borrador.txt',
    missing: ['borrador.txt']
  },
  {
    label: 'guardia y lectura',
    command: 'printf x > borrador.txt; test -e borrador.txt && cat borrador.txt && rm borrador.txt; test ! -e borrador.txt',
    missing: ['borrador.txt']
  },
  {
    label: 'copiar, cd y limpiar temporal',
    command:
      'cp viejo.txt .lazunox/trabajo/orig.zip && cd .lazunox/trabajo && mkdir x && touch x/temporal && rm -rf x && test ! -e x && rm orig.zip',
    missing: ['.lazunox/trabajo/x', '.lazunox/trabajo/orig.zip']
  },
  {
    label: 'variable y programa tras temporal',
    command:
      'PY=/bin/echo; mkdir .lazunox/trabajo/convenio_x; rm -rf .lazunox/trabajo/convenio_x; "$PY" listo; test ! -e .lazunox/trabajo/convenio_x',
    missing: ['.lazunox/trabajo/convenio_x']
  },
  {
    label: 'temporal y listado',
    command: 'printf x > .lazunox/trabajo/ops.json; rm -rf .lazunox/trabajo/ops.json; ls',
    missing: ['.lazunox/trabajo/ops.json']
  },
  {
    label: 'versión propia y comodín posterior',
    command: 'printf x > informe-v3.pptx; rm -f informe-v3.pptx && ls -la *.txt',
    missing: ['informe-v3.pptx']
  },
  {
    label: 'versión previa de la tarea y comprobación',
    command:
      'printf x > informe-v2.pptx; printf y > informe-v3.pptx; rm -f informe-v2.pptx; ls -la informe-v3.pptx; test ! -e informe-v2.pptx',
    missing: ['informe-v2.pptx'],
    kept: ['informe-v3.pptx']
  },
  {
    label: 'raíz de temporales permanece protegida',
    command: 'rmdir .lazunox/trabajo',
    missing: [],
    kept: ['.lazunox/trabajo'],
    denied: true
  },
  { label: 'comodín mezcla propios y previo', command: 'printf x > nuevo.txt; rm *.txt', missing: ['nuevo.txt'], denied: true },
  {
    label: 'xargs invoca rm del PATH',
    command: "printf x > nuevo.txt; printf '%s\\n' nuevo.txt | xargs rm; test ! -e nuevo.txt",
    missing: ['nuevo.txt']
  },
  {
    label: 'find -exec invoca rm del PATH',
    command: 'printf x > nuevo.txt; find . -name nuevo.txt -exec rm {} \\; ; test ! -e nuevo.txt',
    missing: ['nuevo.txt']
  },
  {
    label: 'guion llama rm por nombre',
    command: "printf x > nuevo.txt; printf '%s\\n' 'rm nuevo.txt' > limpiar.sh; /bin/sh limpiar.sh; test ! -e nuevo.txt",
    missing: ['nuevo.txt'],
    kept: ['limpiar.sh']
  },
  {
    label: 'ruta absoluta nativa conserva aislamiento',
    command: 'printf x > nuevo.txt; /bin/rm nuevo.txt',
    missing: [],
    kept: ['nuevo.txt'],
    denied: true
  }
]

describe.skipIf(!macOnly || !ENABLED)('rm propio: Seatbelt real + Python real + main y proxy HTTP reales', () => {
  let dir: string
  let folder: string
  let profile: string
  let env: NodeJS.ProcessEnv
  let proxy: McpProxy | undefined
  let previousHash: string
  let command = ''

  beforeEach(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-rm-real-')))
    folder = join(dir, 'tarea')
    const userData = join(dir, 'user-data')
    const privateDir = join(userData, 'tasks-sandbox', 'prueba')
    const configDir = join(userData, 'opencode-config')
    const home = join(dir, 'home')
    const dirs = sandboxDirs(privateDir)
    for (const p of [folder, join(folder, '.lazunox', 'trabajo'), configDir, home, ...Object.values(dirs)])
      mkdirSync(p, { recursive: true })
    writeFileSync(join(folder, 'viejo.txt'), 'Archivo previo: debe conservar exactamente estos bytes.\n')
    previousHash = sha(join(folder, 'viejo.txt'))
    const python = PYTHONS.find(existsSync)
    expect(python, 'Falta Python incluido; se puede indicar LAZUNOX_OWN_DELETE_IT_PYTHON').toBeTruthy()
    expect(existsSync('/usr/bin/sandbox-exec'), 'Falta sandbox-exec para la comprobación real').toBe(true)
    const bin = prepareOwnDeleteBin(configDir, python!, join(process.cwd(), 'resources/wsl/lzx_rm.py'))
    const created = Date.now()
    const runtime = createOwnDeleteRuntimeHandler({
      folder,
      platform: 'darwin',
      excluded: [],
      enabled: () => true,
      server: () => ({ baseUrl: 'http://127.0.0.1:1', authorization: 'Basic fake-engine', directory: folder }),
      baseline: () => ({ version: 1, notBefore: 0, paths: ['viejo.txt'], unknown: [] }),
      fetchImpl: async (input) => {
        const path = new URL(String(input)).pathname
        const data =
          path === '/agent'
            ? [{ name: 'tasks', permission: [{ permission: '*', pattern: '*', action: 'allow' }] }]
            : path.endsWith('/message')
              ? [
                  {
                    info: { sessionID: SID, role: 'assistant', time: {} },
                    parts: [{ type: 'tool', tool: 'bash', sessionID: SID, callID: CALL, state: { status: 'running', input: { command } } }]
                  }
                ]
              : { id: SID, agent: 'tasks', permission: [], time: { created } }
        return new Response(JSON.stringify(data))
      }
    })
    proxy = new McpProxy()
    // Si el entorno impide listen, la prueba falla explícitamente aquí, nunca convierte el fallo en skip.
    await proxy.start()
    const local = proxy.setLocalPostHandler('/rm-real', runtime.handle, runtime.acceptsTicket)
    const reply = await fetch(local.url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + local.token, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ticket', sessionId: SID, callId: CALL }),
      signal: AbortSignal.timeout(10000)
    })
    const issued = (await reply.json()) as { ticket?: string }
    expect(issued.ticket).toBeTruthy()
    env = {
      PATH: bin + ':/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: home,
      LANG: 'C',
      ...sandboxEnv(dirs),
      LAZUNOX_RM_URL: local.url,
      LAZUNOX_RM_BILLETE: issued.ticket!,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONNOUSERSITE: '1'
    }
    profile = buildSandboxProfile({
      folder,
      privateDir,
      userData,
      readOnly: [configDir],
      allowedOutboundPorts: [proxy.port],
      serverPort: 61900,
      allowDelete: false,
      home
    })
  }, 15000)

  afterEach(async () => {
    await proxy?.stop()
    proxy = undefined
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const run = (source: string): Promise<{ code: number | null; output: string }> => {
    command = source
    return new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c', source], {
        cwd: folder,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('Tiempo agotado en sandbox-exec'))
      }, 15000)
      child.stdout.on('data', (b: Buffer) => {
        output += b.toString()
      })
      child.stderr.on('data', (b: Buffer) => {
        output += b.toString()
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve({ code, output })
      })
    })
  }

  it.each(CASES)(
    '$label',
    async ({ command: source, missing, kept = [], denied }) => {
      const r = await run(source)
      expect(sha(join(folder, 'viejo.txt')), r.output).toBe(previousHash)
      for (const p of missing) expect(existsSync(join(folder, p)), r.output).toBe(false)
      for (const p of kept) expect(existsSync(join(folder, p)), r.output).toBe(true)
      expect(existsSync(join(folder, '.lazunox', 'trabajo')), r.output).toBe(true)
      expect(readdirSync(folder).filter((p) => p.startsWith('.lazunox-own-delete-'))).toEqual([])
      if (denied) {
        expect(r.code, r.output).not.toBe(0)
        expect(r.output).toMatch(/Operation not permitted|Permission denied/)
      } else expect(r.code, r.output).toBe(0)
    },
    20000
  )

  it('un previo recibe el mismo error nativo y permanece con la misma huella', async () => {
    const native = await run('/bin/rm viejo.txt')
    const wrapped = await run('rm viejo.txt')
    expect(native.code).not.toBe(0)
    expect(wrapped.code).toBe(native.code)
    expect(wrapped.output).toBe(native.output)
    expect(wrapped.output).toMatch(/Operation not permitted|Permission denied/)
    expect(sha(join(folder, 'viejo.txt'))).toBe(previousHash)
  }, 20000)

  it('rm -rv conserva salida nativa por hijo y directorio', async () => {
    // En scratch el sistema permite borrar: sirve de control BSD real del formato -v.
    const native = await run(
      'mkdir -p .lazunox/trabajo/arbol; printf x > .lazunox/trabajo/arbol/hijo; cd .lazunox/trabajo; /bin/rm -rv arbol'
    )
    const wrapped = await run('mkdir arbol; printf x > arbol/hijo; rm -rv arbol')
    expect(native.code, native.output).toBe(0)
    expect(wrapped.code, wrapped.output).toBe(0)
    expect(wrapped.output).toBe(native.output)
    expect(existsSync(join(folder, 'arbol'))).toBe(false)
    expect(sha(join(folder, 'viejo.txt'))).toBe(previousHash)
  }, 20000)
})
