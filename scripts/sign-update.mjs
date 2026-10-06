#!/usr/bin/env node
// Paso 2 de la publicación en dos pasos: FIRMA el manifiesto `update.json` que generó el CI (`publish-update.mjs --manifest-only`).
// Se ejecuta SOLO en el Mac del dueño: la clave privada Ed25519 nunca va a GitHub ni al CI. NO hace peticiones de red.
//
//   LAZUNOX_UPDATE_KEY_FILE=~/.lazunox-keys/update.pem node scripts/sign-update.mjs --dir ~/Descargas/release-0.4.0 [--zip ruta.zip]
//
// Antes de firmar comprueba que lo descargado es lo que dice el manifiesto (tamaño y SHA-256 del ZIP, appId y keyId de brand.ts,
// versión = tag, nombre del ZIP) y que la clave privada corresponde a UPDATE_PUBLIC_KEY; escribe `update.json.sig` junto al manifiesto.
// El borrador de la release hay que revisarlo a mano: este script firma lo que ve, no decide si el contenido es legítimo.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MANIFEST_MAX_BYTES,
  decodePublicKey,
  parseManifest,
  publicKeyOf,
  readBrand,
  readPrivateKey,
  sha256File,
  signBytes,
  spkiBase64,
  validateManifest,
  verifyBytes
} from './update-lib.mjs'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function signUpdate({ dir, zipPath, keyFile, root = defaultRoot }) {
  const manifestPath = join(dir, 'update.json')
  if (!existsSync(manifestPath)) throw new Error(`No existe ${manifestPath}: descarga update.json y el ZIP del borrador de la release.`)
  const bytes = readFileSync(manifestPath)
  if (bytes.length > MANIFEST_MAX_BYTES) throw new Error('update.json supera el tamaño máximo permitido.')
  let json
  try {
    json = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('update.json no es JSON válido.')
  }
  const manifest = parseManifest(json)
  if (!manifest) throw new Error('update.json no tiene la forma de un manifiesto válido.')
  // Los bytes firmados deben ser exactamente los que el cliente leerá: nada de reformatear.
  const brand = readBrand(root)
  if (!brand.publicKey) throw new Error('UPDATE_PUBLIC_KEY está vacía en src/shared/brand.ts.')
  const pub = decodePublicKey(brand.publicKey)
  if (!pub) throw new Error('UPDATE_PUBLIC_KEY de brand.ts no es una clave Ed25519 válida.')
  // Versión: la del propio manifiesto (el «actual» ficticio es 0.0.0 solo para reutilizar la validación de forma).
  const err = validateManifest(manifest, { appId: brand.appId, current: '0.0.0', tag: manifest.tag, keyId: brand.keyId })
  if (err) throw new Error(`El manifiesto no es coherente con brand.ts: ${err}.`)

  const zip = zipPath ?? join(dir, manifest.zip.name)
  if (!existsSync(zip)) throw new Error(`No existe el ZIP ${zip}: descárgalo del borrador (${manifest.zip.name}).`)
  const size = statSync(zip).size
  if (size !== manifest.zip.size) throw new Error(`El ZIP pesa ${size} bytes y el manifiesto dice ${manifest.zip.size}: no firmo.`)
  const sha256 = await sha256File(zip)
  if (sha256 !== manifest.zip.sha256) throw new Error('El SHA-256 del ZIP no coincide con el del manifiesto: no firmo.')

  const priv = readPrivateKey(keyFile, root)
  if (spkiBase64(publicKeyOf(priv)) !== spkiBase64(pub)) throw new Error('La clave privada NO corresponde a UPDATE_PUBLIC_KEY de brand.ts.')
  const sig = signBytes(bytes, priv)
  if (!verifyBytes(bytes, sig, pub)) throw new Error('La firma generada no verifica con UPDATE_PUBLIC_KEY (error interno).')
  const sigPath = join(dir, 'update.json.sig')
  writeFileSync(sigPath, sig + '\n')
  return { tag: manifest.tag, version: manifest.version, sigPath, sha256, size }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = arg('--dir')
  if (!dir) {
    console.error(
      'Uso: LAZUNOX_UPDATE_KEY_FILE=<clave.pem> node scripts/sign-update.mjs --dir <carpeta con update.json y el ZIP> [--zip ruta.zip]'
    )
    process.exit(2)
  }
  signUpdate({
    dir: resolve(dir),
    zipPath: arg('--zip') ? resolve(arg('--zip')) : undefined,
    keyFile: process.env.LAZUNOX_UPDATE_KEY_FILE
  })
    .then((r) => {
      console.log(`sign-update OK — ${r.tag}: ZIP ${r.size} bytes, sha256 ${r.sha256}`)
      console.log(`  Firma: ${r.sigPath}`)
      console.log('Sube update.json.sig como asset del borrador y comprueba con: node scripts/verify-update.mjs --dir <carpeta>')
    })
    .catch((e) => {
      console.error(`sign-update FALLÓ: ${e.message}`)
      process.exit(1)
    })
}
