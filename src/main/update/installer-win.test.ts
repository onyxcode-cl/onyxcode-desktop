import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InstallState } from '@shared/update-install'
import { nodeInstallerFs, stagingRoot, type FetchLike, type RunFn } from './installer'
import { stagingDirWin, WinUpdateInstaller, type WinInstallerDeps } from './installer-win'
import { posixOnly } from '../../test/platform'

// Plataforma inyectada: tar.exe y PowerShell se sustituyen por un `run` falso, y el staging cuelga de una carpeta temporal.
// Corre igual en macOS; la extracción real con tar.exe y Defender solo se prueban en Windows.
const APP_ID = 'cl.bentec.lazunox'
const REPO = 'o/r'
const TAG = 'v0.5.1'
const BASE = `https://github.com/${REPO}/releases/download/${TAG}`
const ZIP_NAME = 'Lazunox-0.5.1-win32-x64.zip'
const SYS = 'C:\\Windows'

let tmp: string
let installDir: string
let priv: KeyObject
let spki: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-instwin-')))
  installDir = join(tmp, 'Programs', 'Lazunox')
  mkdirSync(installDir, { recursive: true })
  const k = generateKeyPairSync('ed25519')
  priv = k.privateKey
  spki = k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

interface F {
  path: string
  content: string
  symlink?: boolean
}

function makeAsar(version: string, name = 'lazunox'): string {
  const pkg = Buffer.from(JSON.stringify({ name, version }))
  const json = Buffer.from(JSON.stringify({ files: { 'package.json': { size: pkg.length, offset: '0' } } }))
  const padded = Math.ceil(json.length / 4) * 4
  const head = Buffer.alloc(16 + padded)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(8 + padded, 4)
  head.writeUInt32LE(4 + padded, 8)
  head.writeUInt32LE(json.length, 12)
  json.copy(head, 16)
  return Buffer.concat([head, pkg]).toString('latin1')
}

function goodFiles(version = '0.5.1'): F[] {
  return [
    { path: 'Lazunox.exe', content: 'MZ-app' },
    { path: 'resources/app.asar', content: makeAsar(version) },
    { path: 'resources/opencode/opencode.exe', content: 'MZ-opencode' },
    { path: 'locales/es.pak', content: 'pak' }
  ]
}

/** ZIP «stored» con raíz Lazunox/ (solo lo que lee readZipIndex). */
function makeZip(files: F[], names?: string[]): Buffer {
  const parts: Buffer[] = []
  const cen: Buffer[] = []
  let off = 0
  const all = (names ?? files.map((f) => `Lazunox/${f.path}`)).map((n, i) => ({ n, f: files[i] }))
  for (const { n, f } of all) {
    const name = Buffer.from(n, 'utf8')
    const data = Buffer.from(f?.content ?? '', 'latin1')
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x800, 6)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    parts.push(lh, name, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE((f?.symlink ? 3 : 10) << 8 | 45, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x800, 8)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(f?.symlink ? (0xa1ff << 16) >>> 0 : 0, 38)
    ch.writeUInt32LE(off, 42)
    cen.push(ch, name)
    off += 30 + name.length + data.length
  }
  const cenBuf = Buffer.concat(cen)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(all.length, 8)
  eocd.writeUInt16LE(all.length, 10)
  eocd.writeUInt32LE(cenBuf.length, 12)
  eocd.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cenBuf, eocd])
}

interface World {
  files: F[]
  zip: Buffer
  manifest: Record<string, unknown>
  manifestBytes?: Buffer
  sig?: string
  requests: string[]
}
function world(opts: { files?: F[]; names?: string[]; manifest?: Record<string, unknown> } = {}): World {
  const files = opts.files ?? goodFiles()
  const zip = makeZip(files, opts.names)
  const manifest = {
    schema: 1,
    appId: APP_ID,
    version: '0.5.1',
    tag: TAG,
    platform: 'win32-x64',
    keyId: 'k1',
    zip: { name: ZIP_NAME, size: zip.length, sha256: createHash('sha256').update(zip).digest('hex') },
    publishedAt: '2026-10-06T00:00:00Z',
    ...opts.manifest
  }
  return { files, zip, manifest, requests: [] }
}
function makeFetch(w: World): FetchLike {
  return async (url) => {
    w.requests.push(url)
    const mb = w.manifestBytes ?? Buffer.from(JSON.stringify(w.manifest))
    if (url === `${BASE}/update-win32-x64.json`) return new Response(new Uint8Array(mb), { status: 200 })
    if (url === `${BASE}/update-win32-x64.json.sig`) return new Response(w.sig ?? sign(null, mb, priv).toString('base64'), { status: 200 })
    if (url === `${BASE}/${ZIP_NAME}`)
      return new Response(new Uint8Array(w.zip), { status: 200, headers: { 'content-length': String(w.zip.length) } })
    return new Response('nope', { status: 404 })
  }
}

