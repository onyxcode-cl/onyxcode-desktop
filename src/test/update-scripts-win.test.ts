/**
 * (Solo macOS/Linux: la firma de publicaciones es del Mac por diseño; `readPrivateKey` rechaza a propósito la clave en Windows porque NTFS no tiene
 * bits 0600 y no puede comprobar sus permisos, igual que site-release; ver site-watch.test.ts.)
 *
 * Pruebas en macOS de los scripts de actualización para `--platform win32-x64` (publish-update, sign-update, verify-update), con un
 * «win-unpacked» FALSO y pequeño en $TMPDIR y claves de prueba efímeras (nunca una clave real). Sin red y sin Windows.
 * Incluye la ida y vuelta: lo que publish+sign producen lo acepta el WinUpdateInstaller real de la app (índice del ZIP, cotejo de
 * ficheros, versión del asar), con el `tar.exe` sustituido por el bsdtar de macOS, que lee el mismo formato.
 * NO prueba: tar.exe de Windows, el swap con la app real ni Defender.
 */
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  appendFileSync,
  readdirSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseManifest as sharedParse, validateManifest as sharedValidate } from '@shared/update-install'
import { nodeInstallerFs, type FetchLike, type RunFn } from '../main/update/installer'
import { WinUpdateInstaller, stagingDirWin } from '../main/update/installer-win'
import { posixOnly } from './platform'
import { readAsarPackageInfo } from '../main/update/asar-version'
import { fileSource, readZipIndex } from '../main/update/zip-index'
import * as lib from '../../scripts/update-lib.mjs'
// @ts-expect-error: script .mjs sin tipos
import { publish } from '../../scripts/publish-update.mjs'
// @ts-expect-error: idem
import { signUpdate } from '../../scripts/sign-update.mjs'
// @ts-expect-error: idem
import { verifyUpdate } from '../../scripts/verify-update.mjs'

const APP_ID = 'cl.bentec.lazunox'
const WIN_MANIFEST = 'update-win32-x64.json'
const WIN_SIG = 'update-win32-x64.json.sig'
const hasTar = existsSync('/usr/bin/tar')

let base: string
let keys: string
let keyFile: string
let priv: KeyObject
let pubB64: string

/** package.json mínimo dentro de un asar válido (misma construcción que las pruebas de asar-version). */
function makeAsar(version: string, name = 'lazunox'): Buffer {
  const pkg = Buffer.from(JSON.stringify({ name, version }))
  const json = Buffer.from(JSON.stringify({ files: { 'package.json': { size: pkg.length, offset: '0' } } }))
  const padded = Math.ceil(json.length / 4) * 4
  const head = Buffer.alloc(16 + padded)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(8 + padded, 4)
  head.writeUInt32LE(4 + padded, 8)
  head.writeUInt32LE(json.length, 12)
  json.copy(head, 16)
  return Buffer.concat([head, pkg, Buffer.alloc(4096, 7)])
}

function put(root: string, rel: string, data: Buffer | string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), data)
}

