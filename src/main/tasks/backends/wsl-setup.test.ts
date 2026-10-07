import { createHash } from 'node:crypto'
import { win32 } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { PinnedDownloadError } from './pinned-download'
import { encodeLzpk, type LzpkInputFile } from './wsl-payload'
import { parseWslPin, wslRootfsUrl } from './wsl-pin'
import { WSL_DISTRO, WSL_INSTALLER_PATH, assertAllowedWslArgs, wslArgs, type WslCommand } from './wsl-spec'
import {
  WSL_DOWNLOAD_HOSTS,
  WslSetupError,
  createWslSetup,
  expectedPayloadSha,
  parseSetupPin,
  wslSetupPaths,
  type FsEntry,
  type SetupPin,
  type WslSetupDeps,
  type WslSetupErrorCode,
  type WslSetupFs
} from './wsl-setup'
import type { RunResult } from './wsl-status'

const LAD = 'C:\\Users\\Ben\\AppData\\Local'
const P = wslSetupPaths(LAD)
const OPENCODE_BYTES = Buffer.from('opencode-linux-x64-tarball')
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex')
const NEW_VERSION = '2026.10.1'
const OLD_VERSION = '2026.9.1'

const rootfsPin = parseWslPin({
  version: NEW_VERSION,
  minVersion: OLD_VERSION,
  builtAt: '2026-10-01',
  url: wslRootfsUrl(NEW_VERSION),
  sha256: 'ab'.repeat(32),
  size: 1000,
  unpackedMax: 5000
})!
const PIN: SetupPin = {
  rootfs: rootfsPin,
  opencode: {
    version: '1.18.33',
    url: 'https://github.com/anomalyco/opencode/releases/download/v1.18.33/opencode-linux-x64.tar.gz',
    sha256: sha(OPENCODE_BYTES),
    size: OPENCODE_BYTES.length
  }
}
const PY: LzpkInputFile[] = [
  { path: 'launcher.py', data: Buffer.from('print(1)') },
  { path: 'mux.py', data: Buffer.from('print(2)') }
]
const ROOTFS_TAR = win32.join(P.cacheDir, `rootfs-${PIN.rootfs.sha256.slice(0, 12)}.tar.gz`)
const OPENCODE_TGZ = win32.join(P.cacheDir, `opencode-${PIN.opencode.sha256.slice(0, 12)}.tar.gz`)
const VHDX = win32.join(P.installDir, 'ext4.vhdx')
const BACKUP = win32.join(P.installDir, 'home-backup.tar')
const GOOD_PAYLOAD_SHA = encodeLzpk([...PY, { path: 'bin/opencode', data: OPENCODE_BYTES }]).payloadSha

const A = (c: WslCommand): string => wslArgs(c).join(' ')
const INSTALL = `-d ${WSL_DISTRO} -u root --cd / --exec ${WSL_INSTALLER_PATH}`
const PROBE = `-d ${WSL_DISTRO} -u root --cd / --exec /opt/lazunox/launcher.py --probe`
const EXPORT_HOME = `-d ${WSL_DISTRO} -u root --cd / --exec /opt/lazunox/launcher.py --export-home`
const IMPORT_HOME = `-d ${WSL_DISTRO} -u root --cd / --exec /opt/lazunox/launcher.py --import-home`
const IMPORT = `--import ${WSL_DISTRO} ${P.installDir} ${ROOTFS_TAR} --version 2`
const UNREGISTER = `--unregister ${WSL_DISTRO}`
const TERMINATE = `--terminate ${WSL_DISTRO}`

const res = (code: number | null, out = '', extra: Partial<RunResult> = {}): RunResult => ({
  code,
  stdout: Buffer.from(out),
  stderr: Buffer.alloc(0),
  ...extra
})

interface Ent {
  type: 'file' | 'dir' | 'link'
  size: number
  sha?: string
  data?: Buffer
}

interface Inject {
  versionRes?: RunResult
  importFail?: number
  importTimeout?: boolean
  importVersion?: number
  importGate?: Promise<void>
  listAfterImportMissing?: boolean
  installCode?: number
  installBadSha?: boolean
  installThrows?: boolean
  probe?: Record<string, unknown>
  probeCode?: number
  terminateFail?: boolean
  unregisterFail?: boolean
  exportFail?: boolean
  importHomeFail?: boolean
  writeStateFails?: boolean
  rehashWrong?: boolean
  free?: number
  download?: (url: string, dest: string, o: Parameters<WslSetupDeps['download']>[2]) => Promise<{ cached: boolean }>
  localAppData?: string | undefined
  copyThrows?: boolean
  /** Lo que cambia en la COPIA respecto del origen (simula corrupción al copiar). */
  copyTweak?: Partial<Ent>
}

class World {
  distros = new Map<string, { version: number; rootfsVersion: string; payloadSha: string | null }>()
  calls: string[] = []
  downloads: Array<{ url: string; dest: string; hosts?: readonly string[] }> = []
  rmPaths: string[] = []
  copies: Array<[string, string]> = []
  rmdirPaths: string[] = []
  files = new Map<string, Ent>()
  progress: Array<[number, string]> = []
  homeImported: Buffer[] = []
  installedBuffers: Buffer[] = []
  inject: Inject = {}
  constructor(inject: Inject = {}) {
    this.inject = inject
  }
  has(p: string): boolean {
    return this.files.has(p)
  }
  seedDistro(rootfsVersion = NEW_VERSION, payloadSha: string | null = GOOD_PAYLOAD_SHA, version = 2): void {
    this.distros.set(WSL_DISTRO, { version, rootfsVersion, payloadSha })
    this.files.set(P.installDir, { type: 'dir', size: 0 })
    this.files.set(VHDX, { type: 'file', size: 1 })
    this.files.set(P.statePath, {
      type: 'file',
      size: 2,
      data: Buffer.from(JSON.stringify({ rootfsVersion, rootfsSha: PIN.rootfs.sha256, payloadSha, importedAt: 'x' }))
    })
  }

  private list(): RunResult {
    if (this.distros.size === 0) return res(1, 'Windows Subsystem for Linux has no installed distributions.')
    let out = '  NAME STATE VERSION\n'
    for (const [n, d] of this.distros) out += `* ${n} Stopped ${d.version}\n`
    return res(0, out)
  }

  probeJson(d: { rootfsVersion: string; payloadSha: string | null }): string {
    return JSON.stringify({
      interop: false,
      driveMounts: [],
      landlockAbi: 4,
      kernel: '6.6.87.2',
      uid: 0,
      rootfs: { id: 'lazunox-rootfs', version: d.rootfsVersion },
      payloadSha: d.payloadSha,
      ...this.inject.probe
    })
  }

