import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InstallState } from '@shared/update-install'
import { nodeInstallerFs, stagingRoot, UpdateInstaller, type FetchLike, type InstallerDeps, type RunFn } from './installer'
import { posixOnly } from '../../test/platform'

const APP_ID = 'cl.bentec.onyxcode'
const REPO = 'o/r'
const TAG = 'v0.4.0'
const BASE = `https://github.com/${REPO}/releases/download/${TAG}`
const ZIP_NAME = 'OnyxCode-0.4.0-arm64.zip'
const ZIP_BYTES = Buffer.alloc(3000, 7)

let tmp: string
let priv: KeyObject
let spki: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-inst-')))
  const k = generateKeyPairSync('ed25519')
  priv = k.privateKey
  spki = k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

interface World {
  manifest: Record<string, unknown>
  manifestBytes?: Buffer
  sig?: string
  zip: Buffer
  routes: Record<string, (() => Response) | undefined>
  requests: { url: string; init: RequestInit }[]
}

function world(over: Record<string, unknown> = {}): World {
  const zip = ZIP_BYTES
  const manifest = {
    schema: 1,
    appId: APP_ID,
    version: '0.4.0',
    tag: TAG,
    platform: 'darwin-arm64',
    keyId: 'k1',
    zip: { name: ZIP_NAME, size: zip.length, sha256: createHash('sha256').update(zip).digest('hex') },
    publishedAt: '2026-09-30T00:00:00Z',
    ...over
  }
  return { manifest, zip, routes: {}, requests: [] }
}

function makeFetch(w: World): FetchLike {
  return async (url, init) => {
    w.requests.push({ url, init })
    const mb = w.manifestBytes ?? Buffer.from(JSON.stringify(w.manifest))
    const sig = w.sig ?? sign(null, mb, priv).toString('base64')
    const r = w.routes[url]
    if (r) return r()
    if (url === `${BASE}/update.json`) return new Response(new Uint8Array(mb), { status: 200 })
    if (url === `${BASE}/update.json.sig`) return new Response(sig, { status: 200 })
    if (url === `${BASE}/${ZIP_NAME}`)
      return new Response(new Uint8Array(w.zip), { status: 200, headers: { 'content-length': String(w.zip.length) } })
    return new Response('nope', { status: 404 })
  }
}

interface RunOpts {
  entries?: string[]
  uncompressed?: number
  codesign?: number
  ident?: string
  plistId?: string
  plistVersion?: string
  onExtract?: (extractDir: string) => void
}
function makeRun(calls: string[][], o: RunOpts = {}): RunFn {
  return async (cmd, args) => {
    calls.push([cmd, ...args])
    const ok = (stdout = '', stderr = ''): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout, stderr })
    if (cmd === '/usr/bin/zipinfo' && args[0] === '-1')
      return ok((o.entries ?? ['OnyxCode.app/', 'OnyxCode.app/Contents/Info.plist']).join('\n') + '\n')
    if (cmd === '/usr/bin/zipinfo' && args[0] === '-t')
      return ok(`2 files, ${o.uncompressed ?? 5000} bytes uncompressed, 3000 bytes compressed:  40.0%\n`)
    if (cmd === '/usr/bin/ditto') {
      const dir = args[3]
      const app = join(dir, 'OnyxCode.app')
      mkdirSync(join(app, 'Contents'), { recursive: true })
      writeFileSync(join(app, 'Contents', 'Info.plist'), 'x')
      o.onExtract?.(dir)
      return ok()
    }
    if (cmd === '/usr/bin/codesign' && args[0] === '--verify')
      return { code: o.codesign ?? 0, stdout: '', stderr: o.codesign ? 'invalid' : '' }
    if (cmd === '/usr/bin/codesign' && args[0] === '-dv')
      return ok('', `Executable=x\nIdentifier=${o.ident ?? APP_ID}\nFormat=app bundle\n`)
    if (cmd === '/usr/bin/plutil') return ok(args[1] === 'CFBundleIdentifier' ? (o.plistId ?? APP_ID) : (o.plistVersion ?? '0.4.0'), '')
    if (cmd === '/usr/bin/xattr') return ok()
    return { code: 127, stdout: '', stderr: 'desconocido' }
  }
}

