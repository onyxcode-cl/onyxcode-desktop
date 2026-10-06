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
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MANIFEST_MAX_BYTES,
  UPDATE_PLATFORMS,
  ZIP_MAX_BYTES,
  buildManifest,
  checkZipEntriesWin,
  decodePublicKey,
  manifestBytes,
  parseManifest,
  readBrand,
  sha256File,
  signBytes,
  spkiBase64,
  validateManifest,
  verifyBytes
} from './update-lib.mjs'
import { verifyManifestAndZip } from './verify-update.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_ID = 'cl.prueba.lazunox'
const KEY_ID = 'prueba-1'
const VERSION = '0.4.0'
const ZIP_NAME = `Lazunox-${VERSION}-arm64.zip`

/** Escribe un conjunto de archivos de actualización válido y devuelve su carpeta. */
async function makeRelease(
  base,
  name,
  { priv, version = VERSION, keyId = KEY_ID, appId = APP_ID, zipName = `Lazunox-${version}-arm64.zip` }
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

const WIN = UPDATE_PLATFORMS['win32-x64']

/** Escribe un conjunto de archivos de actualización de Windows (manifiesto, firma y ZIP) y devuelve su carpeta. */
async function makeWinRelease(
  base,
  name,
  { priv, version = VERSION, keyId = KEY_ID, appId = APP_ID, zipName = WIN.zipName(version), platform = 'win32-x64' }
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
    publishedAt: '2026-01-01T00:00:00.000Z',
    platform
  })
  const bytes = manifestBytes(manifest)
  writeFileSync(join(dir, WIN.manifestName), bytes)
  writeFileSync(join(dir, WIN.manifestSigName), signBytes(bytes, priv) + '\n')
  return dir
}

/** Verificación del manifiesto de Windows con las mismas funciones que el cliente (firma antes del JSON, forma, validación, ZIP). */
async function verifyWinManifestAndZip({ dir, current, pubkey, appId, keyId, tag }) {
  const mPath = join(dir, WIN.manifestName)
  const sPath = join(dir, WIN.manifestSigName)
  for (const f of [mPath, sPath]) if (!existsSync(f)) throw new Error(`falta ${f}`)
  const bytes = readFileSync(mPath)
  if (bytes.length > MANIFEST_MAX_BYTES) throw new Error(`${WIN.manifestName} supera los 16 KB`)
  const key = decodePublicKey(pubkey)
  if (!key) throw new Error('clave pública no válida')
  if (!verifyBytes(bytes, readFileSync(sPath, 'utf8'), key)) throw new Error('la firma Ed25519 del manifiesto NO verifica')
  let json
  try {
    json = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('el manifiesto no es JSON')
  }
  const m = parseManifest(json, 'win32-x64')
  if (!m) throw new Error('manifiesto con forma o plataforma no válida')
  const err = validateManifest(m, { appId, current, tag: tag ?? m.tag, keyId })
  if (err) throw new Error(`manifiesto rechazado: ${err}`)
  const zip = join(dir, m.zip.name)
  if (!existsSync(zip)) throw new Error(`falta ${zip}`)
  const size = statSync(zip).size
  if (size !== m.zip.size || size > ZIP_MAX_BYTES) throw new Error(`tamaño del ZIP ${size} distinto del firmado`)
  if ((await sha256File(zip)) !== m.zip.sha256) throw new Error('SHA-256 del ZIP distinto del firmado')
  return m
}

/**
 * Ejecuta todas las comprobaciones. Devuelve `[{ name, ok, detail }]`; `ok` significa «se comportó como debe» (lo legítimo se
 * aceptó y lo manipulado se rechazó con el motivo esperado).
 */