  async run(cmd: WslCommand): Promise<RunResult> {
    const args = wslArgs(cmd)
    assertAllowedWslArgs(args)
    const a = args.join(' ')
    this.calls.push(a)
    const mine = this.distros.get(WSL_DISTRO)
    switch (cmd.kind) {
      case 'version':
        return this.inject.versionRes ?? res(0, 'WSL version: 2.4.13.0\nKernel version: 6.6.87.2\nWSLg version: 1.0.65\n')
      case 'list':
        if (this.inject.listAfterImportMissing && this.calls.some((c) => c === IMPORT))
          return res(0, '  NAME STATE VERSION\n* Ubuntu Running 2\n')
        return this.list()
      case 'import': {
        await this.inject.importGate
        if (this.inject.importTimeout) return res(null, '', { error: 'timeout' })
        if (this.inject.importFail) {
          this.distros.set(WSL_DISTRO, { version: 2, rootfsVersion: NEW_VERSION, payloadSha: null }) // import a medias
          this.files.set(VHDX, { type: 'file', size: 1 })
          return res(this.inject.importFail)
        }
        this.distros.set(WSL_DISTRO, { version: this.inject.importVersion ?? 2, rootfsVersion: NEW_VERSION, payloadSha: null })
        this.files.set(VHDX, { type: 'file', size: 1 })
        return res(0)
      }
      case 'probe':
        if (this.inject.probeCode) return res(this.inject.probeCode, 'execvpe(/opt/lazunox/launcher.py) failed: No such file or directory')
        if (!mine) return res(1)
        return res(0, this.probeJson(mine))
      case 'terminate':
        return this.inject.terminateFail ? res(1) : res(0)
      case 'unregister':
        if (this.inject.unregisterFail) return res(1)
        this.distros.delete(WSL_DISTRO)
        this.files.delete(VHDX)
        return res(0)
      default:
        throw new Error(`run no esperado: ${a}`)
    }
  }

  async runWithInput(cmd: WslCommand, input: Readable): Promise<RunResult> {
    const a = A(cmd)
    this.calls.push(a)
    const chunks: Buffer[] = []
    for await (const c of input) chunks.push(Buffer.from(c as Buffer))
    const buf = Buffer.concat(chunks)
    if (cmd.kind === 'install') {
      if (this.inject.installThrows) throw new Error('EPIPE')
      if (this.inject.installCode) return res(this.inject.installCode)
      this.installedBuffers.push(buf)
      const mlen = buf.readUInt32BE(6)
      const payloadSha = sha(buf.subarray(10, 10 + mlen))
      const d = this.distros.get(WSL_DISTRO)
      if (d) d.payloadSha = payloadSha
      return res(0, JSON.stringify({ ok: true, payloadSha: this.inject.installBadSha ? 'f'.repeat(64) : payloadSha }) + '\n')
    }
    if (cmd.kind === 'import-home') {
      if (this.inject.importHomeFail) return res(1)
      this.homeImported.push(buf)
      return res(0)
    }
    throw new Error(`runWithInput no esperado: ${a}`)
  }

  async runToFile(cmd: WslCommand, dest: string): Promise<RunResult> {
    this.calls.push(A(cmd))
    if (this.inject.exportFail) return res(1)
    this.files.set(dest, { type: 'file', size: 9, data: Buffer.from('home-tar') })
    return res(0)
  }

  fs: WslSetupFs = {
    mkdir: async (p) => {
      if (!this.files.has(p)) this.files.set(p, { type: 'dir', size: 0 })
    },
    lstat: async (p): Promise<FsEntry | null> => {
      const e = this.files.get(p)
      if (!e) return null
      return { isSymbolicLink: () => e.type === 'link', isDirectory: () => e.type === 'dir', isFile: () => e.type === 'file', size: e.size }
    },
    readdir: async (p) => {
      if (!this.files.has(p)) throw new Error('ENOENT')
      return [...this.files.keys()].filter((k) => win32.dirname(k) === p).map((k) => win32.basename(k))
    },
    rename: async (a, b) => {
      const e = this.files.get(a)!
      this.files.delete(a)
      this.files.set(b, e)
    },
    rm: async (p) => {
      this.rmPaths.push(p)
      this.files.delete(p)
    },
    rmdir: async (p) => {
      this.rmdirPaths.push(p)
      if ([...this.files.keys()].some((k) => k.startsWith(p + '\\'))) throw new Error('ENOTEMPTY')
      this.files.delete(p)
    },
    freeBytes: async () => this.inject.free ?? 50 * 1024 ** 3,
    sha256: async (p) => (this.inject.rehashWrong ? '0'.repeat(64) : (this.files.get(p)?.sha ?? '')),
    readFile: async (p) => {
      const e = this.files.get(p)
      if (!e?.data) throw new Error('ENOENT')
      return e.data
    },
    writeFile: async (p, data) => {
      if (this.inject.writeStateFails) throw new Error('EACCES')
      this.files.set(p, { type: 'file', size: data.length, data: Buffer.from(data) })
    },
    readStream: (p) => Readable.from([this.files.get(p)!.data!], { objectMode: false }),
    copyFile: async (a, b) => {
      this.copies.push([a, b])
      if (this.inject.copyThrows) throw new Error('EIO')
      const e = this.files.get(a)
      if (!e) throw new Error('ENOENT')
      this.files.set(b, { ...e, ...this.inject.copyTweak })
    }
  }

  deps(over: Partial<WslSetupDeps> = {}): WslSetupDeps {
    return {
      platform: 'win32',
      run: (cmd) => this.run(cmd),
      runWithInput: (cmd, input) => this.runWithInput(cmd, input),
      runToFile: (cmd, dest) => this.runToFile(cmd, dest),
      download: async (url, dest, o) => {
        this.downloads.push({ url, dest, hosts: o.hosts })
        if (this.inject.download) return this.inject.download(url, dest, o)
        const isOpencode = url === PIN.opencode.url
        this.files.set(dest, { type: 'file', size: o.size, sha: o.sha256, data: isOpencode ? OPENCODE_BYTES : Buffer.from('rootfs') })
        o.onBytes?.(o.size / 2, o.size)
        o.onBytes?.(o.size, o.size)
        return { cached: false }
      },
      fs: this.fs,
      localAppData: 'localAppData' in this.inject ? this.inject.localAppData : LAD,
      pin: () => PIN,
      payloadFiles: async () => PY,
      now: () => Date.UTC(2026, 9, 6, 12, 0, 0),
      log: () => undefined,
      ...over
    }
  }

  go(opts: { signal?: AbortSignal; kind?: 'install' | 'repair' | 'update' } = {}, over: Partial<WslSetupDeps> = {}): Promise<void> {
    return createWslSetup(this.deps(over)).setup((p, ph) => this.progress.push([p, ph]), opts)
  }
  rm(over: Partial<WslSetupDeps> = {}): Promise<void> {
    return createWslSetup(this.deps(over)).remove()
  }
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof WslSetupError) return e.code
    throw e
  }
  return 'ok'
}

/** Invariantes de seguridad que se exigen en TODA ejecución. */
function assertSafe(w: World): void {
  for (const c of w.calls) {
    expect(c).not.toMatch(/shutdown/i)
    if (c.startsWith('--unregister')) expect(c).toBe(UNREGISTER)
    if (c.startsWith('--terminate')) expect(c).toBe(TERMINATE)
  }
  const known = new Set(['ext4.vhdx', 'home-backup.tar', 'home-backup.tar.part'])
  for (const p of w.rmPaths) {
    const ok =
      (win32.dirname(p) === P.installDir && known.has(win32.basename(p))) ||
      (win32.dirname(p) === P.cacheDir && /^(?:rootfs|opencode)-[0-9a-f]{12}\.tar\.gz(?:\.part)?$/.test(win32.basename(p))) ||
      p === P.statePath ||
      p === `${P.statePath}.tmp`
    expect(ok, `rm fuera de lo permitido: ${p}`).toBe(true)
  }
  for (const p of w.rmdirPaths) expect([P.installDir, P.cacheDir], `rmdir: ${p}`).toContain(p)
}