function make(
  w: World,
  o: RunOpts = {},
  extra: Partial<InstallerDeps> = {}
): { inst: UpdateInstaller; states: InstallState[]; calls: string[][] } {
  const states: InstallState[] = []
  const calls: string[][] = []
  const inst = new UpdateInstaller({
    fetch: makeFetch(w),
    run: makeRun(calls, o),
    fs: { ...nodeInstallerFs(), freeBytes: async () => 10 * 1024 * 1024 },
    userData: tmp,
    appId: APP_ID,
    currentVersion: '0.3.0',
    repo: REPO,
    downloadBase: 'https://github.com',
    allowLoopbackHttp: false,
    keys: [{ id: 'k1', key: spki }],
    userAgent: 'OnyxCode/0.3.0',
    onState: (s) => states.push(s),
    idleMs: 500,
    ...extra
  })
  return { inst, states, calls }
}
const go = async (inst: UpdateInstaller): Promise<InstallState> => {
  await inst.download({ version: '0.4.0', tag: TAG })
  return inst.getState()
}
const staged = (): string => join(stagingRoot(tmp), '0.4.0')

describe('UpdateInstaller: camino feliz', () => {
  it('descarga, verifica y queda «Lista» sin ejecutar nada del staging', async () => {
    const w = world()
    const { inst, states, calls } = make(w)
    const s = await go(inst)
    expect(s.phase).toBe('ready')
    expect(states.map((x) => x.phase)).toEqual(expect.arrayContaining(['downloading', 'verifying', 'ready']))
    expect(
      states.filter((x) => x.phase === 'downloading').some((x) => x.received === ZIP_BYTES.length && x.total === ZIP_BYTES.length)
    ).toBe(true)
    const cmds = calls.map((c) => `${c[0].split('/').pop()} ${c[1]}`)
    expect(cmds).toEqual([
      'zipinfo -1',
      'zipinfo -t',
      'ditto -x',
      'codesign --verify',
      'codesign -dv',
      'plutil -extract',
      'plutil -extract',
      'xattr -dr'
    ])
    // Solo binarios del sistema, nada dentro del staging como ejecutable.
    for (const c of calls) expect(c[0].startsWith('/usr/bin/')).toBe(true)
    expect(inst.getReady()?.stagedApp).toBe(join(staged(), 'extract', 'OnyxCode.app'))
    if (posixOnly) expect(statSync(staged()).mode & 0o777).toBe(0o700)
    // Sin credenciales ni cookies en las peticiones.
    for (const r of w.requests) {
      expect(r.init.credentials).toBe('omit')
      expect(r.init.redirect).toBe('manual')
      expect(JSON.stringify(r.init.headers)).not.toMatch(/authorization|cookie/i)
    }
  })

  it('borra el staging anterior de esa versión al empezar', async () => {
    mkdirSync(staged(), { recursive: true })
    writeFileSync(join(staged(), 'viejo.txt'), 'x')
    const { inst } = make(world())
    await go(inst)
    expect(existsSync(join(staged(), 'viejo.txt'))).toBe(false)
  })

  it('beginInstall vuelve a verificar y pasa a «installing»; si la firma del paquete cambió, falla', async () => {
    const { inst } = make(world())
    await go(inst)
    const r = await inst.beginInstall()
    expect(r.version).toBe('0.4.0')
    expect(inst.getState().phase).toBe('installing')

    const bad = make(world(), {})
    await go(bad.inst)
    let failNext = false
    const realRun = makeRun([], {})
    ;(bad.inst as unknown as { d: { run: RunFn } }).d.run = async (c, a) =>
      failNext && c === '/usr/bin/codesign' ? { code: 1, stdout: '', stderr: 'x' } : realRun(c, a)
    failNext = true
    await expect(bad.inst.beginInstall()).rejects.toMatchObject({ code: 'signing' })
    expect(bad.inst.getState()).toMatchObject({ phase: 'error', code: 'signing' })
  })
})

describe('UpdateInstaller: resultado de un reemplazo anterior', () => {
  it('preset muestra el error solo si no hay nada en curso', async () => {
    const { inst, states } = make(world())
    inst.preset('rolled-back', '0.4.0')
    expect(inst.getState()).toMatchObject({ phase: 'error', code: 'rolled-back', version: '0.4.0' })
    expect(states).toHaveLength(1)
    // Se puede reintentar desde ese error.
    expect((await go(inst)).phase).toBe('ready')
    inst.preset('install', '0.4.0')
    expect(inst.getState().phase).toBe('ready')
  })
})

