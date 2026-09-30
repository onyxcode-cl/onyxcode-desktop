/**
 * Pruebas de scripts/publish-update.mjs y scripts/verify-update.mjs sobre una «.app» de juguete con firma ad-hoc,
 * en un repositorio falso bajo $TMPDIR (nunca el repo real ni una clave real). Sin red.
 */
import { generateKeyPairSync } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
  openSync,
  writeSync,
  closeSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { crc32 } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSafeZipEntry as sharedSafe, parseManifest as sharedParse, validateManifest as sharedValidate } from '@shared/update-install'

import * as lib from '../../scripts/update-lib.mjs'
// @ts-expect-error: idem
import { publish } from '../../scripts/publish-update.mjs'
// @ts-expect-error: idem
import { verifyUpdate } from '../../scripts/verify-update.mjs'

const isMac = process.platform === 'darwin'
const d = isMac ? describe : describe.skip
const APP_ID = 'cl.bentec.onyxcode'

let base: string
let repo: string
let keys: string
let pubB64: string
let privPem: string
let keyFile: string

function toyApp(dir: string, version: string): string {
  const app = join(dir, 'OnyxCode.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'MacOS', 'toy'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(app, 'Contents', 'MacOS', 'toy'), 0o755)
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>toy</string><key>CFBundleIdentifier</key><string>${APP_ID}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`
  )
  const r = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', APP_ID, app], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return app
}

function fakeRepo(version: string, publicKey: string): string {
  const r = mkdtempSync(join(base, 'repo-'))
  mkdirSync(join(r, 'src', 'shared'), { recursive: true })
  writeFileSync(join(r, 'package.json'), JSON.stringify({ name: 'onyxcode', version }))
  writeFileSync(
    join(r, 'src', 'shared', 'brand.ts'),
    `export const AUTHOR_ALIAS = 'bentec'\nexport const UPDATE_PUBLIC_KEY = '${publicKey}' as string\nexport const UPDATE_KEY_ID = 'k1' as string\n`
  )
  return r
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'onyx-updscripts-'))
  keys = join(base, 'keys')
  mkdirSync(keys)
  const k = generateKeyPairSync('ed25519')
  pubB64 = k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  privPem = k.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  keyFile = join(keys, 'update.pem')
  writeFileSync(keyFile, privPem, { mode: 0o600 })
  chmodSync(keyFile, 0o600)
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

d('publish-update.mjs', () => {
  it('genera ZIP + update.json + update.json.sig que verify-update acepta', async () => {
    repo = fakeRepo('0.4.0', pubB64)
    const app = toyApp(join(base, 'a1'), '0.4.0')
    const out = join(base, 'out1')
    const r = await publish({ appPath: app, outDir: out, keyFile, root: repo, now: () => new Date('2026-09-30T12:00:00Z') })
    expect(r.tag).toBe('v0.4.0')
    const manifest = JSON.parse(readFileSync(join(out, 'update.json'), 'utf8'))
    expect(manifest).toMatchObject({
      schema: 1,
      appId: APP_ID,
      version: '0.4.0',
      tag: 'v0.4.0',
      platform: 'darwin-arm64',
      keyId: 'k1',
      publishedAt: '2026-09-30T12:00:00.000Z'
    })
    expect(manifest.zip.name).toBe('OnyxCode-0.4.0-arm64.zip')
    expect(manifest.zip.size).toBe(statSync(join(out, manifest.zip.name)).size)
    const log = await verifyUpdate({ dir: out, current: '0.3.0', pubkey: pubB64, appId: APP_ID, keyId: 'k1' })
    expect(log.join('\n')).toMatch(/firma Ed25519 del manifiesto: válida/)
    expect(log.join('\n')).toMatch(/codesign --verify/)
  }, 60_000)

  it('rechaza una clave dentro del repositorio', async () => {
    const r = fakeRepo('0.4.0', pubB64)
    const inside = join(r, 'update.pem')
    writeFileSync(inside, privPem, { mode: 0o600 })
    const app = toyApp(join(base, 'a2'), '0.4.0')
    await expect(publish({ appPath: app, outDir: join(base, 'out2'), keyFile: inside, root: r })).rejects.toThrow(/DENTRO del repositorio/)
  })

  it('rechaza permisos más abiertos que 0600 y no imprime la clave', async () => {
    const loose = join(keys, 'loose.pem')
    writeFileSync(loose, privPem, { mode: 0o644 })
    chmodSync(loose, 0o644)
    const r = fakeRepo('0.4.0', pubB64)
    const app = toyApp(join(base, 'a3'), '0.4.0')
    const err = await publish({ appPath: app, outDir: join(base, 'out3'), keyFile: loose, root: r }).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/Permisos demasiado abiertos/)
    expect((err as Error).message).not.toContain('PRIVATE KEY')
    expect((err as Error).message).not.toContain(privPem.split('\n')[1])
  })

  it('rechaza sin archivo de clave, con clave que no es la de brand.ts y con brand vacío', async () => {
    const app = toyApp(join(base, 'a4'), '0.4.0')
    await expect(
      publish({ appPath: app, outDir: join(base, 'out4'), keyFile: undefined, root: fakeRepo('0.4.0', pubB64) })
    ).rejects.toThrow(/ONYXCODE_UPDATE_KEY_FILE/)
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    await expect(publish({ appPath: app, outDir: join(base, 'out4'), keyFile, root: fakeRepo('0.4.0', other) })).rejects.toThrow(
      /NO corresponde/
    )
    await expect(publish({ appPath: app, outDir: join(base, 'out4'), keyFile, root: fakeRepo('0.4.0', '') })).rejects.toThrow(
      /UPDATE_PUBLIC_KEY está vacía/
    )
  })

  it('rechaza una .app cuya versión no es la de package.json', async () => {
    const app = toyApp(join(base, 'a5'), '0.3.9')
    await expect(publish({ appPath: app, outDir: join(base, 'out5'), keyFile, root: fakeRepo('0.4.0', pubB64) })).rejects.toThrow(
      /Info\.plist: versión/
    )
  })

  it('rechaza una .app que no existe', async () => {
    await expect(
      publish({ appPath: join(base, 'no-existe.app'), outDir: join(base, 'out6'), keyFile, root: fakeRepo('0.4.0', pubB64) })
    ).rejects.toThrow(/No existe/)
  })
})

d('verify-update.mjs', () => {
  let out: string
  const opts = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    dir: out,
    current: '0.3.0',
    pubkey: pubB64,
    appId: APP_ID,
    keyId: 'k1',
    ...over
  })
  const fresh = async (): Promise<string> => {
    const r = fakeRepo('0.4.0', pubB64)
    const dir = mkdtempSync(join(base, 'o-'))
    await publish({ appPath: toyApp(mkdtempSync(join(base, 'app-')), '0.4.0'), outDir: dir, keyFile, root: r })
    return dir
  }
  beforeAll(async () => {
    out = await fresh()
  }, 60_000)

  it('otra clave pública: firma inválida', async () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    await expect(verifyUpdate(opts({ pubkey: other }))).rejects.toThrow(/firma Ed25519 del manifiesto NO verifica/)
  })
  it('anti-downgrade: la versión no es mayor que la instalada', async () => {
    await expect(verifyUpdate(opts({ current: '0.4.0' }))).rejects.toThrow(/no es mayor/)
    await expect(verifyUpdate(opts({ current: '1.0.0' }))).rejects.toThrow(/no es mayor/)
  })
  it('appId o keyId distintos', async () => {
    await expect(verifyUpdate(opts({ appId: 'otra.app' }))).rejects.toThrow(/appId/)
    await expect(verifyUpdate(opts({ keyId: 'k9' }))).rejects.toThrow(/keyId/)
  })
  it('manifiesto con un byte cambiado, firma alterada o ZIP alterado', async () => {
    const dir = await fresh()
    const mp = join(dir, 'update.json')
    const orig = readFileSync(mp)
    writeFileSync(mp, Buffer.from(orig.toString().replace('0.4.0', '0.4.1')))
    await expect(verifyUpdate(opts({ dir }))).rejects.toThrow(/NO verifica/)
    writeFileSync(mp, orig)
    const sp = join(dir, 'update.json.sig')
    const sig = Buffer.from(readFileSync(sp, 'utf8').trim(), 'base64')
    sig[3] ^= 1
    writeFileSync(sp, sig.toString('base64'))
    await expect(verifyUpdate(opts({ dir }))).rejects.toThrow(/NO verifica/)
  }, 60_000)
  it('ZIP con el mismo tamaño pero otro contenido: SHA-256 distinto; con más bytes: tamaño distinto', async () => {
    const dir = await fresh()
    const zp = join(dir, 'OnyxCode-0.4.0-arm64.zip')
    const buf = readFileSync(zp)
    buf[buf.length - 40] ^= 0xff
    writeFileSync(zp, buf)
    await expect(verifyUpdate(opts({ dir }))).rejects.toThrow(/SHA-256/)
    appendFileSync(zp, 'x')
    await expect(verifyUpdate(opts({ dir }))).rejects.toThrow(/tamaño del ZIP/)
  }, 60_000)
  it('falta algún archivo / manifiesto enorme', async () => {
    await expect(verifyUpdate(opts({ dir: join(base, 'vacio') }))).rejects.toThrow(/falta/)
    const dir = await fresh()
    writeFileSync(join(dir, 'update.json'), Buffer.alloc(20 * 1024, 32))
    await expect(verifyUpdate(opts({ dir }))).rejects.toThrow(/16 KB/)
  }, 60_000)
  it('ZIP firmado correctamente pero con una entrada ../: rechazado antes de extraer', async () => {
    const dir = await fresh()
    const name = 'OnyxCode-0.4.0-arm64.zip'
    const zp = join(dir, name)
    writeStoredZip(zp, ['OnyxCode.app/', '../evil'])
    // Re-firmar con la clave de la prueba para aislar la comprobación del listado.
    const { createPrivateKey } = await import('node:crypto')
    const priv = createPrivateKey(privPem)
    const { createHash } = await import('node:crypto')
    const buf = readFileSync(zp)
    const m = JSON.parse(readFileSync(join(dir, 'update.json'), 'utf8'))
    m.zip = { name, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
    const bytes = lib.manifestBytes(m)
    writeFileSync(join(dir, 'update.json'), bytes)
    writeFileSync(join(dir, 'update.json.sig'), lib.signBytes(bytes, priv))
    await expect(verifyUpdate(opts({ dir }))).rejects.toThrow(/entrada no permitida/)
  }, 60_000)
})

d('paridad con el cliente (src/shared/update-install.ts)', () => {
  const SHA = 'b'.repeat(64)
  const mk = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    schema: 1,
    appId: APP_ID,
    version: '0.4.0',
    tag: 'v0.4.0',
    platform: 'darwin-arm64',
    keyId: 'k1',
    zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 10, sha256: SHA },
    publishedAt: '2026-09-30T00:00:00Z',
    ...over
  })
  it('parseManifest coincide', () => {
    const cases: unknown[] = [
      mk(),
      mk({ schema: 2 }),
      mk({ platform: 'x' }),
      mk({ version: 'nueva' }),
      mk({ zip: { name: 'a.zip', size: 0, sha256: SHA } }),
      mk({ zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 700 * 1024 * 1024, sha256: SHA } }),
      mk({ zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 1, sha256: 'ZZ' } }),
      mk({ publishedAt: 'ayer' }),
      null,
      []
    ]
    for (const c of cases) expect(lib.parseManifest(c)).toEqual(sharedParse(c))
  })
  it('validateManifest coincide', () => {
    const ctx = { appId: APP_ID, current: '0.3.0', tag: 'v0.4.0', keyId: 'k1' }
    const variants: Array<[Record<string, unknown>, Partial<typeof ctx>]> = [
      [mk(), {}],
      [mk(), { current: '0.4.0' }],
      [mk(), { current: '1.0.0' }],
      [mk(), { appId: 'x' }],
      [mk(), { keyId: 'k2' }],
      [mk(), { tag: 'v0.4.1' }],
      [mk({ version: '0.4.1' }), {}],
      [mk({ zip: { name: 'OnyxCode-0.3.0-arm64.zip', size: 1, sha256: SHA } }), {}]
    ]
    for (const [m, o] of variants) {
      const parsed = sharedParse(m)!
      expect(lib.validateManifest(parsed as unknown as Record<string, unknown>, { ...ctx, ...o }) === null).toBe(
        sharedValidate(parsed, { ...ctx, ...o }).ok
      )
    }
  })
  it('isSafeZipEntry coincide', () => {
    for (const e of [
      'OnyxCode.app/',
      'OnyxCode.app/a/b',
      '../x',
      '/etc',
      'a\\b',
      'OnyxCode.app/../x',
      '__MACOSX/x',
      '__MACOSX/OnyxCode.app/._x',
      '__MACOSX/',
      '__MACOSX/OnyxCode.app/evil',
      'OnyxCode.app//x',
      '',
      'OnyxCode.app/x\0',
      'C:/x'
    ])
      expect(lib.isSafeZipEntry(e)).toBe(sharedSafe(e))
  })
})

/** ZIP mínimo (entradas «stored» vacías) para fabricar nombres peligrosos que `ditto` no crearía. */
function writeStoredZip(file: string, names: string[]): void {
  const fd = openSync(file, 'w')
  const central: Buffer[] = []
  let offset = 0
  for (const n of names) {
    const nb = Buffer.from(n)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc32(Buffer.alloc(0)), 14)
    local.writeUInt16LE(nb.length, 26)
    writeSync(fd, Buffer.concat([local, nb]))
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(crc32(Buffer.alloc(0)), 16)
    c.writeUInt16LE(nb.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([c, nb]))
    offset += 30 + nb.length
  }
  const cd = Buffer.concat(central)
  writeSync(fd, cd)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  writeSync(fd, end)
  closeSync(fd)
}