const STATUS_CALLS = ['--version', '-l -v']
const lastCall = (w: World): string | undefined => w.calls[w.calls.length - 1]

describe('wslSetupPaths / parseSetupPin / expectedPayloadSha (puro)', () => {
  it('rutas bajo %LOCALAPPDATA%\\Lazunox\\wsl (Local, nunca Roaming)', () => {
    expect(P).toEqual({
      root: `${LAD}\\Lazunox\\wsl`,
      installDir: `${LAD}\\Lazunox\\wsl\\Lazunox-Tareas`,
      cacheDir: `${LAD}\\Lazunox\\wsl\\cache`,
      statePath: `${LAD}\\Lazunox\\wsl\\state.json`
    })
  })
  it.each([undefined, '', 'relative\\path', '\\\\srv\\share\\x', '\\\\?\\C:\\x', 'C:foo', 'C:\\PROGRA~1\\x', 'C:\\a\\..\\b', 'C:\\a"b'])(
    'LOCALAPPDATA inválida %j',
    (v) => {
      expect(() => wslSetupPaths(v as string | undefined)).toThrow(WslSetupError)
    }
  )
  it('expectedPayloadSha coincide con el de encodeLzpk (sin tener el tgz)', () => {
    expect(expectedPayloadSha(PY, PIN.opencode)).toBe(GOOD_PAYLOAD_SHA)
    expect(expectedPayloadSha([...PY].reverse(), PIN.opencode)).toBe(GOOD_PAYLOAD_SHA)
    expect(expectedPayloadSha(PY, { sha256: 'c'.repeat(64), size: 5 })).not.toBe(GOOD_PAYLOAD_SHA)
    expect(() => expectedPayloadSha([{ path: '../x.py', data: Buffer.from('x') }], PIN.opencode)).toThrow()
  })
  it('parseSetupPin: exige wsl-rootfs estricto y asset linux-x64 de la misma versión', () => {
    const good = {
      version: '1.18.33',
      assets: { 'linux-x64': { url: PIN.opencode.url, sha256: PIN.opencode.sha256, size: PIN.opencode.size } },
      'wsl-rootfs': rootfsPin
    }
    expect(parseSetupPin(good)).toEqual(PIN)
    const bad = (m: (g: typeof good) => unknown): unknown => parseSetupPin(m(structuredClone(good)))
    expect(bad((g) => ({ ...g, 'wsl-rootfs': undefined }))).toBeNull()
    expect(bad((g) => ({ ...g, version: '1.18.34' }))).toBeNull() // la url es de otra versión
    expect(bad((g) => ({ ...g, assets: {} }))).toBeNull()
    expect(
      bad((g) => ({ ...g, assets: { 'linux-x64': { ...g.assets['linux-x64'], url: 'https://evil.example/opencode.tar.gz' } } }))
    ).toBeNull()
    expect(bad((g) => ({ ...g, assets: { 'linux-x64': { ...g.assets['linux-x64'], sha256: 'zz' } } }))).toBeNull()
    expect(bad((g) => ({ ...g, assets: { 'linux-x64': { ...g.assets['linux-x64'], size: 0 } } }))).toBeNull()
    expect(parseSetupPin(null)).toBeNull()
  })
})

describe('setup(): instalación completa', () => {
  it('orden EXACTO de llamadas, progreso monótono 0-100 con fases y estado final', async () => {
    const w = new World()
    await w.go()
    expect(w.calls).toEqual([...STATUS_CALLS, IMPORT, '-l -v', INSTALL, PROBE, TERMINATE])
    // Descargas: imagen y opencode, hosts cerrados, mismo orden.
    expect(w.downloads.map((d) => [d.url, d.dest])).toEqual([
      [PIN.rootfs.url, ROOTFS_TAR],
      [PIN.opencode.url, OPENCODE_TGZ]
    ])
    expect(w.downloads.every((d) => d.hosts === WSL_DOWNLOAD_HOSTS)).toBe(true)
    const pcts = w.progress.map((p) => p[0])
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b))
    expect(pcts[0]).toBeLessThanOrEqual(5)
    expect(pcts.at(-1)).toBe(100)
    expect(w.progress.at(-1)).toEqual([100, 'done'])
    expect(new Set(w.progress.map((p) => p[1]))).toEqual(
      new Set(['downloading', 'verifying', 'creating', 'installing', 'checking', 'done'])
    )
    expect(w.progress.filter((p) => p[1] === 'downloading').every((p) => p[0] <= 70)).toBe(true)
    // La carga enviada es LZPK1 con el opencode descargado.
    expect(w.installedBuffers).toHaveLength(1)
    expect(w.installedBuffers[0]!.subarray(0, 6).toString('latin1')).toBe('LZPK1\n')
    // state.json, caché borrada, carpeta conservada y distro registrada.
    const st = JSON.parse(w.files.get(P.statePath)!.data!.toString()) as Record<string, string>
    expect(st).toEqual({
      rootfsVersion: NEW_VERSION,
      rootfsSha: PIN.rootfs.sha256,
      payloadSha: GOOD_PAYLOAD_SHA,
      importedAt: '2026-10-06T12:00:00.000Z'
    })
    expect(w.has(ROOTFS_TAR)).toBe(false)
    expect(w.has(OPENCODE_TGZ)).toBe(false)
    expect(w.has(VHDX)).toBe(true)
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
    assertSafe(w)
  })

  it('el import usa installDir y la imagen de la caché con --version 2; ninguna llamada es --shutdown', async () => {
    const w = new World()
    await w.go()
    expect(w.calls).toContain(`--import ${WSL_DISTRO} ${LAD}\\Lazunox\\wsl\\Lazunox-Tareas ${ROOTFS_TAR} --version 2`)
    expect(w.calls.some((c) => /shutdown/.test(c))).toBe(false)
  })

  it('ya listo: no hace nada (solo estado) y avisa 100 %', async () => {
    const w = new World()
    w.seedDistro()
    await w.go()
    expect(w.calls).toEqual([...STATUS_CALLS, PROBE])
    expect(w.progress).toEqual([[100, 'done']])
    expect(w.downloads).toHaveLength(0)
  })

  it('kind es solo una pista: manda el estado real', async () => {
    const w = new World()
    await w.go({ kind: 'repair' })
    expect(w.calls).toContain(IMPORT)
  })

  it('un resto de ext4.vhdx en installDir se borra (solo ese archivo) antes del import', async () => {
    const w = new World()
    w.files.set(P.installDir, { type: 'dir', size: 0 })
    w.files.set(VHDX, { type: 'file', size: 5 })
    w.files.set(win32.join(P.installDir, 'otro.txt'), { type: 'file', size: 1 })
    await w.go()
    expect(w.rmPaths.filter((p) => p.startsWith(P.installDir))).toEqual([VHDX])
    expect(w.has(win32.join(P.installDir, 'otro.txt'))).toBe(true)
    assertSafe(w)
  })
})

