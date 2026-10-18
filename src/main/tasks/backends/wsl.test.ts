import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Duplex, PassThrough, Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { FrameDecoder, FrameType, decodeError, encodeExit, encodeFrame, encodePort, type Frame } from './bridge-protocol'
import { createWslBackend, type WslDeps, type WslProcess, type WslSetupExtras } from './wsl'
import { encodeLzpk } from './wsl-payload'
import { parseWslPin, wslRootfsUrl } from './wsl-pin'
import { WslSetupError, wslSetupPaths, type SetupPin } from './wsl-setup'
import type { RunResult } from './wsl-status'
import type { WslSpawnSpec } from './wsl-spec'
import type { SandboxLaunchSpec } from './types'

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await tick()
}
const u16 = (s: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])
const ok = (b: Buffer | string): RunResult => ({ code: 0, stdout: Buffer.from(b), stderr: Buffer.alloc(0) })

class FakeSocket extends Duplex {
  got: Buffer[] = []
  _read(): void {}
  _write(c: Buffer, _e: BufferEncoding, cb: () => void): void {
    this.got.push(Buffer.from(c))
    cb()
  }
}

class FakeWsl extends EventEmitter implements WslProcess {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 4321
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed: string[] = []
  frames: Frame[] = []
  private dec = new FrameDecoder()
  constructor() {
    super()
    this.stdin.on('data', (c: Buffer) => this.frames.push(...this.dec.push(c)))
  }
  kill(sig?: NodeJS.Signals | number): boolean {
    this.killed.push(String(sig))
    return true
  }
  die(code: number): void {
    this.exitCode = code
    this.stdout.end()
    this.emit('exit', code, null)
  }
  agent(id: number, type: number, data?: Buffer): void {
    this.stdout.write(encodeFrame({ id, type, data }))
  }
}