export async function runManifestChecks() {
  const base = mkdtempSync(join(tmpdir(), 'lazunox-verify-manifest-'))
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
      await fresh('nombre', { zipName: 'Lazunox-0.3.9-arm64.zip' }),
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

    // 5. Windows (win32-x64): mismo esquema, otros nombres de archivo y de ZIP
    const winOpts = (dir, over = {}) => ({ dir, current: '0.3.0', pubkey: pub, appId: APP_ID, keyId: KEY_ID, ...over })
    const winAccepts = async (name, dir, over) => {
      try {
        await verifyWinManifestAndZip(winOpts(dir, over))
        results.push({ name, ok: true })
      } catch (e) {
        results.push({ name, ok: false, detail: `se rechazó un manifiesto legítimo: ${e.message}` })
      }
    }
    const winRejects = async (name, dir, re, over) => {
      try {
        await verifyWinManifestAndZip(winOpts(dir, over))
        results.push({ name, ok: false, detail: 'se ACEPTÓ algo que debía rechazarse' })
      } catch (e) {
        const ok = re.test(e.message)
        results.push({ name, ok, ...(ok ? {} : { detail: `motivo inesperado: ${e.message}` }) })
      }
    }
    const freshWin = (name, over) => makeWinRelease(base, name, { priv: privateKey, ...over })
    const winOk = await freshWin('win-ok')
    await winAccepts('Windows: manifiesto legítimo (firma, forma, versión, ZIP win32-x64, tamaño y SHA-256)', winOk)
    await winRejects('Windows: anti-downgrade (misma versión)', winOk, /no es mayor/, { current: VERSION })
    await winRejects('Windows: anti-downgrade (instalada mayor)', winOk, /no es mayor/, { current: '9.0.0' })
    await winRejects('Windows: appId distinto', winOk, /appId/, { appId: 'otra.app' })
    await winRejects('Windows: keyId distinto', winOk, /keyId/, { keyId: 'otra-clave' })
    await winRejects('Windows: tag que no coincide con la release', winOk, /tag/, { tag: 'v9.9.9' })
    await winRejects('Windows: firmado con otra clave', winOk, /NO verifica/, { pubkey: other })
    await winRejects(
      'Windows: nombre de ZIP del Mac (arm64)',
      await freshWin('win-zipmac', { zipName: 'Lazunox-0.4.0-arm64.zip' }),
      /nombre de ZIP/
    )
    await winRejects(
      'Windows: nombre de ZIP de otra versión',
      await freshWin('win-zipver', { zipName: 'Lazunox-0.3.9-win32-x64.zip' }),
      /nombre de ZIP/
    )
    await winRejects(
      'Windows: manifiesto de Mac presentado como el de Windows',
      await freshWin('win-plat', { platform: 'darwin-arm64' }),
      /plataforma/
    )
    const winTamper = await freshWin('win-tamper')
    const wmp = join(winTamper, WIN.manifestName)
    writeFileSync(wmp, Buffer.from(readFileSync(wmp).toString().replace(VERSION, '0.4.1')))
    await winRejects('Windows: un byte del manifiesto cambiado', winTamper, /NO verifica/)
    const winZip = await freshWin('win-zip')
    const wzp = join(winZip, WIN.zipName(VERSION))
    const wbuf = readFileSync(wzp)
    wbuf[wbuf.length - 10] ^= 0xff
    writeFileSync(wzp, wbuf)
    await winRejects('Windows: ZIP con el mismo tamaño y otro contenido', winZip, /SHA-256/)
    rmSync(wzp)
    await winRejects('Windows: falta el ZIP', winZip, /falta/)
    // Mac no acepta el manifiesto de Windows ni al revés (la plataforma se exige en parseManifest)
    const winJson = JSON.parse(readFileSync(join(winOk, WIN.manifestName), 'utf8'))
    const macRejectsWin = parseManifest(winJson) === null && parseManifest(winJson, 'win32-x64') !== null
    results.push({ name: 'Windows: el Mac no acepta un manifiesto win32-x64 (y viceversa)', ok: macRejectsWin })

    // 6. Entradas del ZIP de Windows
    const good = ['Lazunox/', 'Lazunox/Lazunox.exe', 'Lazunox/resources/app.asar', 'Lazunox/locales/es.pak'].map((name) => ({ name }))
    results.push({ name: 'Windows: entradas legítimas del ZIP', ok: checkZipEntriesWin(good).ok })
    const badEntries = {
      'recorrido «..»': 'Lazunox/../x',
      'barra invertida': 'Lazunox\\x',
      'flujo ADS «:»': 'Lazunox/a.txt:evil',
      unidad: 'C:/Windows/x',
      UNC: '//srv/share/x',
      'nombre reservado NUL': 'Lazunox/nul.txt',
      'nombre reservado COM1': 'Lazunox/COM1',
      'punto final': 'Lazunox/a.',
      'espacio final': 'Lazunox/a ',
      'otra raíz': 'Otra/x'
    }
    for (const [what, name] of Object.entries(badEntries)) {
      const r = checkZipEntriesWin([...good, { name }])
      results.push({ name: `Windows: ZIP con ${what} se rechaza`, ok: !r.ok && r.reason === 'unsafe-name' })
    }
    const dup = checkZipEntriesWin([...good, { name: 'Lazunox/LAZUNOX.EXE' }])
    results.push({
      name: 'Windows: ZIP con duplicados que solo difieren en mayúsculas se rechaza',
      ok: !dup.ok && dup.reason === 'duplicate'
    })
    const sym = checkZipEntriesWin([...good, { name: 'Lazunox/enlace', isSymlink: true }])
    results.push({ name: 'Windows: ZIP con symlink se rechaza', ok: !sym.ok && sym.reason === 'symlink' })

    // 7. Identidad pública del repositorio (brand.ts)
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