interface RunOpts {
  /** Ficheros que «tar» deja en disco (por defecto, los del ZIP). */
  extract?: (files: F[]) => F[]
  tarCode?: number
  authCode?: number
}
function makeRun(calls: { cmd: string; args: string[]; env?: Record<string, string> }[], w: World, o: RunOpts = {}): RunFn {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts?.env })
    if (cmd === `${SYS}\\System32\\tar.exe`) {
      if (o.tarCode) return { code: o.tarCode, stdout: '', stderr: 'error' }
      const dest = args[args.indexOf('-C') + 1]
      for (const f of (o.extract ?? ((x) => x))(w.files)) {
        mkdirSync(dirname(join(dest, f.path)), { recursive: true })
        if (f.symlink) symlinkSync('/etc', join(dest, f.path))
        else writeFileSync(join(dest, f.path), Buffer.from(f.content, 'latin1'))
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (cmd.endsWith('powershell.exe')) return { code: o.authCode ?? 0, stdout: '', stderr: '' }
    return { code: 127, stdout: '', stderr: 'desconocido' }
  }
}

function make(w: World, o: RunOpts = {}, extra: Partial<WinInstallerDeps> = {}) {
  const states: InstallState[] = []
  const calls: { cmd: string; args: string[]; env?: Record<string, string> }[] = []
  const inst = new WinUpdateInstaller({
    fetch: makeFetch(w),
    run: makeRun(calls, w, o),
    fs: { ...nodeInstallerFs(), freeBytes: async () => 50 * 1024 * 1024 * 1024 },
    userData: join(tmp, 'ud'),
    appId: APP_ID,
    currentVersion: '0.5.0',
    repo: REPO,
    downloadBase: 'https://github.com',
    allowLoopbackHttp: false,
    keys: [{ id: 'k1', key: spki }],
    userAgent: 'Lazunox/0.5.0',
    onState: (s) => states.push(s),
    idleMs: 500,
    installDir,
    systemRoot: SYS,
    certThumbprint: '',
    ...extra
  })
  return { inst, states, calls }
}
const go = async (inst: WinUpdateInstaller): Promise<InstallState> => {
  await inst.download({ version: '0.5.1', tag: TAG })
  return inst.getState()
}
const staged = (): string => stagingDirWin(installDir, '0.5.1')
const siblings = (): string[] => readdirSync(dirname(installDir)).sort()

describe('WinUpdateInstaller: camino feliz', () => {
  it('descarga, verifica y deja el staging hermano del destino sin tocar la carpeta instalada', async () => {
    writeFileSync(join(installDir, 'Lazunox.exe'), 'vieja')
    const w = world()
    const { inst, states, calls } = make(w)
    const s = await go(inst)
    expect(s.phase).toBe('ready')
    expect(states.map((x) => x.phase)).toEqual(expect.arrayContaining(['downloading', 'verifying', 'ready']))
    expect(inst.getReady()?.stagedApp).toBe(staged())
    expect(staged()).toBe(join(dirname(installDir), '.Lazunox.staging-0.5.1'))
    expect(existsSync(join(staged(), 'Lazunox.exe'))).toBe(true)
    expect(existsSync(join(staged(), 'resources', 'opencode', 'opencode.exe'))).toBe(true)
    expect(readdirSync(installDir)).toEqual(['Lazunox.exe']) // intacta
    // Pide los assets de Windows, no los del Mac.
    expect(w.requests).toContain(`${BASE}/update-win32-x64.json`)
    expect(w.requests.some((u) => u.endsWith('/update.json'))).toBe(false)
    // tar.exe por ruta absoluta de System32, argumentos en array y nada más se ejecuta.
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('C:\\Windows\\System32\\tar.exe')
    expect(calls[0].args).toEqual(['-x', '-f', join(stagingRoot(join(tmp, 'ud')), '0.5.1', ZIP_NAME), '-C', staged(), '--strip-components', '1'])
  })

  it('beginInstall vuelve a verificar y pasa a «installing»', async () => {
    const { inst } = make(world())
    await go(inst)
    const r = await inst.beginInstall()
    expect(r.stagedApp).toBe(staged())
    expect(inst.getState().phase).toBe('installing')
  })

  it('beginInstall rechaza si el staging se manipuló después de verificarlo', async () => {
    const { inst } = make(world())
    await go(inst)
    writeFileSync(join(staged(), 'resources', 'opencode', 'opencode.exe'), 'malo-y-mas-largo')
    await expect(inst.beginInstall()).rejects.toMatchObject({ code: 'zip' })
    expect(inst.getState()).toMatchObject({ phase: 'error', code: 'zip' })
  })
})