describe('UpdateInstaller: redirecciones', () => {
  const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=abc'
  it('sigue el 302 de GitHub hacia *.githubusercontent.com (sin credenciales)', async () => {
    const w = world()
    w.routes[`${BASE}/${ZIP_NAME}`] = () => new Response(null, { status: 302, headers: { location: cdn } })
    w.routes[cdn] = () => new Response(new Uint8Array(w.zip), { status: 200, headers: { 'content-length': String(w.zip.length) } })
    const { inst } = make(w)
    expect((await go(inst)).phase).toBe('ready')
    expect(w.requests.map((r) => r.url)).toContain(cdn)
  })

  it.each([
    ['host no permitido', 'https://evil.example/x.zip'],
    ['http', 'http://objects.githubusercontent.com/x.zip'],
    ['con credenciales', 'https://user:pw@objects.githubusercontent.com/x.zip'],
    ['sufijo engañoso', 'https://githubusercontent.com.evil.example/x.zip']
  ])('rechaza la redirección: %s', async (_n, to) => {
    const w = world()
    w.routes[`${BASE}/${ZIP_NAME}`] = () => new Response(null, { status: 302, headers: { location: to } })
    const { inst } = make(w)
    expect(await go(inst)).toMatchObject({ phase: 'error', code: 'network' })
    expect(w.requests.map((r) => r.url)).not.toContain(to)
  })

  it('admite 3 saltos pero no 4', async () => {
    const hop = (n: number): string => `https://objects.githubusercontent.com/h${n}`
    const chain = (w: World, last: number): void => {
      w.routes[`${BASE}/${ZIP_NAME}`] = () => new Response(null, { status: 302, headers: { location: hop(1) } })
      for (let i = 1; i < last; i++) w.routes[hop(i)] = () => new Response(null, { status: 307, headers: { location: hop(i + 1) } })
      w.routes[hop(last)] = () => new Response(new Uint8Array(w.zip), { status: 200 })
    }
    const ok = world()
    chain(ok, 3)
    expect((await go(make(ok).inst)).phase).toBe('ready')
    const many = world()
    chain(many, 4)
    expect(await go(make(many).inst)).toMatchObject({ phase: 'error', code: 'network' })
  })

  it('redirección sin Location o HTTP de error → network', async () => {
    const a = world()
    a.routes[`${BASE}/${ZIP_NAME}`] = () => new Response(null, { status: 302 })
    expect(await go(make(a).inst)).toMatchObject({ code: 'network' })
    const b = world()
    b.routes[`${BASE}/${ZIP_NAME}`] = () => new Response('x', { status: 500 })
    expect(await go(make(b).inst)).toMatchObject({ code: 'network' })
  })
})

describe('UpdateInstaller: autenticidad y manifiesto', () => {
  it('firma de otra clave', async () => {
    const w = world()
    w.sig = sign(null, Buffer.from('otra cosa'), generateKeyPairSync('ed25519').privateKey).toString('base64')
    expect(await go(make(w).inst)).toMatchObject({ phase: 'error', code: 'signature' })
  })
  it('manifiesto alterado tras firmar (un byte)', async () => {
    const w = world()
    const good = Buffer.from(JSON.stringify(w.manifest))
    w.sig = sign(null, good, priv).toString('base64')
    w.manifestBytes = Buffer.from(good.toString().replace('0.4.0', '0.4.1'))
    const { inst, calls } = make(w)
    expect(await go(inst)).toMatchObject({ code: 'signature' })
    expect(calls).toHaveLength(0)
  })
  it('firma válida pero JSON con forma incorrecta: manifest (la firma se comprueba antes de parsear)', async () => {
    const w = world()
    w.manifestBytes = Buffer.from('no es json')
    w.sig = sign(null, w.manifestBytes, priv).toString('base64')
    expect(await go(make(w).inst)).toMatchObject({ code: 'manifest' })
  })
  it('firma basura y JSON basura: signature, no manifest', async () => {
    const w = world()
    w.manifestBytes = Buffer.from('{ no es json')
    w.sig = 'AAAA'
    expect(await go(make(w).inst)).toMatchObject({ code: 'signature' })
  })
  it('downgrade firmado correctamente se rechaza', async () => {
    const w = world()
    expect(await go(make(w, {}, { currentVersion: '0.4.0' }).inst)).toMatchObject({ code: 'downgrade' })
    expect(await go(make(w, {}, { currentVersion: '9.0.0' }).inst)).toMatchObject({ code: 'downgrade' })
  })
  it('appId o keyId distintos', async () => {
    expect(await go(make(world({ appId: 'otra.app' })).inst)).toMatchObject({ code: 'manifest' })
    expect(await go(make(world({ keyId: 'k9' })).inst)).toMatchObject({ code: 'manifest' })
  })
  it('manifiesto o firma gigantes se cortan', async () => {
    const w = world()
    w.routes[`${BASE}/update.json`] = () => new Response(new Uint8Array(20 * 1024).fill(65), { status: 200 })
    expect(await go(make(w).inst)).toMatchObject({ code: 'manifest' })
    const s = world()
    s.routes[`${BASE}/update.json.sig`] = () => new Response(new Uint8Array(2048).fill(65), { status: 200 })
    expect(await go(make(s).inst)).toMatchObject({ code: 'manifest' })
  })
  it('durante la rotación acepta la clave vieja y exige su keyId', async () => {
    const w = world()
    const nueva = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const keys = [
      { id: 'k2', key: nueva },
      { id: 'k1', key: spki }
    ]
    expect((await go(make(w, {}, { keys }).inst)).phase).toBe('ready')
    expect(await go(make(world({ keyId: 'k2' }), {}, { keys }).inst)).toMatchObject({ code: 'manifest' })
  })
})

