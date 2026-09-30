// Lógica común de scripts/publish-update.mjs y scripts/verify-update.mjs. Reproduce en JS plano lo que hace el
// cliente (src/shared/update-install.ts + src/main/update/{signature,installer}.ts); una prueba comprueba que no se desvían.
// La AUTENTICIDAD la da solo la firma Ed25519 del manifiesto; codesign solo comprueba integridad/coherencia.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const ZIP_MAX_BYTES = 600 * 1024 * 1024
export const MANIFEST_MAX_BYTES = 16 * 1024
export const SIGNATURE_MAX_BYTES = 1024
export const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const ZIP_NAME_RE = /^OnyxCode-\d+\.\d+\.\d+-arm64\.zip$/
const SHA_RE = /^[0-9a-f]{64}$/
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

// ---- claves ---------------------------------------------------------------------------------

/** Lee la clave privada Ed25519 (PEM). Rechaza un archivo dentro del repo o con permisos más abiertos que 0600. NUNCA imprime su contenido. */
export function readPrivateKey(file, repoRoot) {
  if (!file) throw new Error('Define ONYXCODE_UPDATE_KEY_FILE con la ruta de la clave privada (fuera del repositorio).')
  const abs = resolve(file)
  let real
  try {
    real = realpathSync(abs)
  } catch {
    throw new Error(`No existe el archivo de clave: ${abs}`)
  }
  const root = realpathSync(repoRoot)
  if (real === root || real.startsWith(root + sep))
    throw new Error('La clave privada está DENTRO del repositorio: muévela fuera (p.ej. ~/.onyxcode-keys/) y vuelve a intentar.')
  const st = statSync(real)
  if (!st.isFile()) throw new Error('La clave privada no es un archivo normal.')
  if ((st.mode & 0o077) !== 0)
    throw new Error(
      `Permisos demasiado abiertos en la clave privada (${(st.mode & 0o777).toString(8)}): ejecuta chmod 600 sobre el archivo.`
    )
  let key
  try {
    key = createPrivateKey(readFileSync(real))
  } catch {
    throw new Error('El archivo no es una clave privada PEM válida (openssl genpkey -algorithm ed25519).')
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('La clave privada no es Ed25519.')
  return key
}

/** Decodifica una clave pública (SPKI DER base64 de 44 bytes, o 32 crudos). null si no es Ed25519 válida. */
export function decodePublicKey(b64) {
  try {
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null
    const raw = Buffer.from(b64, 'base64')
    const der = raw.length === 32 ? Buffer.concat([SPKI_PREFIX, raw]) : raw
    if (der.length !== 44 || !der.subarray(0, 12).equals(SPKI_PREFIX)) return null
    const k = createPublicKey({ key: der, format: 'der', type: 'spki' })
    return k.asymmetricKeyType === 'ed25519' ? k : null
  } catch {
    return null
  }
}

export const publicKeyOf = (privateKey) => createPublicKey(privateKey)
export const spkiBase64 = (publicKey) => publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
export const signBytes = (bytes, privateKey) => sign(null, bytes, privateKey).toString('base64')
export function verifyBytes(bytes, sigB64, publicKey) {
  try {
    const sig = Buffer.from(String(sigB64).trim(), 'base64')
    return sig.length === 64 && verify(null, bytes, publicKey, sig)
  } catch {
    return false
  }
}

// ---- manifiesto -----------------------------------------------------------------------------

/** Bytes EXACTOS del manifiesto: lo que se firma es esto, y el cliente verifica antes de interpretar el JSON. */
export function manifestBytes(m) {
  return Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8')
}

export function buildManifest({ appId, version, tag, keyId, zipName, size, sha256, publishedAt }) {
  return {
    schema: 1,
    appId,
    version,
    tag,
    platform: 'darwin-arm64',
    keyId,
    zip: { name: zipName, size, sha256 },
    publishedAt
  }
}

export function parseManifest(json) {
  const o = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!o(json) || json.schema !== 1) return null
  const { appId, version, tag, platform, keyId, zip, publishedAt } = json
  if (typeof appId !== 'string' || !appId || appId.length > 128) return null
  if (typeof version !== 'string' || version.length > 64 || !SEMVER_RE.test(version)) return null
  if (typeof tag !== 'string' || !tag || tag.length > 128) return null
  if (platform !== 'darwin-arm64') return null
  if (typeof keyId !== 'string' || !keyId || keyId.length > 64) return null
  if (typeof publishedAt !== 'string' || publishedAt.length > 64 || !Number.isFinite(Date.parse(publishedAt))) return null
  if (!o(zip) || typeof zip.name !== 'string' || typeof zip.sha256 !== 'string') return null
  if (!Number.isSafeInteger(zip.size) || zip.size <= 0 || zip.size > ZIP_MAX_BYTES || !SHA_RE.test(zip.sha256)) return null
  return { schema: 1, appId, version, tag, platform, keyId, zip: { name: zip.name, size: zip.size, sha256: zip.sha256 }, publishedAt }
}

function cmpSemver(a, b) {
  const pa = SEMVER_RE.exec(a.replace(/^[vV]/, ''))
  const pb = SEMVER_RE.exec(b.replace(/^[vV]/, ''))
  if (!pa || !pb) return null
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i]) ? -1 : 1
  if (!pa[4] && !pb[4]) return 0
  return !pa[4] ? 1 : !pb[4] ? -1 : pa[4] < pb[4] ? -1 : pa[4] > pb[4] ? 1 : 0
}

