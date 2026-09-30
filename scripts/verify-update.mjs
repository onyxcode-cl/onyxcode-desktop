#!/usr/bin/env node
// Reproduce la verificación del cliente sobre una carpeta con update.json, update.json.sig y el ZIP (la salida de
// publish-update.mjs, o una release descargada a mano). No hace peticiones de red ni toca la app instalada.
//
//   node scripts/verify-update.mjs --dir dist/update [--current 0.3.0] [--pubkey <base64>]
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MANIFEST_MAX_BYTES,
  SIGNATURE_MAX_BYTES,
  ZIP_MAX_BYTES,
  checkBundle,
  decodePublicKey,
  listZip,
  parseManifest,
  readBrand,
  run,
  sha256File,
  validateManifest,
  verifyBytes
} from './update-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Devuelve las líneas de la comprobación; lanza Error con el motivo si el cliente rechazaría la actualización. */
export async function verifyUpdate({ dir, current, pubkey, appId, keyId, tag }) {
  const log = []
  const mPath = join(dir, 'update.json')
  const sPath = join(dir, 'update.json.sig')
  for (const f of [mPath, sPath]) if (!existsSync(f)) throw new Error(`falta ${f}`)
  const bytes = readFileSync(mPath)
  const sig = readFileSync(sPath, 'utf8')
  if (bytes.length > MANIFEST_MAX_BYTES) throw new Error('update.json supera los 16 KB')
  if (Buffer.byteLength(sig) > SIGNATURE_MAX_BYTES) throw new Error('update.json.sig supera 1 KB')

  const key = decodePublicKey(pubkey)
  if (!key) throw new Error('clave pública no válida (UPDATE_PUBLIC_KEY / --pubkey)')
  // 1. Firma sobre los bytes exactos; solo después se interpreta el JSON.
  if (!verifyBytes(bytes, sig, key)) throw new Error('la firma Ed25519 del manifiesto NO verifica')
  log.push('firma Ed25519 del manifiesto: válida')
  let json
  try {
    json = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('update.json no es JSON')
  }
  const m = parseManifest(json)
  if (!m) throw new Error('update.json con forma no válida')
  const err = validateManifest(m, { appId, current, tag: tag ?? m.tag, keyId })
  if (err) throw new Error(`manifiesto rechazado: ${err}`)
  log.push(`manifiesto: ${m.tag} (${m.version}), appId ${m.appId}, keyId ${m.keyId}`)

  const zip = join(dir, m.zip.name)
  if (!existsSync(zip)) throw new Error(`falta ${zip}`)
  const size = statSync(zip).size
  if (size !== m.zip.size || size > ZIP_MAX_BYTES) throw new Error(`tamaño del ZIP ${size} distinto del firmado (${m.zip.size})`)
  if ((await sha256File(zip)) !== m.zip.sha256) throw new Error('SHA-256 del ZIP distinto del firmado')
  log.push(`ZIP: ${size} bytes, SHA-256 coincide`)
  const entries = listZip(zip)
  log.push(`listado del ZIP: ${entries.length} entradas, todas dentro de OnyxCode.app/`)

  const tmp = mkdtempSync(join(tmpdir(), 'onyx-verify-update-'))
  try {
    const ex = run('/usr/bin/ditto', ['-x', '-k', zip, tmp])
    if (ex.status !== 0) throw new Error(`ditto -x -k falló: ${(ex.stderr || '').trim()}`)
    log.push(...checkBundle(join(tmp, 'OnyxCode.app'), { appId: m.appId, version: m.version }))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return log
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const brand = readBrand(root)
  const dir = resolve(arg('--dir') ?? join(root, 'dist/update'))
  verifyUpdate({
    dir,
    current: arg('--current') ?? '0.0.0',
    pubkey: arg('--pubkey') ?? brand.publicKey,
    appId: brand.appId,
    keyId: brand.keyId
  })
    .then((log) => {
      for (const l of log) console.log(`OK   ${l}`)
      console.log('verify-update OK')
    })
    .catch((e) => {
      console.error(`FALLA ${e.message}`)
      console.error('verify-update FALLÓ')
      process.exit(1)
    })
}