describe('UpdateInstaller: descarga', () => {
  it('SHA-256 distinto', async () => {
    const w = world()
    w.zip = Buffer.alloc(ZIP_BYTES.length, 9)
    expect(await go(make(w).inst)).toMatchObject({ phase: 'error', code: 'hash' })
  })
  it('más bytes que el tamaño firmado: corta la lectura', async () => {
    const w = world()
    const big = Buffer.alloc(ZIP_BYTES.length * 3, 7)
    w.routes[`${BASE}/${ZIP_NAME}`] = () => new Response(new Uint8Array(big), { status: 200 })
    const { inst } = make(w)
    expect(await go(inst)).toMatchObject({ code: 'size' })
    await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(staged())).toBe(false)
  })
  it('Content-Length distinto del firmado, o descarga corta', async () => {
    const a = world()
    a.routes[`${BASE}/${ZIP_NAME}`] = () => new Response(new Uint8Array(ZIP_BYTES), { status: 200, headers: { 'content-length': '5' } })
    expect(await go(make(a).inst)).toMatchObject({ code: 'size' })
    const b = world()
    b.routes[`${BASE}/${ZIP_NAME}`] = () => new Response(new Uint8Array(ZIP_BYTES.subarray(0, 100)), { status: 200 })
    expect(await go(make(b).inst)).toMatchObject({ code: 'size' })
  })
  it('sin espacio libre', async () => {
    const { inst } = make(world(), {}, { fs: { ...nodeInstallerFs(), freeBytes: async () => 100 } })
    expect(await go(inst)).toMatchObject({ code: 'space' })
  })
  it('error de red', async () => {
    const { inst } = make(world(), {}, { fetch: async () => Promise.reject(new TypeError('fetch failed')) })
    expect(await go(inst)).toMatchObject({ phase: 'error', code: 'network' })
  })
  it('cuerpo que se corta a medias → network', async () => {
    const w = world()
    w.routes[`${BASE}/${ZIP_NAME}`] = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(10))
            c.error(new Error('reset'))
          }
        }),
        { status: 200 }
      )
    expect(await go(make(w).inst)).toMatchObject({ code: 'network' })
  })
  it('descarga detenida (sin bytes) se aborta por inactividad', async () => {
    const w = world()
    const inner = makeFetch(w)
    const fetchStalled: FetchLike = async (url, init) => {
      if (!url.endsWith('.zip')) return inner(url, init)
      return new Response(
        new ReadableStream({
          pull: () =>
            new Promise((_ok, ko) => {
              init.signal?.addEventListener('abort', () => ko(new Error('abort')))
            })
        }),
        { status: 200 }
      )
    }
    const { inst } = make(w, {}, { idleMs: 80, fetch: fetchStalled })
    expect(await go(inst)).toMatchObject({ code: 'network' })
  })
  // Salto en Windows: el actualizador (src/main/update) es solo de macOS y no se carga en Windows; aquí el borrado del staging compite con el flujo abierto.
  it.skipIf(!posixOnly)('cancelar a mitad: estado «cancelled» y staging borrado', async () => {
    const w = world()
    let release: () => void = () => undefined
    const gate = new Promise<void>((ok) => (release = ok))
    w.routes[`${BASE}/${ZIP_NAME}`] = () =>
      new Response(
        new ReadableStream({
          async pull(c) {
            c.enqueue(new Uint8Array(100))
            await gate
            c.close()
          }
        }),
        { status: 200 }
      )
    const { inst } = make(w, {}, { idleMs: 5000 })
    const p = inst.download({ version: '0.4.0', tag: TAG })
    await new Promise((r) => setTimeout(r, 100))
    expect(inst.getState().phase).toBe('downloading')
    inst.cancel()
    release()
    await p
    expect(inst.getState().phase).toBe('cancelled')
    await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(staged())).toBe(false)
    // Se puede volver a empezar.
    const again = world()
    ;(inst as unknown as { d: { fetch: FetchLike } }).d.fetch = makeFetch(again)
    expect((await go(inst)).phase).toBe('ready')
  })
})