describe('setup(): validación previa y cerrojo', () => {
  it.each([undefined, '\\\\srv\\share', 'C:\\PROGRA~1\\x', 'relativa'])(
    'LOCALAPPDATA %j: bad-localappdata sin llamar a wsl.exe',
    async (v) => {
      const w = new World({ localAppData: v as string | undefined })
      expect(await code(w.go())).toBe('bad-localappdata')
      expect(await code(w.rm())).toBe('bad-localappdata')
      expect(w.calls).toEqual([])
    }
  )

  it('sin pin: no-pin', async () => {
    const w = new World()
    expect(await code(w.go({}, { pin: () => null }))).toBe('no-pin')
    expect(w.calls).toEqual([])
  })

  it('fuera de Windows: unsupported', async () => {
    const w = new World()
    expect(await code(w.go({}, { platform: 'darwin' }))).toBe('unsupported')
    expect(await code(w.rm({ platform: 'darwin' }))).toBe('unsupported')
    expect(w.calls).toEqual([])
  })

  it('cerrojo: un segundo setup (o remove) a la vez da busy y no toca WSL; se libera al terminar o fallar', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const w = new World({ download: async () => (await gate, { cached: true }) })
    const first = w.go()
    await new Promise((r) => setImmediate(r))
    const w2 = new World()
    expect(await code(w2.go())).toBe('busy')
    expect(await code(w2.rm())).toBe('busy')
    expect(w2.calls).toEqual([])
    release()
    expect(await code(first)).not.toBe('busy')
    // liberado (incluso tras un fallo): otro setup funciona
    const w3 = new World()
    await w3.go()
    expect(w3.distros.has(WSL_DISTRO)).toBe(true)
  })

  it.each([
    ['needsWsl', { versionRes: res(null, '', { error: 'ENOENT' }) }],
    ['needsVirtualization', { versionRes: res(1, 'Error: 0x80370102 HCS_E_HYPERV_NOT_INSTALLED') }],
    ['needsWsl2', { versionRes: res(0, 'WSL version: 2.0.9.0\nKernel version: 5.15.90.1\n') }]
  ] as Array<[string, Inject]>)('estado %s: blocked, sin descargas ni import', async (state, inject) => {
    const w = new World(inject)
    expect(await code(w.go())).toBe('blocked')
    expect(w.calls.some((c) => c.startsWith('--import') || c.startsWith('--unregister'))).toBe(false)
    expect(w.downloads).toHaveLength(0)
    void state
  })

  it('policyDisabled: blocked', async () => {
    const w = new World()
    expect(await code(w.go({}, { policyDisabled: () => true }))).toBe('blocked')
    expect(w.calls).toEqual([])
  })

  it.each([
    ['wsl1', 1],
    ['foreign-ish interop', 2]
  ])('distro rota (%s) no se repara con setup: blocked (el usuario debe quitarla antes)', async (_n, ver) => {
    const w = new World()
    w.seedDistro(NEW_VERSION, GOOD_PAYLOAD_SHA, ver === 1 ? 1 : 2)
    if (ver === 2) w.inject.probe = { interop: true }
    expect(await code(w.go())).toBe('blocked')
    expect(w.downloads).toHaveLength(0)
    expect(w.calls.some((c) => c.startsWith('--import') || c.startsWith('--unregister'))).toBe(false)
  })

  it('paso 3: sin espacio (< 2 GB) da no-space antes de descargar o tocar WSL', async () => {
    const w = new World({ free: 2 * 1024 ** 3 - 1 })
    expect(await code(w.go())).toBe('no-space')
    expect(w.downloads).toHaveLength(0)
    expect(w.calls).toEqual(STATUS_CALLS)
    assertSafe(w)
    const ok = new World({ free: 2 * 1024 ** 3 })
    await ok.go()
    expect(ok.distros.has(WSL_DISTRO)).toBe(true)
  })
})

describe('setup(): descargas (pasos 4-5)', () => {
  it('sin red: offline, nada importado ni desregistrado', async () => {
    const w = new World({ download: async () => Promise.reject(new PinnedDownloadError('offline')) })
    expect(await code(w.go())).toBe('offline')
    expect(w.calls).toEqual(STATUS_CALLS)
  })
  it.each([
    ['bad-hash', 'bad-hash'],
    ['http', 'download-failed'],
    ['too-big', 'download-failed'],
    ['bad-host', 'download-failed']
  ] as const)('descarga %s -> %s sin tocar WSL', async (pcode, expected) => {
    const w = new World({ download: async () => Promise.reject(new PinnedDownloadError(pcode)) })
    expect(await code(w.go())).toBe(expected)
    expect(w.calls).toEqual(STATUS_CALLS)
  })
  it('fallo al bajar opencode (la imagen ya está en caché): no se importa nada y la imagen se conserva para reintentar', async () => {
    const w = new World({
      download: async (url, dest, o) => {
        if (url === PIN.opencode.url) throw new PinnedDownloadError('offline')
        w.files.set(dest, { type: 'file', size: o.size, sha: o.sha256 })
        return { cached: false }
      }
    })
    expect(await code(w.go())).toBe('offline')
    expect(w.calls).toEqual(STATUS_CALLS)
    expect(w.has(ROOTFS_TAR)).toBe(true)
  })
  it('carga inválida (p. ej. falta launcher.py) da bad-payload antes de tocar WSL', async () => {
    const w = new World()
    expect(await code(w.go({}, { payloadFiles: async () => [{ path: 'mux.py', data: Buffer.from('x') }] }))).toBe('bad-payload')
    expect(w.calls).toEqual(STATUS_CALLS)
  })
})