function deps(over: Partial<WslDeps> = {}) {
  const spawned: Array<{ spec: WslSpawnSpec; proc: FakeWsl }> = []
  const runs: string[][] = []
  const sockets: number[] = []
  let onConn: ((s: Duplex) => void) | null = null
  const listens: number[] = []
  const d: WslDeps = {
    platform: 'win32',
    hostEnv: { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Ben', Path: 'x', OPENCODE_API_KEY: 'sk-real-0123456789' },
    spawn: (spec) => {
      const proc = new FakeWsl()
      spawned.push({ spec, proc })
      return proc
    },
    run: async (spec) => {
      runs.push(spec.args)
      const a = spec.args.join(' ')
      if (a === '--version') return ok(u16('Versión de WSL: 2.4.13.0\r\n'))
      if (a === '-l -v') return ok(u16('  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n  Lazunox-Tareas Stopped 2\r\n'))
      return ok(JSON.stringify({ interop: false, driveMounts: [], landlockAbi: 4, kernel: '6.6', uid: 0 }))
    },
    connect: async (port) => {
      sockets.push(port)
      return new FakeSocket()
    },
    listen: async (port, cb) => {
      listens.push(port)
      onConn = cb
      return { close: async () => {} }
    },
    ...over
  }
  return { d, spawned, runs, sockets, listens, inbound: (s: Duplex) => onConn!(s) }
}

const launchSpec = (over: Partial<SandboxLaunchSpec> = {}): SandboxLaunchSpec => ({
  folder: 'C:\\lazunox\\tareas\\a',
  bin: 'C:\\no-se-usa\\opencode.exe',
  serveArgs: ['serve', '--port', '51000', '--hostname', '127.0.0.1'],
  serverPort: 51000,
  isolation: {
    privateDir: 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox\\tasks-sandbox\\0123456789abcdef',
    userData: 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox'
  },
  configDir: 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox\\opencode-config',
  allowDelete: false,
  outboundPorts: [52000, 52001, 4096],
  baseEnv: {
    OPENCODE_CONFIG_DIR: 'C:\\x',
    OPENCODE_SERVER_USERNAME: 'tasks',
    OPENCODE_SERVER_PASSWORD: 'pw',
    XDG_DATA_HOME: 'C:\\Users\\Ben\\AppData'
  },
  proxyEnv: {
    HTTP_PROXY: 'http://tok@127.0.0.1:52000',
    OPENCODE_AUTH_CONTENT: JSON.stringify({ 'opencode-go': { type: 'api', key: 'sandboxed-placeholder-0123456789abcdef' } })
  },
  extraEnv: { OPENCODE_CONFIG_CONTENT: '{"provider":{"opencode-go":{"options":{"baseURL":"http://127.0.0.1:52001/tok2"}}}}' },
  ...over
})

describe('WslBackend con wsl.exe simulado', () => {
  it('sin proveedor ni bandera selectBackend nunca lo devuelve (win32 lanza) y index.ts no lo importa', async () => {
    const { selectBackend } = await import('./index')
    await expect(selectBackend('win32')).rejects.toThrow()
    for (const p of ['linux', 'darwin']) expect((await selectBackend(p)).id).not.toBe('wsl')
    const noComments = (f: string): string =>
      readFileSync(join(__dirname, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
    expect(noComments('index.ts')).not.toMatch(/from '\.\/wsl|createWslBackend|import\('\.\/wsl/)
    expect(noComments('../sandbox.ts')).not.toMatch(/backends\/wsl|createWslBackend/)
  })

  it('status: ready con distro, probe correcto y sin política; usa solo comandos de la lista cerrada', async () => {
    const t = deps()
    const b = createWslBackend(t.d)
    expect(b.id).toBe('wsl')
    const s = await b.status()
    // la primera pasada ve la distro y el estado sin probe es `broken/probe` → se ejecuta el probe → ready
    expect(s).toEqual({ state: 'ready', detail: '6.6' })
    expect(t.runs.map((a) => a.join(' '))).toEqual([
      '--version',
      '-l -v',
      '-d Lazunox-Tareas -u root --cd / --exec /opt/lazunox/launcher.py --probe'
    ])
    expect(t.runs.flat()).not.toContain('--shutdown')
  })
  it('status: otra plataforma → unsupported; política → policyDisabled; WSL ausente → needsWsl', async () => {
    expect((await createWslBackend(deps({ platform: 'darwin' }).d).status()).state).toBe('unsupported')
    expect((await createWslBackend(deps({ policyDisabled: () => true }).d).status()).state).toBe('policyDisabled')
    const none = deps({ run: async () => ({ code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: 'ENOENT' }) })
    expect((await createWslBackend(none.d).status()).state).toBe('needsWsl')
  })
  it('status: sin la distro → needsSetup y NO arranca el probe', async () => {
    const t = deps({
      run: async (spec) => (spec.args[0] === '-l' ? ok(u16('  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n')) : ok(u16('2.4\r\n')))
    })
    expect((await createWslBackend(t.d).status()).state).toBe('needsSetup')
  })

  it('launch: crea la carpeta de trabajo del agente en el anfitrión antes de lanzar (Landlock exige que exista)', async () => {
    const made: string[] = []
    const t = deps({ ensureDir: (p) => void made.push(p) })
    const spec = launchSpec()
    await createWslBackend(t.d).launch(spec)
    expect(made).toEqual([`${spec.folder.replace(/\\+$/, '')}\\.lazunox\\trabajo`])
    expect(made[0]!.length).toBeGreaterThan(spec.folder.length)
  })

  it('launch: el catálogo de modelos viaja por la config de solo lectura (OPENCODE_MODELS_PATH); sin catálogo o si falla, se lanza igual', async () => {
    const asked: string[] = []
    const cfg = 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox\\opencode-config'
    const t = deps({ seedModels: (c) => (asked.push(c), `${c}\\catalogo\\models.json`) })
    const l = await createWslBackend(t.d).launch(launchSpec())
    await flush()
    expect(asked).toEqual([cfg])
    expect(JSON.parse(t.spawned[0]!.proc.frames[0]!.data.toString('utf8')).env.OPENCODE_MODELS_PATH).toBe(
      '/win/c/Users/Ben/AppData/Roaming/Lazunox/opencode-config/catalogo/models.json'
    )
    await l.dispose()
    const boom = (): never => {
      throw new Error('disco')
    }
    for (const seedModels of [() => null, boom]) {
      const u = deps({ seedModels })
      const l2 = await createWslBackend(u.d).launch(launchSpec())
      await flush()
      expect(JSON.parse(u.spawned[0]!.proc.frames[0]!.data.toString('utf8')).env.OPENCODE_MODELS_PATH).toBeUndefined()
      await l2.dispose()
    }
  })

  it('launch: spawn de wsl.exe con entorno mínimo, trama INIT sin claves reales y relés solo a los puertos del proxy', async () => {
    const t = deps()
    const b = createWslBackend(t.d)
    const l = await b.launch(launchSpec())
    expect(t.spawned).toHaveLength(1)
    const { spec, proc } = t.spawned[0]!
    expect(spec.command).toBe('C:\\Windows\\System32\\wsl.exe')
    expect(spec.args).toEqual(['-d', 'Lazunox-Tareas', '-u', 'root', '--cd', '/', '--exec', '/opt/lazunox/launcher.py'])
    expect(spec.env).toEqual({ SystemRoot: 'C:\\Windows', WSLENV: '', WSL_UTF8: '1' })
    expect(t.listens).toEqual([51000])
    await flush()
    const init = proc.frames[0]!
    expect(init.type).toBe(FrameType.INIT)
    const text = init.data.toString('utf8')
    expect(text).not.toContain('sk-real')
    expect(text).not.toContain('USERPROFILE')
    const parsed = JSON.parse(text)
    expect(parsed.relayPorts).toEqual([4096, 52000, 52001])
    expect(parsed.env.OPENCODE_AUTH_CONTENT).toContain('sandboxed-placeholder-')
    expect(parsed.env.XDG_DATA_HOME).toBeUndefined()
    expect(parsed.cwd).toBe('/win/c/lazunox/tareas/a')

    // salida a un puerto permitido y a uno no permitido
    proc.agent(2, FrameType.OPEN, encodePort(52000))
    proc.agent(4, FrameType.OPEN, encodePort(9999))
    await flush()
    expect(t.sockets).toEqual([52000])
    expect(proc.frames.filter((f) => f.type === FrameType.ERROR).map((f) => decodeError(f.data).code)).toEqual(['port_denied'])
    await l.dispose()
  })

  it('launch: traducción de rutas con los montajes y rechazo de lo demás', async () => {
    const t = deps()
    const l = await createWslBackend(t.d).launch(launchSpec({ extraFolders: [{ path: 'D:\\Ref', mode: 'ro' }] }))
    expect(l.toSandboxPath('C:\\lazunox\\tareas\\a\\informe.docx')).toBe('/win/c/lazunox/tareas/a/informe.docx')
    expect(l.toHostPath('/win/c/lazunox/tareas/a/informe.docx')).toBe('C:\\lazunox\\tareas\\a\\informe.docx')
    expect(l.toHostPath('/win/d/Ref/x.txt')).toBe('D:\\Ref\\x.txt')
    for (const bad of [
      '/etc/passwd',
      '/win/c/Users/Ben/.ssh/id_rsa',
      '/win/d/otra',
      '/win/c/lazunox/tareas/a/../b',
      '/win/c/lazunox/tareas/a/x:ads'
    ]) {
      expect(l.toHostPath(bad), bad).toBeNull()
    }
    expect(() => l.toSandboxPath('\\\\srv\\x')).toThrow()
    await l.dispose()
  })

  it('launch: la clave real no cabe (centinela falso → init_secret) y rutas UNC fallan antes de lanzar wsl.exe', async () => {
    const t = deps()
    const b = createWslBackend(t.d)
    await expect(
      b.launch(
        launchSpec({ proxyEnv: { OPENCODE_AUTH_CONTENT: JSON.stringify({ 'opencode-go': { type: 'api', key: 'sk-real-0123456789' } }) } })
      )
    ).rejects.toThrow()
    await expect(b.launch(launchSpec({ folder: '\\\\srv\\share' }))).rejects.toThrow()
    expect(t.spawned).toHaveLength(0)
  })

  it('el «child» que ve sandbox.ts: pid de wsl.exe, stderr del servidor y evento exit cuando wsl.exe termina', async () => {
    const t = deps()
    const l = await createWslBackend(t.d).launch(launchSpec())
    const { proc } = t.spawned[0]!
    expect(l.child.pid).toBe(4321)
    expect(l.child.exitCode).toBeNull()
    const logs: string[] = []
    l.child.stderr?.on('data', (c: Buffer) => logs.push(c.toString()))
    proc.stderr.write('servidor escuchando\n')
    await flush()
    expect(logs.join('')).toContain('servidor escuchando')
    const exit = new Promise<number | null>((r) => l.child.once('exit', (c) => r(c)))
    proc.die(7)
    expect(await exit).toBe(7)
    expect(l.child.exitCode).toBe(7)
  })

  it('flujo «in»: baseUrl 127.0.0.1:P llega al servidor de dentro; READY y EXIT del agente', async () => {
    const t = deps()
    const l = await createWslBackend(t.d).launch(launchSpec())
    const { proc } = t.spawned[0]!
    proc.agent(0, FrameType.READY) // el lanzador solo acepta OPEN/DATA después de READY
    await flush()
    const client = new FakeSocket()
    t.inbound(client)
    client.push(Buffer.from('GET /global/health'))
    await flush()
    const open = proc.frames.find((f) => f.type === FrameType.OPEN)!
    expect(open.id % 2).toBe(1)
    proc.agent(open.id, FrameType.DATA, Buffer.from('{"healthy":true}'))
    proc.agent(0, FrameType.EXIT, encodeExit(0))
    await flush()
    expect(Buffer.concat(client.got).toString()).toBe('{"healthy":true}')
    await l.dispose()
  })

  it('kill(): EOF al lanzador y wsl.exe se mata si no sale', async () => {
    const t = deps()
    const l = await createWslBackend(t.d).launch(launchSpec())
    const { proc } = t.spawned[0]!
    l.child.kill('SIGTERM')
    await flush()
    expect(proc.stdin.writableEnded).toBe(true)
    expect(proc.killed).toContain('SIGTERM')
  })
})

describe('WslBackend con setup()/remove() integrados', () => {
  const LAD = 'C:\\Users\\Ben\\AppData\\Local'
  const P = wslSetupPaths(LAD)
  const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
  const OPENCODE = Buffer.from('tgz')
  const PY = [{ path: 'launcher.py', data: Buffer.from('print(1)') }]
  const PIN: SetupPin = {
    rootfs: parseWslPin({
      version: '2026.10.1',
      minVersion: '2026.10.1',
      builtAt: '2026-10-01',
      url: wslRootfsUrl('2026.10.1'),
      sha256: 'ab'.repeat(32),
      size: 100,
      unpackedMax: 500
    })!,
    opencode: {
      version: '1.18.33',
      url: 'https://github.com/anomalyco/opencode/releases/download/v1.18.33/o.tar.gz',
      sha256: sha(OPENCODE),
      size: OPENCODE.length
    }
  }
  const GOOD = encodeLzpk([...PY, { path: 'bin/opencode', data: OPENCODE }]).payloadSha

  function world(initialPayload: string | null) {
    const st = { registered: true, payloadSha: initialPayload as string | null }
    const runs: string[] = []
    const inputs: Array<{ spec: WslSpawnSpec; ms: number }> = []
    const files = new Map<string, Buffer>([[P.statePath, Buffer.from('{}')]])
    const extras: WslSetupExtras = {
      runWithInput: async (spec, input: Readable, ms) => {
        inputs.push({ spec, ms })
        const chunks: Buffer[] = []
        for await (const c of input) chunks.push(Buffer.from(c as Buffer))
        const buf = Buffer.concat(chunks)
        st.payloadSha = sha(buf.subarray(10, 10 + buf.readUInt32BE(6)))
        return ok(JSON.stringify({ ok: true, payloadSha: st.payloadSha }))
      },
      runToFile: async () => ok(''),
      download: async (_u, dest) => {
        files.set(dest, OPENCODE)
        return { cached: false }
      },
      fs: {
        mkdir: async () => undefined,
        lstat: async (p) => {
          const f = files.get(p)
          return f ? { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, size: f.length } : null
        },
        readdir: async () => [],
        rename: async (a, b) => void files.set(b, files.get(a)!),
        rm: async (p) => void files.delete(p),
        rmdir: async () => undefined,
        freeBytes: async () => 10 * 1024 ** 3,
        sha256: async () => '',
        readFile: async (p) => files.get(p) ?? Buffer.alloc(0),
        writeFile: async (p, d) => void files.set(p, Buffer.from(d)),
        readStream: () => Readable.from([]),
        copyFile: async (a, b) => void files.set(b, files.get(a) ?? Buffer.alloc(0))
      },
      localAppData: LAD,
      pin: () => PIN,
      payloadFiles: async () => PY,
      now: () => 0,
      log: () => undefined
    }
    const t = deps({
      setup: extras,
      run: async (spec) => {
        const a = spec.args.join(' ')
        runs.push(a)
        if (a === '--version') return ok('WSL version: 2.4.13.0\nKernel version: 6.6.87.2\n')
        if (a === '-l -v') return ok(st.registered ? '  NAME STATE VERSION\n* Lazunox-Tareas Stopped 2\n' : 'no distros')
        if (a === '--terminate Lazunox-Tareas') return ok('')
        if (a === '--unregister Lazunox-Tareas') {
          st.registered = false
          return ok('')
        }
        return ok(
          JSON.stringify({
            interop: false,
            driveMounts: [],
            landlockAbi: 4,
            kernel: '6.6',
            uid: 0,
            rootfs: { id: 'lazunox-rootfs', version: '2026.10.1' },
            payloadSha: st.payloadSha
          })
        )
      }
    })
    return { t, runs, inputs, st, files }
  }

  it('sin WslDeps.setup no hay setup ni remove (el backend solo lee el estado y lanza)', () => {
    const b = createWslBackend(deps().d)
    expect(b.setup).toBeUndefined()
    expect(b.remove).toBeUndefined()
  })

  it('status compara con el pin: carga distinta → needsSetup update:payload; igual → ready', async () => {
    const stale = world('d'.repeat(64))
    expect(await createWslBackend(stale.t.d).status()).toEqual({ state: 'needsSetup', detail: 'update:payload' })
    const fresh = world(GOOD)
    expect((await createWslBackend(fresh.t.d).status()).state).toBe('ready')
  })

  it('setup(): actualiza la carga por wsl.exe con ruta absoluta y la lista cerrada, y queda ready', async () => {
    const w = world('d'.repeat(64))
    const b = createWslBackend(w.t.d)
    const progress: number[] = []
    await b.setup!((p) => progress.push(p), { kind: 'update' })
    expect(w.inputs).toHaveLength(1)
    expect(w.inputs[0]!.spec.command).toBe('C:\\Windows\\System32\\wsl.exe')
    expect(w.inputs[0]!.spec.args).toEqual(['-d', 'Lazunox-Tareas', '-u', 'root', '--cd', '/', '--exec', '/usr/local/sbin/lazunox-install'])
    expect(w.inputs[0]!.spec.env).toEqual({ SystemRoot: 'C:\\Windows', WSLENV: '', WSL_UTF8: '1' })
    expect(progress.at(-1)).toBe(100)
    expect((await b.status()).state).toBe('ready')
    expect(w.runs.some((r) => /shutdown|--unregister/.test(r))).toBe(false)
  })

  it('remove(): terminate + unregister solo de Lazunox-Tareas', async () => {
    const w = world(GOOD)
    await createWslBackend(w.t.d).remove!()
    expect(w.runs).toEqual(['-l -v', '--terminate Lazunox-Tareas', '--unregister Lazunox-Tareas'])
    expect(w.st.registered).toBe(false)
    expect(w.files.has(P.statePath)).toBe(false)
  })

  it('errores tipados: LOCALAPPDATA inválida no llega a wsl.exe', async () => {
    const w = world(GOOD)
    const t = deps({ setup: { ...(w.t.d.setup as WslSetupExtras), localAppData: '\\\\srv\\share' } })
    await expect(createWslBackend(t.d).remove!()).rejects.toBeInstanceOf(WslSetupError)
    expect(t.runs).toEqual([])
  })
})