/** Devuelve un texto de error o null. Igual que validateManifest del cliente. */
export function validateManifest(m, { appId, current, tag, keyId }) {
  if (m.appId !== appId) return 'appId distinto'
  if (m.keyId !== keyId) return 'keyId distinto'
  if (m.tag !== tag) return 'el tag no coincide con la release'
  if (m.version !== tag.replace(/^v/, '')) return 'la versión no coincide con el tag'
  if (/-/.test(m.version) || cmpSemver(m.version, current) !== 1) return 'la versión no es mayor que la instalada'
  if (!ZIP_NAME_RE.test(m.zip.name) || m.zip.name !== `OnyxCode-${m.version}-arm64.zip`) return 'nombre de ZIP no válido'
  return null
}

function safeParts(path) {
  const parts = path.split('/')
  if (parts[parts.length - 1] === '') parts.pop()
  if (!parts.length || parts[0] !== 'OnyxCode.app') return null
  return parts.every((p) => p.length > 0 && p !== '.' && p !== '..') ? parts : null
}

// Igual que isSafeZipEntry del cliente: OnyxCode.app/… y, como única excepción, los AppleDouble de ditto --sequesterRsrc.
export function isSafeZipEntry(entry) {
  if (typeof entry !== 'string' || !entry || entry.length > 1024) return false
  if (entry.includes('\0') || entry.includes('\\') || entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return false
  if (entry === '__MACOSX/') return true
  if (entry.startsWith('__MACOSX/')) {
    const rest = entry.slice('__MACOSX/'.length)
    const parts = safeParts(rest)
    return !!parts && (rest.endsWith('/') || parts[parts.length - 1].startsWith('._'))
  }
  return safeParts(entry) !== null
}

// ---- utilidades de sistema ------------------------------------------------------------------

export const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts })

export function sha256File(file) {
  return new Promise((ok, ko) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', ko)
      .on('end', () => ok(h.digest('hex')))
  })
}

/** Listado con zipinfo -1; lanza si alguna entrada no es segura. */
export function listZip(zip) {
  const r = run('/usr/bin/zipinfo', ['-1', zip])
  if (r.status !== 0) throw new Error('no se pudo listar el ZIP (zipinfo)')
  const entries = r.stdout.split('\n').filter(Boolean)
  if (!entries.length) throw new Error('el ZIP está vacío')
  const bad = entries.find((e) => !isSafeZipEntry(e))
  if (bad !== undefined) {
    const hint = bad.startsWith('__MACOSX')
      ? ' (el ZIP lleva metadatos AppleDouble: ejecuta `xattr -cr` sobre la .app y vuelve a generarlo)'
      : ''
    throw new Error(`entrada no permitida en el ZIP: ${JSON.stringify(bad.slice(0, 80))}${hint}`)
  }
  return entries
}

/** Todo symlink debe resolverse dentro de la .app; sin dispositivos ni FIFOs. */
export function walkApp(app) {
  const realRoot = realpathSync(app)
  const inside = (p) => p === realRoot || p.startsWith(realRoot + sep)
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = lstatSync(p)
      if (st.isSymbolicLink()) {
        const t = readlinkSync(p)
        if (t.startsWith('/')) throw new Error(`symlink absoluto: ${relative(app, p)}`)
        let real
        try {
          real = realpathSync(p)
        } catch {
          real = resolve(realpathSync(dirname(p)), t)
        }
        if (!inside(real)) throw new Error(`symlink fuera de la app: ${relative(app, p)}`)
      } else if (st.isDirectory()) visit(p)
      else if (!st.isFile()) throw new Error(`tipo de archivo no permitido: ${relative(app, p)}`)
    }
  }
  visit(app)
}

/** codesign (integridad, NO autenticidad), identificador y Info.plist. Devuelve lista de líneas informativas; lanza si algo no cuadra. */
export function checkBundle(app, { appId, version }) {
  walkApp(app)
  const cs = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  if (cs.status !== 0) throw new Error(`codesign --verify falló: ${(cs.stderr || '').trim().split('\n').pop()}`)
  const dv = run('/usr/bin/codesign', ['-dv', app])
  const ident = /^Identifier=(.*)$/m.exec(`${dv.stderr}\n${dv.stdout}`)?.[1]?.trim()
  if (ident !== appId) throw new Error(`Identifier de la firma «${ident}» distinto de ${appId}`)
  const plist = join(app, 'Contents', 'Info.plist')
  const id = run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist]).stdout.trim()
  const ver = run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]).stdout.trim()
  if (id !== appId) throw new Error(`Info.plist: CFBundleIdentifier «${id}» distinto de ${appId}`)
  if (ver !== version) throw new Error(`Info.plist: versión «${ver}» distinta de ${version}`)
  return [`codesign --verify --deep --strict: coherente`, `Identifier=${ident}`, `Info.plist: ${id} ${ver}`]
}

/** Lee APP_ID, UPDATE_PUBLIC_KEY y UPDATE_KEY_ID de brand.ts (sin importar TS). */
export function readBrand(root) {
  const src = readFileSync(join(root, 'src/shared/brand.ts'), 'utf8')
  const alias = /export const AUTHOR_ALIAS = '([^']*)'/.exec(src)?.[1] ?? ''
  return {
    appId: `cl.${alias}.onyxcode`,
    publicKey: /export const UPDATE_PUBLIC_KEY = '([^']*)'/.exec(src)?.[1] ?? '',
    keyId: /export const UPDATE_KEY_ID = '([^']*)'/.exec(src)?.[1] ?? ''
  }
}
