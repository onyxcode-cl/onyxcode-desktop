import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { FrameDecoder, FrameType, decodeError, encodeExit, encodeFrame, encodePort, type Frame } from './bridge-protocol'
import { createWslBackend, type WslDeps, type WslProcess } from './wsl'
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
      if (a === '-l -v') return ok(u16('  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n  OnyxCode-Tareas Stopped 2\r\n'))
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
  folder: 'C:\\onyx\\tareas\\a',
  bin: 'C:\\no-se-usa\\opencode.exe',
  serveArgs: ['serve', '--port', '51000', '--hostname', '127.0.0.1'],
  serverPort: 51000,
  isolation: {
    privateDir: 'C:\\Users\\Ben\\AppData\\Roaming\\OnyxCode\\tasks-sandbox\\0123456789abcdef',
    userData: 'C:\\Users\\Ben\\AppData\\Roaming\\OnyxCode'
  },
  configDir: 'C:\\Users\\Ben\\AppData\\Roaming\\OnyxCode\\opencode-config',
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
  it('no está enlazado en producción: selectBackend nunca lo devuelve y index.ts no lo importa', async () => {
    const { selectBackend } = await import('./index')
    for (const p of ['win32', 'linux', 'darwin']) expect(selectBackend(p).id).not.toBe('wsl')
    const noComments = (f: string): string =>
      readFileSync(join(__dirname, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
    expect(noComments('index.ts')).not.toMatch(/wsl/i)
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
      '-d OnyxCode-Tareas -u root --cd / --exec /opt/onyx/launcher.py --probe'
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

  it('launch: spawn de wsl.exe con entorno mínimo, trama INIT sin claves reales y relés solo a los puertos del proxy', async () => {
    const t = deps()
    const b = createWslBackend(t.d)
    const l = await b.launch(launchSpec())
    expect(t.spawned).toHaveLength(1)
    const { spec, proc } = t.spawned[0]!
    expect(spec.command).toBe('C:\\Windows\\System32\\wsl.exe')
    expect(spec.args).toEqual(['-d', 'OnyxCode-Tareas', '-u', 'root', '--cd', '/', '--exec', '/opt/onyx/launcher.py'])
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
    expect(parsed.cwd).toBe('/win/c/onyx/tareas/a')

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
    expect(l.toSandboxPath('C:\\onyx\\tareas\\a\\informe.docx')).toBe('/win/c/onyx/tareas/a/informe.docx')
    expect(l.toHostPath('/win/c/onyx/tareas/a/informe.docx')).toBe('C:\\onyx\\tareas\\a\\informe.docx')
    expect(l.toHostPath('/win/d/Ref/x.txt')).toBe('D:\\Ref\\x.txt')
    for (const bad of [
      '/etc/passwd',
      '/win/c/Users/Ben/.ssh/id_rsa',
      '/win/d/otra',
      '/win/c/onyx/tareas/a/../b',
      '/win/c/onyx/tareas/a/x:ads'
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
    const client = new FakeSocket()
    t.inbound(client)
    client.push(Buffer.from('GET /global/health'))
    await flush()
    const open = proc.frames.find((f) => f.type === FrameType.OPEN)!
    expect(open.id % 2).toBe(1)
    proc.agent(0, FrameType.READY)
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