/** win-unpacked falso: lo imprescindible, algo compresible, un fichero ya aleatorio y una carpeta vacía. */
function fakeWinApp(dir: string, version: string, asarVersion = version): string {
  const app = join(dir, 'win-unpacked')
  put(app, 'Lazunox.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(3000, 1)]))
  put(app, 'resources/app.asar', makeAsar(asarVersion))
  put(app, 'resources/opencode/opencode.exe', Buffer.alloc(5000, 2))
  put(app, 'resources/updater/swap.ps1', 'Write-Output "hola ñandú"\n')
  put(app, 'locales/es.pak', Buffer.alloc(2000, 3))
  put(app, 'locales/ruido.bin', Buffer.from(Array.from({ length: 1500 }, (_, i) => (i * 7919 + 13) % 251)))
  mkdirSync(join(app, 'vacia'), { recursive: true })
  return app
}

function fakeRepo(version: string, publicKey: string): string {
  const r = mkdtempSync(join(base, 'repo-'))
  mkdirSync(join(r, 'src', 'shared'), { recursive: true })
  writeFileSync(join(r, 'package.json'), JSON.stringify({ name: 'lazunox', version }))
  writeFileSync(
    join(r, 'src', 'shared', 'brand.ts'),
    `export const AUTHOR_ALIAS = 'bentec'\nexport const UPDATE_PUBLIC_KEY = '${publicKey}' as string\nexport const UPDATE_KEY_ID = 'k1' as string\n`
  )
  return r
}

const NOW = (): Date => new Date('2026-10-06T12:00:00Z')

/** Publica sin firmar (como el CI) y firma después (como el Mac del dueño): el flujo real de dos pasos. */
async function publishAndSign(version = '0.5.1', asarVersion = version): Promise<{ dir: string; app: string }> {
  const dir = mkdtempSync(join(base, 'out-'))
  const app = fakeWinApp(mkdtempSync(join(base, 'app-')), version, asarVersion)
  const root = fakeRepo(version, pubB64)
  await publish({ platform: 'win32-x64', appPath: app, outDir: dir, manifestOnly: true, root, now: NOW })
  await signUpdate({ dir, platform: 'win32-x64', keyFile, root })
  return { dir, app }
}

const vopts = (dir: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  dir,
  platform: 'win32-x64',
  current: '0.5.0',
  pubkey: pubB64,
  appId: APP_ID,
  keyId: 'k1',
  ...over
})

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'lazunox-updwin-'))
  keys = join(base, 'keys')
  mkdirSync(keys)
  const k = generateKeyPairSync('ed25519')
  priv = k.privateKey
  pubB64 = k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  keyFile = join(keys, 'update.pem')
  writeFileSync(keyFile, k.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), { mode: 0o600 })
  chmodSync(keyFile, 0o600)
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe.skipIf(!posixOnly)('publish-update --platform win32-x64', () => {
  it('genera ZIP con raíz Lazunox/, manifiesto con platform y firma que verify-update acepta', async () => {
    const { dir } = await publishAndSign()
    expect(readdirSync(dir).sort()).toEqual([WIN_MANIFEST, WIN_SIG, 'Lazunox-0.5.1-win32-x64.zip'].sort())
    const m = JSON.parse(readFileSync(join(dir, WIN_MANIFEST), 'utf8'))
    expect(m).toMatchObject({
      schema: 1,
      appId: APP_ID,
      version: '0.5.1',
      tag: 'v0.5.1',
      platform: 'win32-x64',
      keyId: 'k1',
      publishedAt: '2026-10-06T12:00:00.000Z'
    })
    const zip = readFileSync(join(dir, m.zip.name))
    expect(m.zip.size).toBe(zip.length)
    expect(m.zip.sha256).toBe(createHash('sha256').update(zip).digest('hex'))
    const log = (await verifyUpdate(vopts(dir))) as string[]
    const txt = log.join('\n')
    expect(txt).toMatch(/firma Ed25519 del manifiesto: válida/)
    expect(txt).toMatch(/SHA-256 coincide/)
    expect(txt).toMatch(/dentro de Lazunox\//)
    expect(txt).toMatch(/app\.asar del ZIP: lazunox 0\.5\.1/)
    // No se generó nada con los nombres del Mac.
    expect(existsSync(join(dir, 'update.json'))).toBe(false)
  })

  it('es reproducible: la misma carpeta da exactamente los mismos bytes', async () => {
    const app = fakeWinApp(mkdtempSync(join(base, 'rep-')), '0.5.1')
    const root = fakeRepo('0.5.1', pubB64)
    const a = mkdtempSync(join(base, 'ra-'))
    const b = mkdtempSync(join(base, 'rb-'))
    const ra = await publish({ platform: 'win32-x64', appPath: app, outDir: a, manifestOnly: true, root, now: NOW })
    const rb = await publish({ platform: 'win32-x64', appPath: app, outDir: b, manifestOnly: true, root, now: NOW })
    expect(ra.sha256).toBe(rb.sha256)
    expect(readFileSync(join(a, WIN_MANIFEST)).equals(readFileSync(join(b, WIN_MANIFEST)))).toBe(true)
  })

  it('publish con clave (un solo paso) también deja la firma', async () => {
    const app = fakeWinApp(mkdtempSync(join(base, 'one-')), '0.5.1')
    const dir = mkdtempSync(join(base, 'one-out-'))
    const r = await publish({ platform: 'win32-x64', appPath: app, outDir: dir, keyFile, root: fakeRepo('0.5.1', pubB64), now: NOW })
    expect(r.signed).toBe(true)
    await expect(verifyUpdate(vopts(dir))).resolves.toBeTruthy()
  })

  it('rechaza la carpeta incompleta, el asar de otra versión, un nombre de Windows prohibido y un enlace', async () => {
    const root = fakeRepo('0.5.1', pubB64)
    const run = (app: string): Promise<unknown> =>
      publish({ platform: 'win32-x64', appPath: app, outDir: mkdtempSync(join(base, 'bad-')), manifestOnly: true, root, now: NOW })
    const noExe = fakeWinApp(mkdtempSync(join(base, 'b1-')), '0.5.1')
    rmSync(join(noExe, 'resources/opencode/opencode.exe'))
    await expect(run(noExe)).rejects.toThrow(/falta resources\/opencode\/opencode\.exe/)
    await expect(run(fakeWinApp(mkdtempSync(join(base, 'b2-')), '0.5.1', '0.4.0'))).rejects.toThrow(/versión «0\.4\.0» distinta de 0\.5\.1/)
    const reserved = fakeWinApp(mkdtempSync(join(base, 'b3-')), '0.5.1')
    put(reserved, 'locales/aux.txt', 'x')
    await expect(run(reserved)).rejects.toThrow(/nombre no permitido/)
    const link = fakeWinApp(mkdtempSync(join(base, 'b4-')), '0.5.1')
    symlinkSync('/etc', join(link, 'enlace'))
    await expect(run(link)).rejects.toThrow(/enlace simbólico/)
    await expect(run(join(base, 'no-existe'))).rejects.toThrow(/No existe/)
  })

  it('el mismo repo sigue generando el manifiesto del Mac con sus nombres (sin romper la plataforma por defecto)', async () => {
    await expect(
      publish({ appPath: join(base, 'x.app'), outDir: join(base, 'x'), manifestOnly: true, root: fakeRepo('0.5.1', pubB64) })
    ).rejects.toThrow(/npm run package`/)
    await expect(publish({ platform: 'linux', appPath: base, outDir: base, root: fakeRepo('0.5.1', pubB64) })).rejects.toThrow(
      /plataforma desconocida/
    )
  })
})

describe.skipIf(!posixOnly)('sign-update y verify-update: rechazos', () => {
  it('sign-update firma el manifiesto de la plataforma indicada y no el del Mac por error', async () => {
    const dir = mkdtempSync(join(base, 'sg-'))
    const root = fakeRepo('0.5.1', pubB64)
    await publish({
      platform: 'win32-x64',
      appPath: fakeWinApp(mkdtempSync(join(base, 'sgapp-')), '0.5.1'),
      outDir: dir,
      manifestOnly: true,
      root,
      now: NOW
    })
    await expect(signUpdate({ dir, keyFile, root })).rejects.toThrow(/No existe .*update\.json/)
    expect(existsSync(join(dir, WIN_SIG))).toBe(false)
  })

  it('sign-update no firma si el ZIP no coincide con el manifiesto o su asar es de otra versión', async () => {
    const root = fakeRepo('0.5.1', pubB64)
    // 1. ZIP alterado tras generar el manifiesto: tamaño o hash distintos.
    const d1 = mkdtempSync(join(base, 'sg1-'))
    await publish({
      platform: 'win32-x64',
      appPath: fakeWinApp(mkdtempSync(join(base, 'sg1a-')), '0.5.1'),
      outDir: d1,
      manifestOnly: true,
      root,
      now: NOW
    })
    const zp = join(d1, 'Lazunox-0.5.1-win32-x64.zip')
    const buf = readFileSync(zp)
    buf[100] ^= 0xff
    writeFileSync(zp, buf)
    await expect(signUpdate({ dir: d1, platform: 'win32-x64', keyFile, root })).rejects.toThrow(/SHA-256 del ZIP/)
    appendFileSync(zp, 'x')
    await expect(signUpdate({ dir: d1, platform: 'win32-x64', keyFile, root })).rejects.toThrow(/pesa/)
    // 2. ZIP coherente con su manifiesto pero con otro asar: publish ya lo corta; se fabrica a mano saltándolo.
    const d2 = mkdtempSync(join(base, 'sg2-'))
    const evil = fakeWinApp(mkdtempSync(join(base, 'sg2a-')), '0.5.1', '0.4.0')
    writeFileSync(join(d2, WIN_MANIFEST), readFileSync(join(d1, WIN_MANIFEST)))
    lib.buildWinZip(evil, join(d2, 'Lazunox-0.5.1-win32-x64.zip'))
    writeManifest(d2, join(d2, 'Lazunox-0.5.1-win32-x64.zip'), {})
    await expect(signUpdate({ dir: d2, platform: 'win32-x64', keyFile, root })).rejects.toThrow(/versión «0\.4\.0» distinta de 0\.5\.1/)
  })

  it('manifiesto manipulado: un byte cambiado (hash o versión) sin re-firmar → firma inválida', async () => {
    for (const [from, to] of [
      ['0.5.1', '0.9.9'],
      [/"sha256": "[0-9a-f]/, '"sha256": "0']
    ] as const) {
      const { dir } = await publishAndSign()
      const mp = join(dir, WIN_MANIFEST)
      const txt = readFileSync(mp, 'utf8')
      const changed = txt.replace(from as string, to)
      expect(changed).not.toBe(txt)
      writeFileSync(mp, changed)
      await expect(verifyUpdate(vopts(dir))).rejects.toThrow(/firma Ed25519 del manifiesto NO verifica/)
    }
  })

  it('hash manipulado Y re-firmado con la clave buena: el hash no coincide con el ZIP', async () => {
    const { dir } = await publishAndSign()
    const m = JSON.parse(readFileSync(join(dir, WIN_MANIFEST), 'utf8'))
    m.zip.sha256 = 'a'.repeat(64)
    resign(dir, m)
    await expect(verifyUpdate(vopts(dir))).rejects.toThrow(/SHA-256 del ZIP distinto del firmado/)
  })

  it('platform: un manifiesto de Windows no sirve como del Mac ni al revés (aunque la firma sea válida)', async () => {
    const { dir } = await publishAndSign()
    // Windows copiado con los nombres del Mac: la firma verifica, pero la plataforma no es la esperada.
    const asMac = mkdtempSync(join(base, 'asmac-'))
    writeFileSync(join(asMac, 'update.json'), readFileSync(join(dir, WIN_MANIFEST)))
    writeFileSync(join(asMac, 'update.json.sig'), readFileSync(join(dir, WIN_SIG)))
    await expect(verifyUpdate({ ...vopts(asMac), platform: 'darwin-arm64' })).rejects.toThrow(/forma no válida o de otra plataforma/)
    // Un manifiesto del Mac (platform darwin-arm64) firmado y guardado con los nombres de Windows.
    const m = JSON.parse(readFileSync(join(dir, WIN_MANIFEST), 'utf8'))
    m.platform = 'darwin-arm64'
    m.zip.name = 'Lazunox-0.5.1-arm64.zip'
    resign(dir, m)
    await expect(verifyUpdate(vopts(dir))).rejects.toThrow(/de otra plataforma/)
    await expect(signUpdate({ dir, platform: 'win32-x64', keyFile, root: fakeRepo('0.5.1', pubB64) })).rejects.toThrow(/no tiene la forma/)
    // Y el del cliente lo ve igual.
    expect(sharedParse(m)).not.toBeNull()
    expect(lib.parseManifest(m, 'win32-x64')).toBeNull()
  })

  it('versión menor o igual que la instalada: rechazada; appId/keyId/otra clave también', async () => {
    const { dir } = await publishAndSign()
    await expect(verifyUpdate(vopts(dir, { current: '0.5.1' }))).rejects.toThrow(/no es mayor/)
    await expect(verifyUpdate(vopts(dir, { current: '0.6.0' }))).rejects.toThrow(/no es mayor/)
    await expect(verifyUpdate(vopts(dir, { appId: 'otra.app' }))).rejects.toThrow(/appId/)
    await expect(verifyUpdate(vopts(dir, { keyId: 'k9' }))).rejects.toThrow(/keyId/)
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    await expect(verifyUpdate(vopts(dir, { pubkey: other }))).rejects.toThrow(/NO verifica/)
  })

  it('ZIP firmado con una entrada peligrosa, sin imprescindibles o con el asar de otra versión: verify-update lo rechaza', async () => {
    const cases: Array<[string, (app: string) => void, RegExp]> = [
      ['sin opencode.exe', (a) => rmSync(join(a, 'resources/opencode/opencode.exe')), /falta resources\/opencode\/opencode\.exe en el ZIP/],
      ['asar de otra versión', (a) => put(a, 'resources/app.asar', makeAsar('0.4.0')), /versión «0\.4\.0» distinta de 0\.5\.1/],
      ['asar de otra app', (a) => put(a, 'resources/app.asar', makeAsar('0.5.1', 'otra')), /nombre «otra»/]
    ]
    for (const [, mutate, re] of cases) {
      const { dir } = await publishAndSign()
      const app = fakeWinApp(mkdtempSync(join(base, 'mut-')), '0.5.1')
      mutate(app)
      const zp = join(dir, 'Lazunox-0.5.1-win32-x64.zip')
      lib.buildWinZip(app, zp)
      writeManifest(dir, zp, {})
      await expect(verifyUpdate(vopts(dir))).rejects.toThrow(re)
    }
    // Entrada fuera de Lazunox/: se fabrica el ZIP a mano con una entrada «../evil».
    const { dir } = await publishAndSign()
    const zp = join(dir, 'Lazunox-0.5.1-win32-x64.zip')
    const app = fakeWinApp(mkdtempSync(join(base, 'mut2-')), '0.5.1')
    lib.buildWinZip(app, zp)
    const z = readFileSync(zp)
    // Cambia el nombre del primer fichero en ambas cabeceras («Lazunox/Lazunox.exe» → «../evil/.../Lazunox.exe» del mismo largo).
    const from = Buffer.from('Lazunox/locales/')
    const to = Buffer.from('../zunox/locales/'.slice(0, from.length))
    let hit = 0
    for (let i = z.indexOf(from); i >= 0; i = z.indexOf(from, i + 1)) {
      to.copy(z, i)
      hit++
    }
    expect(hit).toBeGreaterThan(0)
    writeFileSync(zp, z)
    writeManifest(dir, zp, {})
    await expect(verifyUpdate(vopts(dir))).rejects.toThrow(/entrada no permitida en el ZIP \(unsafe-name\)/)
  })

  it('los scripts no aceptan el CRC de un ZIP corrompido', async () => {
    const { dir } = await publishAndSign()
    const zp = join(dir, 'Lazunox-0.5.1-win32-x64.zip')
    const z = readFileSync(zp)
    const idx = lib.readZipIndexJs({ size: z.length, read: (o: number, l: number) => z.subarray(o, o + l) })
    const asar = idx.find((e: { name: string }) => e.name === 'Lazunox/resources/app.asar')!
    z[asar.lho + 30 + Buffer.byteLength(asar.name) + Math.floor(asar.csize / 2)] ^= 0x55
    writeFileSync(zp, z)
    writeManifest(dir, zp, {})
    await expect(verifyUpdate(vopts(dir))).rejects.toThrow()
  })
})

describe.skipIf(!posixOnly)('paridad con el cliente (zip-index.ts, asar-version.ts, update-install.ts)', () => {
  it('el índice y el asar que leen los scripts son los mismos que lee la app', async () => {
    const { dir } = await publishAndSign()
    const zp = join(dir, 'Lazunox-0.5.1-win32-x64.zip')
    const z = readFileSync(zp)
    const mine = lib.readZipIndexJs({ size: z.length, read: (o: number, l: number) => z.subarray(o, o + l) })
    const src = await fileSource(zp)
    const theirs = await readZipIndex(src)
    await src.close()
    const pick = (e: { name: string; size: number; method: number; isDirectory: boolean; isSymlink: boolean }): unknown => ({
      name: e.name,
      size: e.size,
      method: e.method,
      isDirectory: e.isDirectory,
      isSymlink: e.isSymlink
    })
    expect(mine.map(pick)).toEqual(theirs.entries.map(pick))
    expect(mine[0].name).toBe('Lazunox/')
    expect(mine.some((e: { name: string }) => e.name === 'Lazunox/vacia/')).toBe(true)
    // asar: lectura directa del fichero con ambos lectores.
    const asarBuf = makeAsar('0.5.1')
    const f = join(base, 'x.asar')
    writeFileSync(f, asarBuf)
    const a = await fileSource(f)
    const info = await readAsarPackageInfo(a)
    await a.close()
    expect(lib.readAsarPackageInfoJs({ size: asarBuf.length, read: (o: number, l: number) => asarBuf.subarray(o, o + l) })).toEqual(info)
    for (const bad of [Buffer.alloc(8), Buffer.alloc(64), asarBuf.subarray(0, 40)]) {
      expect(() => lib.readAsarPackageInfoJs({ size: bad.length, read: (o: number, l: number) => bad.subarray(o, o + l) })).toThrow()
    }
  })

  it('parseManifest y validateManifest de win32-x64 coinciden con los del cliente', () => {
    const SHA = 'b'.repeat(64)
    const mk = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      schema: 1,
      appId: APP_ID,
      version: '0.5.1',
      tag: 'v0.5.1',
      platform: 'win32-x64',
      keyId: 'k1',
      zip: { name: 'Lazunox-0.5.1-win32-x64.zip', size: 10, sha256: SHA },
      publishedAt: '2026-10-06T00:00:00Z',
      ...over
    })
    const cases = [
      mk(),
      mk({ platform: 'darwin-arm64' }),
      mk({ zip: { name: 'Lazunox-0.5.1-arm64.zip', size: 10, sha256: SHA } }),
      mk({ zip: { name: 'Lazunox-0.5.1-win32-x64.zip', size: 10, sha256: 'ZZ' } }),
      mk({ version: '1.0' })
    ]
    for (const c of cases) expect(lib.parseManifest(c, 'win32-x64')).toEqual(sharedParse(c, 'win32-x64'))
    const ctx = { appId: APP_ID, current: '0.5.0', tag: 'v0.5.1', keyId: 'k1' }
    for (const o of [{}, { current: '0.5.1' }, { tag: 'v0.5.2' }, { appId: 'x' }]) {
      const m = sharedParse(mk(), 'win32-x64')!
      expect(lib.validateManifest(m as unknown as Record<string, unknown>, { ...ctx, ...o }) === null).toBe(
        sharedValidate(m, { ...ctx, ...o }).ok
      )
    }
  })
})

describe.skipIf(!posixOnly)('ida y vuelta con el instalador real de la app (WinUpdateInstaller)', () => {
  const TAG = 'v0.5.1'
  const BASE = `https://github.com/o/r/releases/download/${TAG}`
  const SYS = 'C:\\Windows'

  async function installWith(
    dir: string,
    over: { manifest?: Buffer; sig?: string; current?: string } = {}
  ): Promise<{ phase: string; code?: string; staged: string }> {
    const tmp = mkdtempSync(join(base, 'inst-'))
    const installDir = join(tmp, 'Programs', 'Lazunox')
    mkdirSync(installDir, { recursive: true })
    const m = over.manifest ?? readFileSync(join(dir, WIN_MANIFEST))
    const zipName = 'Lazunox-0.5.1-win32-x64.zip'
    const fetchLike: FetchLike = async (url) => {
      if (url === `${BASE}/${WIN_MANIFEST}`) return new Response(new Uint8Array(m), { status: 200 })
      if (url === `${BASE}/${WIN_SIG}`) return new Response(over.sig ?? readFileSync(join(dir, WIN_SIG), 'utf8'), { status: 200 })
      if (url === `${BASE}/${zipName}`) {
        const z = readFileSync(join(dir, zipName))
        return new Response(new Uint8Array(z), { status: 200, headers: { 'content-length': String(z.length) } })
      }
      return new Response('nope', { status: 404 })
    }
    // tar.exe → bsdtar de macOS (mismo formato y mismas opciones usadas por el instalador).
    const run: RunFn = async (cmd, args) => {
      if (cmd !== `${SYS}\\System32\\tar.exe`) return { code: 127, stdout: '', stderr: 'desconocido' }
      const r = spawnSync('/usr/bin/tar', args, { encoding: 'utf8' })
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
    }
    const inst = new WinUpdateInstaller({
      fetch: fetchLike,
      run,
      fs: { ...nodeInstallerFs(), freeBytes: async () => 50 * 1024 * 1024 * 1024 },
      userData: join(tmp, 'ud'),
      appId: APP_ID,
      currentVersion: over.current ?? '0.5.0',
      repo: 'o/r',
      downloadBase: 'https://github.com',
      allowLoopbackHttp: false,
      keys: [{ id: 'k1', key: pubB64 }],
      userAgent: 'Lazunox/0.5.0',
      onState: () => undefined,
      idleMs: 2000,
      installDir,
      systemRoot: SYS,
      certThumbprint: ''
    })
    await inst.download({ version: '0.5.1', tag: TAG })
    const s = inst.getState() as { phase: string; code?: string }
    return { phase: s.phase, code: s.code, staged: stagingDirWin(installDir, '0.5.1') }
  }

  it.skipIf(!hasTar)(
    'lo que publish+sign producen lo acepta la app: queda listo y con todos los ficheros',
    async () => {
      const { dir } = await publishAndSign()
      const r = await installWith(dir)
      expect(r.phase, r.code).toBe('ready')
      for (const f of ['Lazunox.exe', 'resources/app.asar', 'resources/opencode/opencode.exe', 'locales/ruido.bin'])
        expect(existsSync(join(r.staged, f)), f).toBe(true)
      expect(existsSync(join(r.staged, 'vacia'))).toBe(true)
      expect(readFileSync(join(r.staged, 'resources/updater/swap.ps1'), 'utf8')).toContain('ñandú')
    },
    60_000
  )

  it.skipIf(!hasTar)(
    'la app rechaza lo manipulado aunque el manifiesto esté bien firmado',
    async () => {
      const good = await publishAndSign()
      const m = JSON.parse(readFileSync(join(good.dir, WIN_MANIFEST), 'utf8'))
      const signed = (mm: unknown): { manifest: Buffer; sig: string } => {
        const manifest = lib.manifestBytes(mm)
        return { manifest, sig: sign(null, manifest, priv).toString('base64') }
      }
      // hash
      let r = await installWith(good.dir, signed({ ...m, zip: { ...m.zip, sha256: 'c'.repeat(64) } }))
      expect(r.phase).toBe('error')
      // platform del Mac
      r = await installWith(good.dir, signed({ ...m, platform: 'darwin-arm64' }))
      expect(r.phase).toBe('error')
      // versión menor o igual que la instalada
      r = await installWith(good.dir, { current: '0.5.1' })
      expect(r.phase).toBe('error')
      r = await installWith(good.dir, { current: '0.6.0' })
      expect(r.phase).toBe('error')
      // sin tocar nada se acepta (control)
      r = await installWith(good.dir)
      expect(r.phase).toBe('ready')
      // firma de otra clave
      const other = generateKeyPairSync('ed25519').privateKey
      const bytes = readFileSync(join(good.dir, WIN_MANIFEST))
      r = await installWith(good.dir, { manifest: bytes, sig: sign(null, bytes, other).toString('base64') })
      expect(r.phase).toBe('error')
    },
    120_000
  )

  it.skipIf(!hasTar)(
    'la app rechaza un ZIP con el asar de otra versión aunque el manifiesto y el hash estén firmados',
    async () => {
      const { dir } = await publishAndSign()
      const zp = join(dir, 'Lazunox-0.5.1-win32-x64.zip')
      lib.buildWinZip(fakeWinApp(mkdtempSync(join(base, 'old-')), '0.5.1', '0.4.0'), zp)
      writeManifest(dir, zp, {})
      // Los scripts ya lo detectan...
      await expect(verifyUpdate(vopts(dir))).rejects.toThrow(/versión «0\.4\.0»/)
      // ...y la app también, de forma independiente.
      const r = await installWith(dir)
      expect(r.phase).toBe('error')
      expect(r.code).toBe('downgrade')
    },
    60_000
  )
})

/** Reescribe el manifiesto con el tamaño y el hash del ZIP indicado y lo firma con la clave de prueba. */
function writeManifest(dir: string, zipPath: string, over: Record<string, unknown>): void {
  const m = JSON.parse(readFileSync(join(dir, WIN_MANIFEST), 'utf8'))
  const z = readFileSync(zipPath)
  m.zip = { ...m.zip, size: z.length, sha256: createHash('sha256').update(z).digest('hex') }
  resign(dir, { ...m, ...over })
}

function resign(dir: string, m: unknown): void {
  const bytes = lib.manifestBytes(m)
  writeFileSync(join(dir, WIN_MANIFEST), bytes)
  writeFileSync(join(dir, WIN_SIG), lib.signBytes(bytes, priv) + '\n')
}
