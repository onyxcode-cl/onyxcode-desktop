// Fixtures del actualizador: clave Ed25519 de prueba, .app de juguete firmada ad-hoc, ZIP hecho con ditto y manifiesto firmado.
// Todo vive en directorios temporales. Nunca se ejecuta la app de juguete ni se instala nada.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { APP_ID, UPDATE_KEY_ID } from '../../src/shared/brand'

export const FIXTURE_VERSION = '99.9.9'
export const FIXTURE_REPO = 'test-owner/test-repo'

export interface Keys {
  publicKey: string
  privateKey: KeyObject
}
export function newKeys(): Keys {
  const k = generateKeyPairSync('ed25519')
  return { publicKey: k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), privateKey: k.privateKey }
}

export interface Fixture {
  version: string
  tag: string
  zipName: string
  zip: Buffer
  manifest: Buffer
  sig: string
  dir: string
  /** Ruta del servidor local donde van los archivos de esta versión. */
  base: string
  dispose(): void
}

export interface FixtureOptions {
  version?: string
  /** Versión que lleva el Info.plist de la .app (por defecto la del manifiesto). */
  plistVersion?: string
  /** Firma con otra clave (firma inválida). */
  badSignature?: boolean
  /** El manifiesto declara el hash de otro contenido. */
  wrongHash?: boolean
  /** ZIP con una entrada `../evil` (se firma y se declara bien). */
  traversalZip?: boolean
  /** Manifiesto de una versión anterior (repetición), firmado correctamente. */
  manifestVersion?: string
  /** Relleno (bytes) para que la descarga dure y se pueda cancelar/capturar a medias. */
  padding?: number
}

function toyApp(dir: string, version: string, padding: number): string {
  const app = join(dir, 'OnyxCode.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'MacOS', 'toy'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(app, 'Contents', 'MacOS', 'toy'), 0o755)
  if (padding > 0) {
    // Aleatorio (no comprimible) para que el ZIP pese de verdad.
    const buf = Buffer.alloc(padding)
    for (let i = 0; i < padding; i += 65536) buf.fill(Math.floor(Math.random() * 255), i, Math.min(padding, i + 65536))
    writeFileSync(join(app, 'Contents', 'Resources', 'relleno.bin'), buf)
  }
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>toy</string><key>CFBundleIdentifier</key><string>${APP_ID}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`
  )
  const r = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', APP_ID, app], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`codesign de la app de juguete: ${r.stderr}`)
  return app
}

/** ZIP mínimo con entradas vacías (nombres peligrosos que `ditto` no crearía). */
function storedZip(file: string, names: string[]): void {
  const fd = openSync(file, 'w')
  const central: Buffer[] = []
  let offset = 0
  const empty = crc32(Buffer.alloc(0))
  for (const n of names) {
    const nb = Buffer.from(n)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(empty, 14)
    local.writeUInt16LE(nb.length, 26)
    writeSync(fd, Buffer.concat([local, nb]))
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(empty, 16)
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

export function buildFixture(keys: Keys, o: FixtureOptions = {}): Fixture {
  const version = o.version ?? FIXTURE_VERSION
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-fixture-')))
  const zipName = `OnyxCode-${version}-arm64.zip`
  const zipPath = join(dir, zipName)
  if (o.traversalZip) storedZip(zipPath, ['OnyxCode.app/', '../evil'])
  else {
    const app = toyApp(join(dir, 'src'), o.plistVersion ?? version, o.padding ?? 0)
    const r = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zipPath], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`ditto -c -k: ${r.stderr}`)
  }
  const zip = readFileSync(zipPath)
  const mv = o.manifestVersion ?? version
  const manifest = Buffer.from(
    JSON.stringify(
      {
        schema: 1,
        appId: APP_ID,
        version: mv,
        tag: `v${mv}`,
        platform: 'darwin-arm64',
        keyId: UPDATE_KEY_ID,
        zip: {
          name: zipName,
          size: zip.length,
          sha256: createHash('sha256')
            .update(o.wrongHash ? Buffer.concat([zip, Buffer.from('x')]) : zip)
            .digest('hex')
        },
        publishedAt: '2026-09-30T12:00:00Z'
      },
      null,
      2
    ) + '\n'
  )
  const signer = o.badSignature ? newKeys().privateKey : keys.privateKey
  return {
    version,
    tag: `v${version}`,
    zipName,
    zip,
    manifest,
    sig: sign(null, manifest, signer).toString('base64'),
    dir,
    base: `/${FIXTURE_REPO}/releases/download/v${version}`,
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}