describe('WinUpdateInstaller: rechazos antes de tocar nada', () => {
  const fails = async (w: World, code: string, o: RunOpts = {}, extra: Partial<WinInstallerDeps> = {}) => {
    const { inst, calls } = make(w, o, extra)
    const s = await go(inst)
    expect(s).toMatchObject({ phase: 'error', code })
    expect(existsSync(staged())).toBe(false) // el staging se borra
    expect(readdirSync(installDir)).toEqual([]) // la carpeta instalada no se toca
    return calls
  }

  it('firma no válida: ni lee el manifiesto ni descarga el ZIP', async () => {
    const w = world()
    w.sig = Buffer.alloc(64, 1).toString('base64')
    const calls = await fails(w, 'signature')
    expect(calls).toHaveLength(0)
    expect(w.requests.some((u) => u.endsWith('.zip'))).toBe(false)
  })
  it('manifiesto de otra plataforma (el del Mac) con firma válida', async () => {
    await fails(world({ manifest: { platform: 'darwin-arm64' } }), 'manifest')
  })
  it('downgrade', async () => {
    await fails(world(), 'downgrade', {}, { currentVersion: '0.5.1' })
  })
  it('SHA-256 distinto del firmado', async () => {
    const w = world()
    ;(w.manifest.zip as { sha256: string }).sha256 = 'a'.repeat(64)
    await fails(w, 'hash')
  })
  it.each([
    ['con ..', ['Lazunox/Lazunox.exe', 'Lazunox/resources/app.asar', 'Lazunox/resources/opencode/opencode.exe', 'Lazunox/../evil.dll']],
    ['con flujo ADS', ['Lazunox/Lazunox.exe', 'Lazunox/resources/app.asar', 'Lazunox/resources/opencode/opencode.exe', 'Lazunox/a.dll:evil']],
    ['con nombre reservado', ['Lazunox/Lazunox.exe', 'Lazunox/resources/app.asar', 'Lazunox/resources/opencode/opencode.exe', 'Lazunox/NUL.txt']],
    ['con ruta absoluta', ['Lazunox/Lazunox.exe', 'Lazunox/resources/app.asar', 'Lazunox/resources/opencode/opencode.exe', '/etc/x']],
    ['con barra invertida', ['Lazunox/Lazunox.exe', 'Lazunox/resources/app.asar', 'Lazunox/resources/opencode/opencode.exe', 'Lazunox\\..\\x']],
    ['de otra raíz', ['Otra/Lazunox.exe', 'Otra/resources/app.asar', 'Otra/resources/opencode/opencode.exe', 'Otra/x']],
    ['duplicada solo por mayúsculas', ['Lazunox/Lazunox.exe', 'Lazunox/resources/app.asar', 'Lazunox/resources/opencode/opencode.exe', 'Lazunox/LAZUNOX.EXE']]
  ])('entrada del ZIP %s: no extrae nada', async (_n, names) => {
    const base = goodFiles()
    const files = [...base, { path: 'x', content: 'x' }].slice(0, names.length)
    while (files.length < names.length) files.push({ path: 'x', content: 'x' })
    const calls = await fails(world({ files, names }), 'zip')
    expect(calls).toHaveLength(0) // tar.exe ni se lanza
  })
  it('entrada de tipo enlace simbólico en el ZIP', async () => {
    const files = [...goodFiles(), { path: 'link', content: '/etc', symlink: true }]
    const calls = await fails(world({ files }), 'zip')
    expect(calls).toHaveLength(0)
  })
  it('faltan ficheros imprescindibles en el ZIP', async () => {
    const calls = await fails(world({ files: goodFiles().slice(0, 2) }), 'zip')
    expect(calls).toHaveLength(0)
  })
  it('un ZIP que no es ZIP', async () => {
    const w = world()
    w.zip = Buffer.alloc(w.zip.length, 9)
    ;(w.manifest.zip as { sha256: string }).sha256 = createHash('sha256').update(w.zip).digest('hex')
    await fails(w, 'zip')
  })
  it('tar.exe falla', async () => {
    await fails(world(), 'zip', { tarCode: 1 })
  })
  it('espacio insuficiente en el volumen del destino', async () => {
    await fails(world(), 'space', {}, { fs: { ...nodeInstallerFs(), freeBytes: async (p) => (p === dirname(installDir) ? 1024 : 1e12) } })
  })

  describe('tras extraer', () => {
    it('Defender pone en cuarentena un fichero (falta)', async () => {
      await fails(world(), 'zip', { extract: (f) => f.filter((x) => x.path !== 'locales/es.pak') })
    })
    it('un fichero queda con otro tamaño', async () => {
      await fails(world(), 'zip', { extract: (f) => f.map((x) => (x.path === 'locales/es.pak' ? { ...x, content: 'pak!!' } : x)) })
    })
    it('sobra un fichero que no está en el ZIP', async () => {
      await fails(world(), 'zip', { extract: (f) => [...f, { path: 'resources/extra.dll', content: 'x' }] })
    })
    it('sobra una carpeta vacía', async () => {
      // tar deja una carpeta que el índice no conoce (ficheros iguales, más una carpeta): se rechaza al recorrer.
      const w = world()
      const { inst } = make(w, {
        extract: (f) => {
          mkdirSync(join(staged(), 'resources', 'oculta'), { recursive: true })
          return f
        }
      })
      expect(await go(inst)).toMatchObject({ phase: 'error', code: 'zip' })
    })
    it.skipIf(!posixOnly)('aparece un enlace simbólico en lo extraído', async () => {
      await fails(world(), 'zip', { extract: (f) => [...f, { path: 'resources/atajo', content: '', symlink: true }] })
    })
    it('app.asar con otra versión: downgrade', async () => {
      const files = goodFiles('0.4.0')
      await fails(world({ files }), 'downgrade')
    })
    it('app.asar de otra aplicación', async () => {
      const files = goodFiles()
      files[1] = { path: 'resources/app.asar', content: makeAsar('0.5.1', 'otra-app') }
      await fails(world({ files }), 'signing')
    })
    it('app.asar corrupto', async () => {
      const files = goodFiles()
      files[1] = { path: 'resources/app.asar', content: 'no soy un asar, pero soy largo' }
      await fails(world({ files }), 'zip')
    })
  })
})