describe('setup(): origen local incluido en el instalador (WP3)', () => {
  const SRC_ROOTFS = 'C:\\Program Files\\Lazunox\\resources\\wsl\\images\\lazunox-rootfs-2026.10.1-x64.tar.gz'
  const SRC_OPENCODE = 'C:\\Program Files\\Lazunox\\resources\\wsl\\images\\opencode-linux-x64.tar.gz'
  const localSource = (kind: 'rootfs' | 'opencode'): string => (kind === 'rootfs' ? SRC_ROOTFS : SRC_OPENCODE)
  const seed = (w: World, over: { rootfs?: Partial<Ent>; opencode?: Partial<Ent> } = {}): void => {
    w.files.set(SRC_ROOTFS, { type: 'file', size: PIN.rootfs.size, sha: PIN.rootfs.sha256, data: Buffer.from('rootfs'), ...over.rootfs })
    w.files.set(SRC_OPENCODE, { type: 'file', size: PIN.opencode.size, sha: PIN.opencode.sha256, data: OPENCODE_BYTES, ...over.opencode })
  }
  const failClosed = (w: World): void => {
    expect(w.downloads).toEqual([])
    expect(w.calls).toEqual(STATUS_CALLS)
    expect(w.has(ROOTFS_TAR)).toBe(false)
    expect(w.has(`${ROOTFS_TAR}.part`)).toBe(false)
    assertSafe(w)
  }

  it('archivos incluidos buenos: cero descargas, copia a la caché (no se usa en el sitio) y flujo idéntico', async () => {
    const w = new World()
    seed(w)
    await w.go({}, { localSource })
    expect(w.downloads).toEqual([])
    expect(w.copies).toEqual([
      [SRC_ROOTFS, `${ROOTFS_TAR}.part`],
      [SRC_OPENCODE, `${OPENCODE_TGZ}.part`]
    ])
    expect(w.calls).toEqual([...STATUS_CALLS, IMPORT, '-l -v', INSTALL, PROBE, TERMINATE])
    expect(w.calls.some((c) => c.includes(SRC_ROOTFS))).toBe(false) // el import usa la copia de la caché
    expect(w.progress.at(-1)).toEqual([100, 'done'])
    const pcts = w.progress.map((p) => p[0])
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b))
    // El borrado de caché del paso 11 sigue igual y el origen incluido jamás se borra.
    expect(w.has(ROOTFS_TAR)).toBe(false)
    expect(w.has(OPENCODE_TGZ)).toBe(false)
    expect(w.has(SRC_ROOTFS)).toBe(true)
    expect(w.has(SRC_OPENCODE)).toBe(true)
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
    assertSafe(w)
  })

  it('tamaño malo del archivo incluido: bad-bundle sin red, sin descarga alternativa y sin tocar WSL', async () => {
    const w = new World()
    seed(w, { rootfs: { size: PIN.rootfs.size + 1 } })
    expect(await code(w.go({}, { localSource }))).toBe('bad-bundle')
    failClosed(w)
  })

  it('tamaño malo de la COPIA: bad-bundle y el .part se borra', async () => {
    const w = new World()
    seed(w)
    w.inject.copyTweak = { size: PIN.rootfs.size - 1 }
    expect(await code(w.go({}, { localSource }))).toBe('bad-bundle')
    failClosed(w)
    expect(w.rmPaths).toContain(`${ROOTFS_TAR}.part`)
  })

  it('sha malo de la imagen incluida (un byte corrupto): bad-bundle, nada se importa ni se descarga', async () => {
    const w = new World()
    seed(w, { rootfs: { sha: 'f'.repeat(64) } })
    expect(await code(w.go({}, { localSource }))).toBe('bad-bundle')
    failClosed(w)
    expect(w.rmPaths).toContain(`${ROOTFS_TAR}.part`)
  })

  it('sha malo del opencode incluido: bad-bundle; la imagen buena queda en caché para reintentar, sin red', async () => {
    const w = new World()
    seed(w, { opencode: { sha: 'f'.repeat(64) } })
    expect(await code(w.go({}, { localSource }))).toBe('bad-bundle')
    expect(w.downloads).toEqual([])
    expect(w.calls).toEqual(STATUS_CALLS)
    expect(w.has(ROOTFS_TAR)).toBe(true)
    expect(w.has(`${OPENCODE_TGZ}.part`)).toBe(false)
  })

  it('archivo incluido ausente: falla cerrado bad-bundle (NO cae a descargar)', async () => {
    const w = new World()
    seed(w)
    w.files.delete(SRC_ROOTFS)
    expect(await code(w.go({}, { localSource }))).toBe('bad-bundle')
    failClosed(w)
  })

  it('el archivo incluido es un enlace o una carpeta: bad-bundle', async () => {
    for (const type of ['link', 'dir'] as const) {
      const w = new World()
      seed(w, { rootfs: { type } })
      expect(await code(w.go({}, { localSource }))).toBe('bad-bundle')
      failClosed(w)
    }
  })

  it('copyFile revienta: bad-bundle (no io ni download-failed) y sin descargar', async () => {
    const w = new World({ copyThrows: true })
    seed(w)
    expect(await code(w.go({}, { localSource }))).toBe('bad-bundle')
    failClosed(w)
  })

  it('sin archivo incluido (localSource ausente o null): la descarga fijada sigue igual', async () => {
    for (const over of [{}, { localSource: () => null }] as Array<Partial<WslSetupDeps>>) {
      const w = new World()
      await w.go({}, over)
      expect(w.downloads.map((d) => d.url)).toEqual([PIN.rootfs.url, PIN.opencode.url])
      expect(w.copies).toEqual([])
    }
  })

  it('imagen incluida y opencode a descargar (mezcla): cada uno por su camino', async () => {
    const w = new World()
    seed(w)
    await w.go({}, { localSource: (k) => (k === 'rootfs' ? SRC_ROOTFS : null) })
    expect(w.downloads.map((d) => d.url)).toEqual([PIN.opencode.url])
    expect(w.copies).toEqual([[SRC_ROOTFS, `${ROOTFS_TAR}.part`]])
  })

  it('caché ya existente y buena: no copia ni lee el origen', async () => {
    const w = new World()
    seed(w)
    w.files.set(ROOTFS_TAR, { type: 'file', size: PIN.rootfs.size, sha: PIN.rootfs.sha256, data: Buffer.from('rootfs') })
    w.files.delete(SRC_ROOTFS) // aunque el origen faltara, la caché buena basta
    await w.go({}, { localSource })
    expect(w.copies.map((c) => c[0])).toEqual([SRC_OPENCODE])
    expect(w.downloads).toEqual([])
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
  })

  it('caché existente pero corrupta: se vuelve a copiar del incluido', async () => {
    const w = new World()
    seed(w)
    w.files.set(ROOTFS_TAR, { type: 'file', size: PIN.rootfs.size, sha: '0'.repeat(64), data: Buffer.from('mal') })
    await w.go({}, { localSource })
    expect(w.copies[0]).toEqual([SRC_ROOTFS, `${ROOTFS_TAR}.part`])
    expect(w.downloads).toEqual([])
  })

  it('el re-hash del paso 7 sigue vigente con origen local: bad-hash, la copia se borra y no se importa', async () => {
    const w = new World()
    seed(w)
    const orig = w.fs.sha256
    // Buena al copiar (.part), cambiada en disco cuando el paso 7 la vuelve a calcular.
    w.fs.sha256 = async (p) => (p === ROOTFS_TAR && w.copies.length > 0 ? '0'.repeat(64) : orig(p))
    expect(await code(w.go({}, { localSource }))).toBe('bad-hash')
    expect(w.calls.some((c) => c === IMPORT)).toBe(false)
    expect(w.downloads).toEqual([])
  })

  it('cancelación durante la copia: aborted, sin importar y sin dejar el .part', async () => {
    const ac = new AbortController()
    const w = new World()
    seed(w)
    const orig = w.fs.copyFile
    w.fs.copyFile = async (a, b) => {
      await orig(a, b)
      ac.abort()
    }
    expect(await code(w.go({ signal: ac.signal }, { localSource }))).toBe('aborted')
    expect(w.calls).toEqual(STATUS_CALLS)
    expect(w.has(`${ROOTFS_TAR}.part`)).toBe(false)
    expect(w.has(ROOTFS_TAR)).toBe(false)
    expect(w.downloads).toEqual([])
  })

  it('rollback tras el import con origen local: unregister del nombre propio y el origen incluido intacto', async () => {
    const w = new World({ installCode: 1 })
    seed(w)
    expect(await code(w.go({}, { localSource }))).toBe('payload-failed')
    expect(w.calls).toEqual([...STATUS_CALLS, IMPORT, '-l -v', INSTALL, UNREGISTER])
    expect(w.distros.size).toBe(0)
    expect(w.has(SRC_ROOTFS)).toBe(true)
    expect(w.has(SRC_OPENCODE)).toBe(true)
    assertSafe(w)
  })

  it('actualizar la carga (solo opencode) con origen local: copia solo el opencode, sin red ni reimportar', async () => {
    const w = new World()
    seed(w)
    w.seedDistro(NEW_VERSION, 'c'.repeat(64))
    await w.go({ kind: 'update' }, { localSource })
    expect(w.downloads).toEqual([])
    expect(w.copies).toEqual([[SRC_OPENCODE, `${OPENCODE_TGZ}.part`]])
    expect(w.calls.some((c) => c === IMPORT)).toBe(false)
  })
})