describe('UpdateInstaller: contenido del ZIP', () => {
  it.each([
    '../evil',
    'OnyxCode.app/../../x',
    '/etc/passwd',
    'Otra.app/x',
    '__MACOSX/._x',
    '__MACOSX/OnyxCode.app/evil',
    'OnyxCode.app/a\\b'
  ])('entrada %j: no se extrae nada', async (entry) => {
    const { inst, calls } = make(world(), { entries: ['OnyxCode.app/', entry] })
    expect(await go(inst)).toMatchObject({ phase: 'error', code: 'zip' })
    expect(calls.some((c) => c[0] === '/usr/bin/ditto')).toBe(false)
  })
  it('ZIP que se expande demasiado', async () => {
    const { inst, calls } = make(world(), { uncompressed: 50 * 1024 * 1024 * 1024 })
    expect(await go(inst)).toMatchObject({ code: 'zip' })
    expect(calls.some((c) => c[0] === '/usr/bin/ditto')).toBe(false)
  })
  it('symlink que apunta fuera de la .app', async () => {
    const { inst } = make(world(), {
      onExtract: (d) => symlinkSync('../../../../etc', join(d, 'OnyxCode.app', 'Contents', 'fuga'))
    })
    expect(await go(inst)).toMatchObject({ code: 'zip' })
  })
  it('symlink absoluto', async () => {
    const { inst } = make(world(), { onExtract: (d) => symlinkSync('/etc/passwd', join(d, 'OnyxCode.app', 'Contents', 'abs')) })
    expect(await go(inst)).toMatchObject({ code: 'zip' })
  })
  it('symlink colgante que saldría de la .app', async () => {
    const { inst } = make(world(), { onExtract: (d) => symlinkSync('../../../nada', join(d, 'OnyxCode.app', 'Contents', 'col')) })
    expect(await go(inst)).toMatchObject({ code: 'zip' })
  })
  it('symlink interno (como los de Electron Framework) es aceptable', async () => {
    const { inst } = make(world(), {
      onExtract: (d) => {
        mkdirSync(join(d, 'OnyxCode.app', 'Contents', 'Frameworks', 'F.framework', 'Versions', 'A'), { recursive: true })
        symlinkSync('A', join(d, 'OnyxCode.app', 'Contents', 'Frameworks', 'F.framework', 'Versions', 'Current'))
        symlinkSync('Versions/Current/F', join(d, 'OnyxCode.app', 'Contents', 'Frameworks', 'F.framework', 'F'))
      }
    })
    expect((await go(inst)).phase).toBe('ready')
  })
  // mkfifo no existe en Windows (el actualizador no es de la v1 de Windows).
  it.skipIf(!posixOnly)('FIFO dentro de la .app', async () => {
    const { inst } = make(world(), { onExtract: (d) => execFileSync('/usr/bin/mkfifo', [join(d, 'OnyxCode.app', 'Contents', 'tuberia')]) })
    expect(await go(inst)).toMatchObject({ code: 'zip' })
  })
  it('codesign --verify falla', async () => {
    expect(await go(make(world(), { codesign: 1 }).inst)).toMatchObject({ code: 'signing' })
  })
  it('identificador de firma distinto', async () => {
    expect(await go(make(world(), { ident: 'com.otra.app' }).inst)).toMatchObject({ code: 'signing' })
  })
  it('Info.plist con otro identificador o con otra versión', async () => {
    expect(await go(make(world(), { plistId: 'com.otra.app' }).inst)).toMatchObject({ code: 'signing' })
    expect(await go(make(world(), { plistVersion: '0.3.0' }).inst)).toMatchObject({ code: 'downgrade' })
  })
  it('tras un fallo de verificación la app no queda lista y se puede reintentar', async () => {
    const { inst } = make(world(), { codesign: 1 })
    expect((await go(inst)).phase).toBe('error')
    expect(inst.getReady()).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(readdirSync(stagingRoot(tmp))).toEqual([])
  })
})
