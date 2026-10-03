#!/usr/bin/env node
// Comprobación AUTOMÁTICA, sin red y sin .app, de la cadena de confianza del actualizador. Genera una clave Ed25519 efímera,
// un ZIP falso y un manifiesto firmado con las mismas funciones que usa publish-update.mjs, y exige que:
//   - el manifiesto legítimo se acepte (firma Ed25519 sobre los bytes exactos, forma, versión mayor, appId/keyId/tag, tamaño y SHA-256);
//   - cada manipulación se rechace con su motivo: un byte del manifiesto, la firma, otra clave, ZIP alterado o con más bytes,
//     downgrade (misma versión o menor), appId/keyId/tag distintos, nombre de ZIP raro, manifiesto enorme, faltan archivos.
// Además comprueba src/shared/brand.ts: si UPDATE_PUBLIC_KEY está definida debe decodificar a una clave Ed25519 y UPDATE_KEY_ID
// ser válido (con la clave vacía solo avisa: aún no hay releases). No toca ni lee ninguna clave real ni la app instalada.
//
//   npm run verify:update-manifest
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildManifest, decodePublicKey, manifestBytes, readBrand, sha256File, signBytes, spkiBase64 } from './update-lib.mjs'
import { verifyManifestAndZip } from './verify-update.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_ID = 'cl.prueba.onyxcode'
const KEY_ID = 'prueba-1'
const VERSION = '0.4.0'
const ZIP_NAME = `OnyxCode-${VERSION}-arm64.zip`

/** Escribe un conjunto de archivos de actualización válido y devuelve su carpeta. */
async function makeRelease(
  base,
  name,
  { priv, version = VERSION, keyId = KEY_ID, appId = APP_ID, zipName = `OnyxCode-${version}-arm64.zip` }
) {
  const dir = mkdtempSync(join(base, `${name}-`))
  const zipBytes = randomBytes(4096)
  writeFileSync(join(dir, zipName), zipBytes)
  const manifest = buildManifest({
    appId,
    version,
    tag: `v${version}`,
    keyId,
    zipName,
    size: zipBytes.length,
    sha256: await sha256File(join(dir, zipName)),
    publishedAt: '2026-01-01T00:00:00.000Z'
  })
  const bytes = manifestBytes(manifest)
  writeFileSync(join(dir, 'update.json'), bytes)
  writeFileSync(join(dir, 'update.json.sig'), signBytes(bytes, priv) + '\n')
  return dir
}

/**
 * Ejecuta todas las comprobaciones. Devuelve `[{ name, ok, detail }]`; `ok` significa «se comportó como debe» (lo legítimo se
 * aceptó y lo manipulado se rechazó con el motivo esperado).
 */