describe('setup(): carpeta y huella (pasos 6-7)', () => {
  it('installDir es una junction/enlace: bad-installdir sin import, sin unregister y sin borrar nada', async () => {
    const w = new World()
    w.files.set(P.installDir, { type: 'link', size: 0 })
    w.files.set(VHDX, { type: 'file', size: 1 })
    expect(await code(w.go())).toBe('bad-installdir')
    expect(w.calls).toEqual(STATUS_CALLS)
    expect(w.rmPaths.filter((p) => p.startsWith(P.installDir))).toEqual([])
    expect(w.has(VHDX)).toBe(true)
    assertSafe(w)
  })
  it('installDir es un archivo: bad-installdir', async () => {
    const w = new World()
    w.files.set(P.installDir, { type: 'file', size: 3 })
    expect(await code(w.go())).toBe('bad-installdir')
    expect(w.calls).toEqual(STATUS_CALLS)
  })
  it('un ext4.vhdx residual que es enlace: bad-installdir (no se sigue)', async () => {
    const w = new World()
    w.files.set(P.installDir, { type: 'dir', size: 0 })
    w.files.set(VHDX, { type: 'link', size: 0 })
    expect(await code(w.go())).toBe('bad-installdir')
    expect(w.rmPaths).toEqual([])
  })
  it('el sha recalculado justo antes del import no coincide: bad-hash, la imagen se borra y no se importa', async () => {
    const w = new World({ rehashWrong: true })
    expect(await code(w.go())).toBe('bad-hash')
    expect(w.calls).toEqual(STATUS_CALLS)
    expect(w.has(ROOTFS_TAR)).toBe(false)
    assertSafe(w)
  })
})

describe('setup(): rollback en CADA paso posterior al import', () => {
  type Case = [name: string, inject: Inject, expected: WslSetupErrorCode, callsBeforeUnregister: string[]]
  const imp = [...STATUS_CALLS, IMPORT]
  const cases: Case[] = [
    ['paso 7: import con código de error', { importFail: 1 }, 'import-failed', imp],
    ['paso 7: import excede el tiempo', { importTimeout: true }, 'import-timeout', imp],
    ['paso 8: la distro quedó en WSL1', { importVersion: 1 }, 'wsl1', [...imp, '-l -v']],
    ['paso 8: la distro no aparece en la lista', { listAfterImportMissing: true }, 'import-failed', [...imp, '-l -v']],
    ['paso 9: el instalador falla', { installCode: 1 }, 'payload-failed', [...imp, '-l -v', INSTALL]],
    ['paso 9: el instalador devuelve otro payloadSha', { installBadSha: true }, 'payload-failed', [...imp, '-l -v', INSTALL]],
    ['paso 9: la stdin revienta (excepción)', { installThrows: true }, 'payload-failed', [...imp, '-l -v', INSTALL]],
    ['paso 10: probe con interop', { probe: { interop: true } }, 'probe-failed', [...imp, '-l -v', INSTALL, PROBE]],
    ['paso 10: probe con unidades', { probe: { driveMounts: ['/mnt/c'] } }, 'probe-failed', [...imp, '-l -v', INSTALL, PROBE]],
    ['paso 10: Landlock < 2', { probe: { landlockAbi: 1 } }, 'probe-failed', [...imp, '-l -v', INSTALL, PROBE]],
    [
      'paso 10: rootfs.version distinta del pin',
      { probe: { rootfs: { id: 'lazunox-rootfs', version: '2026.9.1' } } },
      'probe-failed',
      [...imp, '-l -v', INSTALL, PROBE]
    ],
    [
      'paso 10: rootfs.version POSTERIOR al pin (debe ser igual)',
      { probe: { rootfs: { id: 'lazunox-rootfs', version: '2026.12.1' } } },
      'probe-failed',
      [...imp, '-l -v', INSTALL, PROBE]
    ],
    [
      'paso 10: carga distinta de la esperada',
      { probe: { payloadSha: 'e'.repeat(64) } },
      'probe-failed',
      [...imp, '-l -v', INSTALL, PROBE]
    ],
    ['paso 10: distro ajena (sin marcador)', { probe: { rootfs: null } }, 'probe-failed', [...imp, '-l -v', INSTALL, PROBE]],
    ['paso 10: probe que no responde', { probeCode: 1 }, 'probe-failed', [...imp, '-l -v', INSTALL, PROBE]],
    ['paso 11: no se puede escribir state.json', { writeStateFails: true }, 'state-failed', [...imp, '-l -v', INSTALL, PROBE, TERMINATE]]
  ]
  it.each(cases)('%s', async (_n, inject, expected, before) => {
    const w = new World(inject)
    expect(await code(w.go())).toBe(expected)
    expect(w.calls).toEqual([...before, UNREGISTER])
    expect(lastCall(w)).toBe(UNREGISTER)
    // Todo deshecho: sin distro, sin vhdx, sin carpeta ni estado; el estado no queda a medias.
    expect(w.distros.size).toBe(0)
    expect(w.has(VHDX)).toBe(false)
    expect(w.has(P.installDir)).toBe(false)
    expect(w.has(P.statePath)).toBe(false)
    assertSafe(w)
  })

  it('paso 11: terminate fallido NO deshace (la distro está lista y se apaga sola)', async () => {
    const w = new World({ terminateFail: true })
    await w.go()
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
    expect(w.calls.includes(UNREGISTER)).toBe(false)
  })

  it('el unregister del rollback falla: igualmente se borra el vhdx y se informa el error original', async () => {
    const w = new World({ installCode: 1, unregisterFail: true })
    expect(await code(w.go())).toBe('payload-failed')
    expect(w.has(VHDX)).toBe(false)
    assertSafe(w)
  })

  it('el rollback no borra otros archivos de installDir y deja la carpeta si no queda vacía', async () => {
    const w = new World({ installCode: 1 })
    w.files.set(P.installDir, { type: 'dir', size: 0 })
    w.files.set(win32.join(P.installDir, 'ajeno.txt'), { type: 'file', size: 1 })
    await code(w.go())
    expect(w.has(win32.join(P.installDir, 'ajeno.txt'))).toBe(true)
    expect(w.has(P.installDir)).toBe(true)
    assertSafe(w)
  })

  it('si installDir se vuelve junction durante el setup, el rollback desregistra pero NO borra a través del enlace', async () => {
    const w = new World({ installCode: 1 })
    const run = w.runWithInput.bind(w)
    w.runWithInput = async (cmd, input) => {
      w.files.set(P.installDir, { type: 'link', size: 0 })
      return run(cmd, input)
    }
    await code(w.go())
    expect(lastCall(w)).toBe(UNREGISTER)
    expect(w.rmPaths.filter((p) => p.startsWith(P.installDir))).toEqual([])
  })
})

