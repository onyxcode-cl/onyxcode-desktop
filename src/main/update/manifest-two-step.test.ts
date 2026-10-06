/**
 * Publicación en dos pasos (F8-B70): el CI genera ZIP + update.json SIN firmar (`publish-update.mjs --manifest-only`, sin clave)
 * y la firma Ed25519 se hace en el Mac del dueño (`sign-update.mjs`). Lo firmado en dos pasos lo acepta el cliente real.
 * «.app» de juguete con firma ad-hoc en $TMPDIR y repo falso: nunca el repo real ni una clave real. Sin red.
 */
import { generateKeyPairSync, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseManifest, validateManifest } from '@shared/update-install'
import { resolveInstallConfig } from './config'
import { verifyWithKeys } from './signature'
// @ts-expect-error: script .mjs sin declaración de tipos
import { publish } from '../../../scripts/publish-update.mjs'
// @ts-expect-error: idem
import { signUpdate } from '../../../scripts/sign-update.mjs'

const isMac = process.platform === 'darwin'
const d = isMac ? describe : describe.skip
const APP_ID = 'cl.bentec.lazunox'

let base: string
let pubB64: string
let keyFile: string
let otherKeyFile: string

function pemFile(name: string): { file: string; pub: string } {
  const k = generateKeyPairSync('ed25519')
  const file = join(base, 'keys', name)
  writeFileSync(file, k.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), { mode: 0o600 })
  chmodSync(file, 0o600)
  return { file, pub: k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }
}

function toyApp(dir: string, version: string): string {
  const app = join(dir, 'Lazunox.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
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
  writeFileSync(join(r, 'package.json'), JSON.stringify({ name: 'lazunox', version }))
  writeFileSync(
    join(r, 'src', 'shared', 'brand.ts'),
    `export const AUTHOR_ALIAS = 'bentec'\nexport const UPDATE_PUBLIC_KEY = '${publicKey}' as string\nexport const UPDATE_KEY_ID = 'k1' as string\n`
  )
  return r
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'lazunox-twostep-'))
  mkdirSync(join(base, 'keys'))
  const a = pemFile('update.pem')
  keyFile = a.file
  pubB64 = a.pub
  otherKeyFile = pemFile('other.pem').file
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