export async function runManifestChecks() {
  const base = mkdtempSync(join(tmpdir(), 'onyx-verify-manifest-'))
  const results = []
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const pub = spkiBase64(publicKey)
    const opts = (dir, over = {}) => ({ dir, current: '0.3.0', pubkey: pub, appId: APP_ID, keyId: KEY_ID, ...over })
    const accepts = async (name, dir, over) => {
      try {
        await verifyManifestAndZip(opts(dir, over))
        results.push({ name, ok: true })
      } catch (e) {
        results.push({ name, ok: false, detail: `se rechazó un manifiesto legítimo: ${e.message}` })
      }
    }
    const rejects = async (name, dir, re, over) => {
      try {
        await verifyManifestAndZip(opts(dir, over))
        results.push({ name, ok: false, detail: 'se ACEPTÓ algo que debía rechazarse' })
      } catch (e) {
        const ok = re.test(e.message)
        results.push({ name, ok, ...(ok ? {} : { detail: `motivo inesperado: ${e.message}` }) })
      }
    }
    const fresh = (name, over) => makeRelease(base, name, { priv: privateKey, ...over })

    await accepts('manifiesto legítimo: firma, forma, versión, tamaño y SHA-256', await fresh('ok'))

    // 1. Firma
    const tamper = await fresh('tamper')
    const mp = join(tamper, 'update.json')
    const orig = readFileSync(mp)
    writeFileSync(mp, Buffer.from(orig.toString().replace(VERSION, '0.4.1')))
    await rejects('un byte del manifiesto cambiado', tamper, /NO verifica/)
    writeFileSync(mp, orig)
    const sp = join(tamper, 'update.json.sig')
    const sig = Buffer.from(readFileSync(sp, 'utf8').trim(), 'base64')
    sig[3] ^= 1
    writeFileSync(sp, sig.toString('base64'))
    await rejects('firma alterada', tamper, /NO verifica/)
    const other = spkiBase64(generateKeyPairSync('ed25519').publicKey)
    await rejects('firmado con otra clave', await fresh('otra'), /NO verifica/, { pubkey: other })
    await rejects('clave pública no válida', await fresh('pubmala'), /clave pública no válida/, { pubkey: 'no-es-una-clave' })

    // 2. Versión, identidad y tag
    const ok2 = await fresh('ver')
    await rejects('anti-downgrade: misma versión', ok2, /no es mayor/, { current: VERSION })
    await rejects('anti-downgrade: instalada mayor', ok2, /no es mayor/, { current: '9.0.0' })
    await rejects('appId distinto', ok2, /appId/, { appId: 'otra.app' })
    await rejects('keyId distinto', ok2, /keyId/, { keyId: 'otra-clave' })
    await rejects('tag que no coincide con la release', ok2, /tag/, { tag: 'v9.9.9' })
    await rejects(
      'nombre de ZIP que no corresponde a la versión',
      await fresh('nombre', { zipName: 'OnyxCode-0.3.9-arm64.zip' }),
      /nombre de ZIP/
    )
    await rejects('prerelease', await fresh('pre', { version: '0.4.0-beta.1' }), /no es mayor|nombre de ZIP/)

    // 3. ZIP
    const z = await fresh('zip')
    const zp = join(z, ZIP_NAME)
    const buf = readFileSync(zp)
    buf[buf.length - 10] ^= 0xff
    writeFileSync(zp, buf)
    await rejects('ZIP con el mismo tamaño y otro contenido', z, /SHA-256/)
    appendFileSync(zp, 'x')
    await rejects('ZIP con bytes de más', z, /tamaño del ZIP/)
    rmSync(zp)
    await rejects('falta el ZIP', z, /falta/)

    // 4. Archivos
    const big = await fresh('grande')
    writeFileSync(join(big, 'update.json'), Buffer.alloc(20 * 1024, 32))
    await rejects('manifiesto de más de 16 KB', big, /16 KB/)
    const sinSig = await fresh('sinsig')
    rmSync(join(sinSig, 'update.json.sig'))
    await rejects('falta la firma', sinSig, /falta/)

    // 5. Identidad pública del repositorio (brand.ts)
    const brand = readBrand(root)
    if (!brand.publicKey) {
      results.push({ name: 'brand.ts: UPDATE_PUBLIC_KEY aún vacía (se exigirá en verify:release)', ok: true, warn: true })
    } else if (!decodePublicKey(brand.publicKey)) {
      results.push({ name: 'brand.ts: UPDATE_PUBLIC_KEY es una clave Ed25519 válida', ok: false, detail: 'no decodifica' })
    } else {
      results.push({ name: 'brand.ts: UPDATE_PUBLIC_KEY es una clave Ed25519 válida', ok: true })
    }
    const idOk = typeof brand.keyId === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(brand.keyId)
    results.push({ name: 'brand.ts: UPDATE_KEY_ID válido', ok: idOk, ...(idOk ? {} : { detail: `«${brand.keyId}»` }) })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  return results
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManifestChecks()
    .then((results) => {
      for (const r of results) console.log(`${r.ok ? (r.warn ? 'AVISO' : 'OK   ') : 'FALLA'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
      const failed = results.filter((r) => !r.ok)
      if (failed.length) {
        console.error(`verify:update-manifest FALLÓ (${failed.length} de ${results.length})`)
        process.exit(1)
      }
      console.log(`verify:update-manifest OK (${results.length} comprobaciones)`)
    })
    .catch((e) => {
      console.error(`verify:update-manifest FALLÓ: ${e.message}`)
      process.exit(1)
    })
}