describe('setup(): cancelación', () => {
  it('abortada antes de empezar: aborted sin llamadas', async () => {
    const w = new World()
    const ac = new AbortController()
    ac.abort()
    expect(await code(w.go({ signal: ac.signal }))).toBe('aborted')
    expect(w.calls).toEqual([])
  })
  it('durante la descarga: aborted, WSL sin tocar (nada que deshacer)', async () => {
    const ac = new AbortController()
    const w = new World({
      download: (_u, _d, o) =>
        new Promise((_res, rej) => {
          o.signal?.addEventListener('abort', () => rej(new PinnedDownloadError('aborted')))
          ac.abort()
        })
    })
    expect(await code(w.go({ signal: ac.signal }))).toBe('aborted')
    expect(w.calls).toEqual(STATUS_CALLS)
  })
  it('entre las dos descargas y antes del import: aborted sin import', async () => {
    const ac = new AbortController()
    const w = new World({
      download: async (url, dest, o) => {
        w.files.set(dest, { type: 'file', size: o.size, sha: o.sha256, data: OPENCODE_BYTES })
        if (url === PIN.opencode.url) ac.abort()
        return { cached: false }
      }
    })
    expect(await code(w.go({ signal: ac.signal }))).toBe('aborted')
    expect(w.calls).toEqual(STATUS_CALLS)
  })
  it('durante el import: se espera a que termine y se aplica el MISMO rollback (unregister + vhdx)', async () => {
    const ac = new AbortController()
    let release!: () => void
    const w = new World({ importGate: new Promise<void>((r) => (release = r)) })
    const p = w.go({ signal: ac.signal })
    await new Promise((r) => setTimeout(r, 5))
    expect(w.calls).toEqual([...STATUS_CALLS, IMPORT])
    ac.abort()
    await new Promise((r) => setTimeout(r, 5))
    expect(lastCall(w)).toBe(IMPORT) // sigue esperando
    release()
    expect(await code(p)).toBe('aborted')
    expect(w.calls).toEqual([...STATUS_CALLS, IMPORT, UNREGISTER])
    expect(w.distros.size).toBe(0)
    expect(w.has(VHDX)).toBe(false)
    assertSafe(w)
  })
  it('después del import ya no se cancela: termina bien', async () => {
    const ac = new AbortController()
    const w = new World()
    const run = w.runWithInput.bind(w)
    w.runWithInput = async (cmd, input) => {
      ac.abort()
      return run(cmd, input)
    }
    await w.go({ signal: ac.signal })
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
  })
})

describe('setup(): actualizar la carga (sin reimportar ni desregistrar)', () => {
  const payloadFlow = [...STATUS_CALLS, PROBE, INSTALL, '-l -v', PROBE, TERMINATE]
  it('update:payload: descarga solo opencode, instala, comprueba y no reimporta', async () => {
    const w = new World()
    w.seedDistro(NEW_VERSION, 'd'.repeat(64)) // la distro trae otra carga
    await w.go()
    expect(w.calls).toEqual(payloadFlow)
    expect(w.downloads.map((d) => d.url)).toEqual([PIN.opencode.url])
    expect(w.calls.some((c) => c.startsWith('--import') || c.startsWith('--unregister'))).toBe(false)
    const st = JSON.parse(w.files.get(P.statePath)!.data!.toString()) as Record<string, string>
    expect(st.payloadSha).toBe(GOOD_PAYLOAD_SHA)
    expect(st.importedAt).toBe('x') // no se pierde la fecha del import original
    expect(w.has(OPENCODE_TGZ)).toBe(false)
    expect(w.has(VHDX)).toBe(true)
    assertSafe(w)
  })
  it('broken:payload (setup interrumpido) con state.json: se repara igual', async () => {
    const w = new World({})
    w.seedDistro(NEW_VERSION, null)
    w.inject.probeCode = 0
    // El primer probe (estado) falla por falta de lanzador; los demás responden.
    let n = 0
    const run = w.run.bind(w)
    w.run = async (cmd) => {
      if (cmd.kind === 'probe' && n++ === 0) return res(1, 'execvpe(/opt/lazunox/launcher.py) failed: No such file or directory')
      return run(cmd)
    }
    await w.go({ kind: 'repair' })
    expect(w.calls).toContain(INSTALL)
    expect(w.calls.some((c) => c.startsWith('--import') || c.startsWith('--unregister'))).toBe(false)
  })
  it('sin state.json no se toca una distro que podría ser ajena: foreign', async () => {
    const w = new World()
    w.seedDistro(NEW_VERSION, 'd'.repeat(64))
    w.files.delete(P.statePath)
    expect(await code(w.go())).toBe('foreign')
    expect(w.calls.includes(INSTALL)).toBe(false)
  })
  it.each([
    ['instalador falla', { installCode: 1 }, 'payload-failed'],
    ['probe no coincide', { probe: { interop: true } }, 'probe-failed']
  ] as Array<[string, Inject, string]>)(
    'fallo (%s): error tipado y NUNCA se desregistra (no se pierden datos)',
    async (_n, inject, expected) => {
      const w = new World(inject)
      w.seedDistro(NEW_VERSION, 'd'.repeat(64))
      // el probe de estado debe seguir viendo la carga vieja: solo se inyecta tras el install
      const run = w.run.bind(w)
      let probes = 0
      w.run = async (cmd) => {
        if (cmd.kind === 'probe') {
          probes++
          if (probes === 1)
            return res(
              0,
              w.probeJson({ rootfsVersion: NEW_VERSION, payloadSha: 'd'.repeat(64) }).replace('"interop":true', '"interop":false')
            )
        }
        return run(cmd)
      }
      expect(await code(w.go())).toBe(expected)
      expect(w.calls.some((c) => c.startsWith('--unregister') || c.startsWith('--import'))).toBe(false)
      expect(w.distros.has(WSL_DISTRO)).toBe(true)
      expect(w.has(VHDX)).toBe(true)
      assertSafe(w)
    }
  )
  it('poco espacio para la reparación: no-space', async () => {
    const w = new World({ free: 10 })
    w.seedDistro(NEW_VERSION, 'd'.repeat(64))
    expect(await code(w.go())).toBe('no-space')
  })
})