describe('WinUpdateInstaller: Authenticode opcional', () => {
  const T = 'AB'.repeat(20)
  it('sin huella configurada no ejecuta PowerShell', async () => {
    const { inst, calls } = make(world())
    await go(inst)
    expect(calls.some((c) => c.cmd.endsWith('powershell.exe'))).toBe(false)
  })
  it('con huella válida exige Authenticode y pasa la ruta por entorno, no por la línea de comandos', async () => {
    const { inst, calls } = make(world(), {}, { certThumbprint: T })
    expect((await go(inst)).phase).toBe('ready')
    const ps = calls.find((c) => c.cmd.endsWith('powershell.exe'))
    expect(ps?.cmd).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(ps?.env).toEqual({ LAZUNOX_VERIFY_PATH: join(staged(), 'Lazunox.exe'), LAZUNOX_VERIFY_THUMB: T })
    expect(ps?.args.join(' ')).not.toContain(staged())
  })
  it('firma inválida: se rechaza', async () => {
    const { inst } = make(world(), { authCode: 1 }, { certThumbprint: T })
    expect(await go(inst)).toMatchObject({ phase: 'error', code: 'signing' })
    expect(existsSync(staged())).toBe(false)
  })
  it.each(['abc', 'ab'.repeat(20), `${T}; calc`, 'ZZ'.repeat(20)])('huella mal formada %j: falla cerrado sin ejecutar PowerShell', async (bad) => {
    const { inst, calls } = make(world(), {}, { certThumbprint: bad })
    expect(await go(inst)).toMatchObject({ phase: 'error', code: 'signing' })
    expect(calls.some((c) => c.cmd.endsWith('powershell.exe'))).toBe(false)
  })
})

describe('WinUpdateInstaller: cancelar y descartar', () => {
  it('reset de una actualización lista borra también el staging hermano', async () => {
    const { inst } = make(world())
    await go(inst)
    expect(existsSync(staged())).toBe(true)
    inst.reset()
    await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(staged())).toBe(false)
    expect(siblings()).toEqual(['Lazunox'])
  })
})