d('publicación en dos pasos', () => {
  it('--manifest-only: sin clave, deja update.json sin firma; sign-update lo firma y el cliente real lo acepta', async () => {
    const repo = fakeRepo('0.4.0', pubB64)
    const out = join(base, 'out1')
    const r = await publish({
      appPath: toyApp(join(base, 'a1'), '0.4.0'),
      outDir: out,
      keyFile: undefined,
      manifestOnly: true,
      root: repo,
      now: () => new Date('2026-10-04T12:00:00Z')
    })
    expect(r.signed).toBe(false)
    expect(existsSync(join(out, 'update.json'))).toBe(true)
    expect(existsSync(join(out, 'update.json.sig'))).toBe(false)

    const s = await signUpdate({ dir: out, keyFile, root: repo })
    expect(s.tag).toBe('v0.4.0')
    const bytes = readFileSync(join(out, 'update.json'))
    const sig = readFileSync(join(out, 'update.json.sig'), 'utf8')
    expect(verifyWithKeys(bytes, sig, [{ id: 'k1', key: pubB64 }])).toBe('k1')
    const parsed = parseManifest(JSON.parse(bytes.toString('utf8')))!
    expect(validateManifest(parsed, { appId: APP_ID, current: '0.3.0', tag: 'v0.4.0', keyId: 'k1' }).ok).toBe(true)
    // El ZIP de la release es el mismo que describe el manifiesto.
    expect(parsed.zip.name).toBe('Lazunox-0.4.0-arm64.zip')
  }, 60_000)

  it('el modo de un solo paso sigue funcionando (firma incluida)', async () => {
    const repo = fakeRepo('0.4.1', pubB64)
    const out = join(base, 'out2')
    const r = await publish({ appPath: toyApp(join(base, 'a2'), '0.4.1'), outDir: out, keyFile, root: repo })
    expect(r.signed).toBe(true)
    expect(existsSync(join(out, 'update.json.sig'))).toBe(true)
  }, 60_000)

  it('sign-update rechaza un ZIP alterado, una clave ajena y una clave dentro del repo', async () => {
    const repo = fakeRepo('0.4.2', pubB64)
    const out = join(base, 'out3')
    await publish({ appPath: toyApp(join(base, 'a3'), '0.4.2'), outDir: out, keyFile: undefined, manifestOnly: true, root: repo })
    await expect(signUpdate({ dir: out, keyFile: otherKeyFile, root: repo })).rejects.toThrow(/NO corresponde/)
    const inside = join(repo, 'update.pem')
    writeFileSync(inside, readFileSync(keyFile), { mode: 0o600 })
    await expect(signUpdate({ dir: out, keyFile: inside, root: repo })).rejects.toThrow(/DENTRO del repositorio/)
    expect(existsSync(join(out, 'update.json.sig'))).toBe(false)
    // ZIP manipulado (un byte más): no se firma.
    const zip = join(out, 'Lazunox-0.4.2-arm64.zip')
    writeFileSync(zip, Buffer.concat([readFileSync(zip), Buffer.from('x')]))
    await expect(signUpdate({ dir: out, keyFile, root: repo })).rejects.toThrow(/no firmo/)
    expect(existsSync(join(out, 'update.json.sig'))).toBe(false)
  }, 60_000)

  it('sign-update rechaza un manifiesto de otro appId o keyId', async () => {
    const repo = fakeRepo('0.4.3', pubB64)
    const out = join(base, 'out4')
    await publish({ appPath: toyApp(join(base, 'a4'), '0.4.3'), outDir: out, keyFile: undefined, manifestOnly: true, root: repo })
    const m = JSON.parse(readFileSync(join(out, 'update.json'), 'utf8'))
    writeFileSync(join(out, 'update.json'), JSON.stringify({ ...m, keyId: 'otra' }, null, 2) + '\n')
    await expect(signUpdate({ dir: out, keyFile, root: repo })).rejects.toThrow(/keyId distinto/)
  }, 60_000)
})

describe('lista de claves (rotación)', () => {
  it('el cliente acepta un manifiesto firmado con cualquiera de las claves de la lista y rechaza una ajena', () => {
    const a = generateKeyPairSync('ed25519')
    const b = generateKeyPairSync('ed25519')
    const c = generateKeyPairSync('ed25519')
    const spki = (k: typeof a.publicKey) => k.export({ format: 'der', type: 'spki' }).toString('base64')
    const bytes = Buffer.from('{"schema":1}\n')
    const signWith = (k: typeof a.privateKey) => sign(null, bytes, k).toString('base64')
    const keys = [
      { id: 'lazunox-2', key: spki(a.publicKey) },
      { id: 'lazunox-1', key: spki(b.publicKey) }
    ]
    expect(verifyWithKeys(bytes, signWith(a.privateKey), keys)).toBe('lazunox-2')
    expect(verifyWithKeys(bytes, signWith(b.privateKey), keys)).toBe('lazunox-1')
    expect(verifyWithKeys(bytes, signWith(c.privateKey), keys)).toBeNull()
  })

  it('resolveInstallConfig añade las claves extra (rotación) tras la principal, solo si son válidas', () => {
    const a = generateKeyPairSync('ed25519')
    const b = generateKeyPairSync('ed25519')
    const spki = (k: typeof a.publicKey) => k.export({ format: 'der', type: 'spki' }).toString('base64')
    const update = { configured: true, repo: 'o/r', apiBase: 'https://api.github.com', startDelayMs: 0 }
    const cfg = resolveInstallConfig({
      isPackaged: true,
      env: {},
      repo: 'o/r',
      update,
      updateKey: spki(a.publicKey),
      updateKeyId: 'lazunox-2',
      updateKeys: [
        { id: 'lazunox-1', key: spki(b.publicKey) },
        { id: 'rota', key: 'no-es-una-clave' }
      ],
      platform: 'darwin'
    })
    expect(cfg.keys.map((k) => k.id)).toEqual(['lazunox-2', 'lazunox-1'])
    expect(cfg.enabled).toBe(true)
  })
})