describe('setup(): actualizar la imagen (export-home, remove, setup, import-home)', () => {
  const flow = [...STATUS_CALLS, PROBE, EXPORT_HOME, TERMINATE, UNREGISTER, IMPORT, '-l -v', INSTALL, PROBE, IMPORT_HOME, TERMINATE]
  it('orden exacto, datos restaurados y respaldo borrado', async () => {
    const w = new World()
    w.seedDistro(OLD_VERSION, GOOD_PAYLOAD_SHA)
    await w.go({ kind: 'update' })
    expect(w.calls).toEqual(flow)
    expect(w.homeImported.map((b) => b.toString())).toEqual(['home-tar'])
    expect(w.has(BACKUP)).toBe(false)
    expect(w.distros.get(WSL_DISTRO)!.rootfsVersion).toBe(NEW_VERSION)
    expect(JSON.parse(w.files.get(P.statePath)!.data!.toString()).rootfsVersion).toBe(NEW_VERSION)
    expect(w.downloads.map((d) => d.url)).toEqual([PIN.rootfs.url, PIN.opencode.url])
    assertSafe(w)
  })
  it('las descargas ocurren ANTES de tocar la distro vieja (si fallan, sigue intacta)', async () => {
    const w = new World({ download: async () => Promise.reject(new PinnedDownloadError('offline')) })
    w.seedDistro(OLD_VERSION, GOOD_PAYLOAD_SHA)
    expect(await code(w.go())).toBe('offline')
    expect(w.calls).toEqual([...STATUS_CALLS, PROBE])
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
  })
  it('export-home falla: la distro vieja queda intacta y no queda respaldo a medias', async () => {
    const w = new World({ exportFail: true })
    w.seedDistro(OLD_VERSION, GOOD_PAYLOAD_SHA)
    expect(await code(w.go())).toBe('backup-failed')
    expect(w.calls.some((c) => c.startsWith('--unregister') || c.startsWith('--import'))).toBe(false)
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
    expect(w.has(VHDX)).toBe(true)
    assertSafe(w)
  })
  it('cancelación hasta el respaldo: aborted y la distro vieja intacta', async () => {
    const ac = new AbortController()
    const w = new World()
    w.seedDistro(OLD_VERSION, GOOD_PAYLOAD_SHA)
    const run = w.runToFile.bind(w)
    w.runToFile = async (cmd, dest) => {
      const r = await run(cmd, dest)
      ac.abort()
      return r
    }
    expect(await code(w.go({ signal: ac.signal }))).toBe('aborted')
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
    expect(w.calls.some((c) => c.startsWith('--unregister'))).toBe(false)
  })
  it('el unregister de la vieja falla y sigue registrada: unregister-failed, sin import', async () => {
    const w = new World({ unregisterFail: true })
    w.seedDistro(OLD_VERSION, GOOD_PAYLOAD_SHA)
    expect(await code(w.go())).toBe('unregister-failed')
    expect(w.calls.some((c) => c.startsWith('--import'))).toBe(false)
    expect(w.distros.has(WSL_DISTRO)).toBe(true)
  })
  it('si la instalación nueva falla se deshace la nueva pero el RESPALDO de datos se conserva y el siguiente setup lo restaura', async () => {
    const w = new World({ installCode: 1 })
    w.seedDistro(OLD_VERSION, GOOD_PAYLOAD_SHA)
    expect(await code(w.go())).toBe('payload-failed')
    expect(w.distros.size).toBe(0)
    expect(w.has(VHDX)).toBe(false)
    expect(w.has(BACKUP)).toBe(true)
    expect(w.has(P.installDir)).toBe(true)
    assertSafe(w)
    // reintento (setup completo): restaura los datos del respaldo y lo borra
    w.inject = {}
    w.calls.length = 0
    await w.go()
    expect(w.calls).toEqual([...STATUS_CALLS, IMPORT, '-l -v', INSTALL, PROBE, IMPORT_HOME, TERMINATE])
    expect(w.homeImported).toHaveLength(1)
    expect(w.has(BACKUP)).toBe(false)
    assertSafe(w)
  })
  it('home-restore fallido: rollback conservando el respaldo', async () => {
    const w = new World({ importHomeFail: true })
    w.seedDistro(OLD_VERSION, GOOD_PAYLOAD_SHA)
    expect(await code(w.go())).toBe('home-restore-failed')
    expect(lastCall(w)).toBe(UNREGISTER)
    expect(w.has(BACKUP)).toBe(true)
    expect(w.has(VHDX)).toBe(false)
  })
  it('sin state.json: foreign (no se toca)', async () => {
    const w = new World()
    w.seedDistro(OLD_VERSION, GOOD_PAYLOAD_SHA)
    w.files.delete(P.statePath)
    expect(await code(w.go())).toBe('foreign')
    expect(w.calls.some((c) => c.startsWith('--unregister'))).toBe(false)
  })
})

describe('remove()', () => {
  it('registrada: list, terminate, unregister (solo el nombre propio); borra vhdx, respaldo, caché y state.json', async () => {
    const w = new World()
    w.seedDistro()
    w.files.set(BACKUP, { type: 'file', size: 1 })
    w.files.set(P.cacheDir, { type: 'dir', size: 0 })
    w.files.set(ROOTFS_TAR, { type: 'file', size: 1 })
    w.files.set(`${ROOTFS_TAR}.part`, { type: 'file', size: 1 })
    w.files.set(win32.join(P.cacheDir, 'ajeno.txt'), { type: 'file', size: 1 })
    await w.rm()
    expect(w.calls).toEqual(['-l -v', TERMINATE, UNREGISTER])
    expect(w.has(VHDX)).toBe(false)
    expect(w.has(BACKUP)).toBe(false)
    expect(w.has(P.installDir)).toBe(false)
    expect(w.has(ROOTFS_TAR)).toBe(false)
    expect(w.has(P.statePath)).toBe(false)
    expect(w.has(win32.join(P.cacheDir, 'ajeno.txt'))).toBe(true) // solo nombres conocidos
    expect(w.has(P.cacheDir)).toBe(true) // no queda vacía
    assertSafe(w)
  })
  it('no registrada (o sin WSL): no llama a terminate ni unregister pero limpia restos', async () => {
    const w = new World()
    w.files.set(P.installDir, { type: 'dir', size: 0 })
    w.files.set(VHDX, { type: 'file', size: 1 })
    w.files.set(P.statePath, { type: 'file', size: 1 })
    await w.rm()
    expect(w.calls).toEqual(['-l -v'])
    expect(w.has(VHDX)).toBe(false)
    expect(w.has(P.statePath)).toBe(false)
    assertSafe(w)
    const noWsl = new World()
    await noWsl.rm({ run: async () => res(null, '', { error: 'ENOENT' }) })
  })
  it('installDir es una junction: desregistra pero NO borra a través del enlace; sí borra caché y estado y avisa bad-installdir', async () => {
    const w = new World()
    w.seedDistro()
    w.files.set(P.installDir, { type: 'link', size: 0 })
    w.files.set(P.cacheDir, { type: 'dir', size: 0 })
    w.files.set(OPENCODE_TGZ, { type: 'file', size: 1 })
    expect(await code(w.rm())).toBe('bad-installdir')
    expect(w.calls).toEqual(['-l -v', TERMINATE, UNREGISTER])
    expect(w.rmPaths.filter((p) => p.startsWith(P.installDir + '\\'))).toEqual([])
    expect(w.rmdirPaths).not.toContain(P.installDir)
    expect(w.has(OPENCODE_TGZ)).toBe(false)
    expect(w.has(P.statePath)).toBe(false)
    assertSafe(w)
  })
  it('el unregister falla y sigue registrada: unregister-failed y NO se borra nada', async () => {
    const w = new World({ unregisterFail: true })
    w.seedDistro()
    expect(await code(w.rm())).toBe('unregister-failed')
    expect(w.rmPaths).toEqual([])
    expect(w.has(VHDX)).toBe(true)
    expect(w.has(P.statePath)).toBe(true)
  })
  it('distro ajena con nuestro nombre: remove también la quita (la confirmación es de la UI), nunca otra distro', async () => {
    const w = new World()
    w.seedDistro()
    w.distros.set('Ubuntu', { version: 2, rootfsVersion: 'x', payloadSha: null })
    await w.rm()
    expect(w.distros.has('Ubuntu')).toBe(true)
    expect(w.distros.has(WSL_DISTRO)).toBe(false)
    assertSafe(w)
  })
  it('setup tras remove vuelve a instalar desde cero', async () => {
    const w = new World()
    await w.go()
    await w.rm()
    expect(w.distros.size).toBe(0)
    w.calls.length = 0
    await w.go()
    expect(w.calls).toEqual([...STATUS_CALLS, IMPORT, '-l -v', INSTALL, PROBE, TERMINATE])
  })
})
