// Lógica común de scripts/publish-update.mjs y scripts/verify-update.mjs. Reproduce en JS plano lo que hace el
// cliente (src/shared/update-install.ts + src/main/update/{signature,installer}.ts); una prueba comprueba que no se desvían.
// La AUTENTICIDAD la da solo la firma Ed25519 del manifiesto; codesign solo comprueba integridad/coherencia.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  createReadStream,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  readlinkSync,
  realpathSync,
  statSync,
  writeSync
} from 'node:fs'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const ZIP_MAX_BYTES = 600 * 1024 * 1024
export const MANIFEST_MAX_BYTES = 16 * 1024
export const SIGNATURE_MAX_BYTES = 1024
export const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
/** Réplica de UPDATE_PLATFORMS (src/shared/update-install.ts); una prueba comprueba que no se desvían. */
export const UPDATE_PLATFORMS = {
  'darwin-arm64': {
    id: 'darwin-arm64',
    manifestName: 'update.json',
    manifestSigName: 'update.json.sig',
    zipName: (v) => `Lazunox-${v}-arm64.zip`,
    zipRe: /^Lazunox-\d+\.\d+\.\d+-arm64\.zip$/,
    root: 'Lazunox.app'
  },
  'win32-x64': {
    id: 'win32-x64',
    manifestName: 'update-win32-x64.json',
    manifestSigName: 'update-win32-x64.json.sig',
    zipName: (v) => `Lazunox-${v}-win32-x64.zip`,
    zipRe: /^Lazunox-\d+\.\d+\.\d+-win32-x64\.zip$/,
    root: 'Lazunox/'
  }
}
const SHA_RE = /^[0-9a-f]{64}$/
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

// ---- claves ---------------------------------------------------------------------------------

/** Lee la clave privada Ed25519 (PEM). Rechaza un archivo dentro del repo o con permisos más abiertos que 0600. NUNCA imprime su contenido. */
export function readPrivateKey(file, repoRoot) {
  if (!file) throw new Error('Define LAZUNOX_UPDATE_KEY_FILE con la ruta de la clave privada (fuera del repositorio).')
  const abs = resolve(file)
  let real
  try {
    real = realpathSync(abs)
  } catch {
    throw new Error(`No existe el archivo de clave: ${abs}`)
  }
  const root = realpathSync(repoRoot)
  if (real === root || real.startsWith(root + sep))
    throw new Error('La clave privada está DENTRO del repositorio: muévela fuera (p.ej. ~/.lazunox-keys/) y vuelve a intentar.')
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

export function buildManifest({ appId, version, tag, keyId, zipName, size, sha256, publishedAt, platform = 'darwin-arm64' }) {
  return {
    schema: 1,
    appId,
    version,
    tag,
    platform,
    keyId,
    zip: { name: zipName, size, sha256 },
    publishedAt
  }
}

export function parseManifest(json, expected = 'darwin-arm64') {
  const o = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!o(json) || json.schema !== 1) return null
  const { appId, version, tag, platform, keyId, zip, publishedAt } = json
  if (typeof appId !== 'string' || !appId || appId.length > 128) return null
  if (typeof version !== 'string' || version.length > 64 || !SEMVER_RE.test(version)) return null
  if (typeof tag !== 'string' || !tag || tag.length > 128) return null
  if (platform !== expected || !UPDATE_PLATFORMS[expected]) return null
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
  const spec = UPDATE_PLATFORMS[m.platform]
  if (!spec || !spec.zipRe.test(m.zip.name) || m.zip.name !== spec.zipName(m.version)) return 'nombre de ZIP no válido'
  return null
}

function safeParts(path) {
  const parts = path.split('/')
  if (parts[parts.length - 1] === '') parts.pop()
  if (!parts.length || parts[0] !== 'Lazunox.app') return null
  return parts.every((p) => p.length > 0 && p !== '.' && p !== '..') ? parts : null
}

// Igual que isSafeZipEntry del cliente: Lazunox.app/… y, como única excepción, los AppleDouble de ditto --sequesterRsrc.
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

// Windows: igual que isSafeZipEntryWin / checkZipEntriesWin del cliente.
const WIN_RESERVED_RE = /^(con|prn|aux|nul|conin\$|conout\$|(com|lpt)[0-9¹²³])$/i
const WIN_BAD_CHARS_RE = /[\x00-\x1f<>:"|?*\\]/

function winNamePartOk(p) {
  if (!p || p === '.' || p === '..' || WIN_BAD_CHARS_RE.test(p)) return false
  if (p.endsWith('.') || p.endsWith(' ')) return false
  return !WIN_RESERVED_RE.test(p.split('.')[0].trimEnd())
}

export function isSafeZipEntryWin(entry) {
  if (typeof entry !== 'string' || !entry || entry.length > 1024 || !entry.startsWith('Lazunox/')) return false
  const parts = entry.split('/')
  if (parts[parts.length - 1] === '') parts.pop()
  if (!parts.length || parts[0] !== 'Lazunox') return false
  return parts.every(winNamePartOk)
}

/** entries: [{ name, isSymlink? }]. Devuelve { ok:true } o { ok:false, reason, entry }. */
export function checkZipEntriesWin(entries) {
  if (!entries.length) return { ok: false, reason: 'empty', entry: '' }
  const seen = new Set()
  for (const e of entries) {
    if (!isSafeZipEntryWin(e.name)) return { ok: false, reason: 'unsafe-name', entry: e.name }
    if (e.isSymlink) return { ok: false, reason: 'symlink', entry: e.name }
    const key = (e.name.endsWith('/') ? e.name.slice(0, -1) : e.name).toLowerCase()
    if (seen.has(key)) return { ok: false, reason: 'duplicate', entry: e.name }
    seen.add(key)
  }
  return { ok: true }
}

// ---- Windows: ZIP, índice y versión del asar en JS puro ---------------------------------------
// Reproducen en JS plano lo que el cliente hace con src/main/update/{zip-index,asar-version}.ts (no se pueden importar: son TS);
// src/test/update-scripts-win.test.ts comprueba que no se desvían. Nada de tar, zipinfo ni PowerShell: corre igual en macOS.

/** Ficheros sin los que la app no arranca (réplica de REQUIRED de installer-win.ts), en minúsculas. */
export const WIN_REQUIRED = ['lazunox.exe', 'resources/app.asar', 'resources/opencode/opencode.exe']
export const WIN_ZIP_ROOT = 'Lazunox/'
/** Tope descomprimido que aplica el cliente (installer.ts: UNCOMPRESSED_FACTOR_LIMIT = 3, más 1 GiB). */
export const winUncompressedCap = (zipSize) => zipSize * 3 + 1024 * 1024 * 1024

export function platformSpec(id) {
  const spec = UPDATE_PLATFORMS[id]
  if (!spec) throw new Error(`plataforma desconocida «${id}» (usa ${Object.keys(UPDATE_PLATFORMS).join(' o ')})`)
  return spec
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1980-01-01: fecha fija para que el ZIP sea reproducible
const SIG_LOCAL = 0x04034b50
const SIG_CEN = 0x02014b50
const SIG_EOCD = 0x06054b50

function winTree(dir) {
  /** Orden fijo (por nombre), directorios antes que su contenido; sin enlaces ni tipos raros. */
  const out = []
  const visit = (abs, rel) => {
    for (const name of readdirSync(abs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const p = join(abs, name)
      const r = rel ? `${rel}/${name}` : name
      const st = lstatSync(p)
      if (st.isSymbolicLink()) throw new Error(`enlace simbólico no permitido en la app: ${r}`)
      if (st.isDirectory()) {
        out.push({ rel: r, abs: p, dir: true })
        visit(p, r)
      } else if (st.isFile()) out.push({ rel: r, abs: p, dir: false, size: st.size })
      else throw new Error(`tipo de archivo no permitido en la app: ${r}`)
    }
  }
  visit(dir, '')
  return out
}

/**
 * ZIP de la app de Windows con raíz `Lazunox/`: orden fijo, fecha fija, sin metadatos del sistema y «deflate» (o «stored» si no
 * comprime). Mismos bytes para la misma carpeta y la misma versión de zlib. Todo nombre pasa por checkZipEntriesWin antes de escribir.
 */
export function buildWinZip(srcDir, zipPath) {
  const tree = winTree(srcDir)
  const names = [WIN_ZIP_ROOT, ...tree.map((e) => `${WIN_ZIP_ROOT}${e.rel}${e.dir ? '/' : ''}`)]
  const check = checkZipEntriesWin(names.map((name) => ({ name })))
  if (!check.ok) throw new Error(`nombre no permitido en el ZIP de Windows (${check.reason}): ${JSON.stringify(check.entry.slice(0, 80))}`)
  if (names.length >= 0xffff) throw new Error('demasiados ficheros para un ZIP sin ZIP64')
  const fd = openSync(zipPath, 'w')
  try {
    let off = 0
    const cen = []
    const put = (b) => {
      let w = 0
      while (w < b.length) w += writeSync(fd, b, w, b.length - w)
      off += b.length
    }
    names.forEach((name, i) => {
      const entry = i === 0 ? { dir: true } : tree[i - 1]
      const nb = Buffer.from(name, 'utf8')
      let data = Buffer.alloc(0)
      let method = 0
      let crc = 0
      let usize = 0
      if (!entry.dir) {
        const raw = readFileSync(entry.abs)
        if (raw.length > 0xfffffffe) throw new Error(`fichero demasiado grande para un ZIP sin ZIP64: ${entry.rel}`)
        usize = raw.length
        crc = crc32(raw)
        const def = deflateRawSync(raw, { level: 9 })
        if (def.length < raw.length) [data, method] = [def, 8]
        else data = raw
      }
      const lho = off
      if (lho > 0xfffffffe) throw new Error('el ZIP supera 4 GiB: hace falta ZIP64')
      const lh = Buffer.alloc(30)
      lh.writeUInt32LE(SIG_LOCAL, 0)
      lh.writeUInt16LE(20, 4)
      lh.writeUInt16LE(0x800, 6)
      lh.writeUInt16LE(method, 8)
      lh.writeUInt16LE(0, 10)
      lh.writeUInt16LE(DOS_DATE, 12)
      lh.writeUInt32LE(crc, 14)
      lh.writeUInt32LE(data.length, 18)
      lh.writeUInt32LE(usize, 22)
      lh.writeUInt16LE(nb.length, 26)
      put(lh)
      put(nb)
      put(data)
      const ch = Buffer.alloc(46)
      ch.writeUInt32LE(SIG_CEN, 0)
      ch.writeUInt16LE(20, 4) // creado en MS-DOS/FAT (host 0), versión 2.0
      ch.writeUInt16LE(20, 6)
      ch.writeUInt16LE(0x800, 8)
      ch.writeUInt16LE(method, 10)
      ch.writeUInt16LE(0, 12)
      ch.writeUInt16LE(DOS_DATE, 14)
      ch.writeUInt32LE(crc, 16)
      ch.writeUInt32LE(data.length, 20)
      ch.writeUInt32LE(usize, 24)
      ch.writeUInt16LE(nb.length, 28)
      ch.writeUInt32LE(entry.dir ? 0x10 : 0, 38)
      ch.writeUInt32LE(lho, 42)
      cen.push(ch, nb)
    })
    const cd = Buffer.concat(cen)
    const cdOff = off
    put(cd)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(SIG_EOCD, 0)
    eocd.writeUInt16LE(names.length, 8)
    eocd.writeUInt16LE(names.length, 10)
    eocd.writeUInt32LE(cd.length, 12)
    eocd.writeUInt32LE(cdOff, 16)
    put(eocd)
  } finally {
    closeSync(fd)
  }
  return { entries: names.length }
}

/** Fuente de bytes sobre un fichero (lectura síncrona por posición). */
function fdSource(fd) {
  const size = fstatSync(fd).size
  return {
    size,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > size) throw new Error('lectura fuera de rango')
      const b = Buffer.alloc(length)
      let n = 0
      while (n < length) {
        const r = readSync(fd, b, n, length - n, offset + n)
        if (r === 0) throw new Error('fin de fichero inesperado')
        n += r
      }
      return b
    }
  }
}
const bufSource = (buf) => ({
  size: buf.length,
  read(offset, length) {
    if (offset < 0 || length < 0 || offset + length > buf.length) throw new Error('lectura fuera de rango')
    return buf.subarray(offset, offset + length)
  }
})

/**
 * Índice (directorio central) de un ZIP sin ZIP64, ni varios discos, ni cifrado: lo que genera buildWinZip y lo que produce tar.exe
 * por debajo de 4 GiB. Devuelve [{ name, method, csize, size, crc, flags, lho, isDirectory, isSymlink }]; lanza si no cuadra.
 */
export function readZipIndexJs(src) {
  if (src.size < 22) throw new Error('no es un ZIP')
  const tailLen = Math.min(src.size, 22 + 0xffff)
  const tailStart = src.size - tailLen
  const tail = src.read(tailStart, tailLen)
  let pos = -1
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === SIG_EOCD && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
      pos = i
      break
    }
  if (pos < 0) throw new Error('no se encontró el final del ZIP (EOCD)')
  const count = tail.readUInt16LE(pos + 10)
  const cdSize = tail.readUInt32LE(pos + 12)
  const cdOff = tail.readUInt32LE(pos + 16)
  if (tail.readUInt16LE(pos + 4) !== 0 || tail.readUInt16LE(pos + 6) !== 0 || tail.readUInt16LE(pos + 8) !== count)
    throw new Error('ZIP de varios discos')
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw new Error('ZIP64 no soportado por estos scripts')
  if (cdOff + cdSize > tailStart + pos) throw new Error('directorio central fuera de rango')
  const buf = cdSize > 0 ? src.read(cdOff, cdSize) : Buffer.alloc(0)
  const entries = []
  let p = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) throw new Error('entrada del directorio central no válida')
    const madeBy = buf.readUInt16LE(p + 4)
    const flags = buf.readUInt16LE(p + 8)
    const nameLen = buf.readUInt16LE(p + 28)
    const end = p + 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    if (end > buf.length) throw new Error('entrada del directorio central truncada')
    if (flags & 0x1) throw new Error('entrada cifrada')
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1')
    const ext = buf.readUInt32LE(p + 38)
    const host = madeBy >> 8
    const lho = buf.readUInt32LE(p + 42)
    const csize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    if (csize === 0xffffffff || size === 0xffffffff || lho === 0xffffffff) throw new Error('ZIP64 no soportado por estos scripts')
    if (lho + 30 > cdOff) throw new Error('cabecera local fuera de rango')
    entries.push({
      name,
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      csize,
      size,
      flags,
      lho,
      isDirectory: name.endsWith('/'),
      isSymlink: host === 3 ? ((ext >>> 16) & 0xf000) === 0xa000 : (host === 0 || host === 10) && (ext & 0x400) !== 0
    })
    p = end
  }
  if (p !== buf.length) throw new Error('sobran bytes en el directorio central')
  return entries
}

/** Contenido de una entrada (stored o deflate), comprobando tamaño y CRC-32. Tope: `max` bytes. */
export function readZipEntryJs(src, e, max = ZIP_MAX_BYTES) {
  if (e.size > max) throw new Error(`entrada demasiado grande: ${e.name}`)
  const lh = src.read(e.lho, 30)
  if (lh.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`cabecera local no válida: ${e.name}`)
  const start = e.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)
  if (start + e.csize > src.size) throw new Error(`datos fuera del ZIP: ${e.name}`)
  const raw = src.read(start, e.csize)
  let data
  if (e.method === 0) data = raw
  else if (e.method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(e.size, 1) })
  else throw new Error(`método de compresión ${e.method} no soportado: ${e.name}`)
  if (data.length !== e.size || crc32(data) !== e.crc) throw new Error(`tamaño o CRC-32 incorrecto: ${e.name}`)
  return data
}

const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Réplica de readAsarPackageInfo (asar-version.ts): {name, version} del package.json de la raíz, solo desde la cabecera. */
export function readAsarPackageInfoJs(src) {
  const bad = (m) => new Error(`app.asar no válido: ${m}`)
  if (src.size < 16) throw bad('demasiado corto')
  const head = src.read(0, 16)
  if (head.readUInt32LE(0) !== 4) throw bad('cabecera no válida')
  const headerSize = head.readUInt32LE(4)
  const jsonLen = head.readUInt32LE(12)
  if (headerSize > 32 * 1024 * 1024 || 8 + headerSize > src.size) throw bad('cabecera fuera de rango')
  if (jsonLen === 0 || 16 + jsonLen > 8 + headerSize || head.readUInt32LE(8) < 4 + jsonLen) throw bad('cabecera JSON no válida')
  let header
  try {
    header = JSON.parse(src.read(16, jsonLen).toString('utf8'))
  } catch {
    throw bad('la cabecera no es JSON')
  }
  const files = isObj(header) ? own(header, 'files') : undefined
  const entry = isObj(files) ? own(files, 'package.json') : undefined
  if (!isObj(entry)) throw bad('no tiene package.json en la raíz')
  if (entry.unpacked === true || isObj(entry.files) || entry.link !== undefined) throw bad('package.json fuera del asar')
  const { size, offset } = entry
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024) throw bad('tamaño de package.json')
  if (typeof offset !== 'string' || !/^\d{1,15}$/.test(offset)) throw bad('offset de package.json')
  const start = 8 + headerSize + Number(offset)
  if (start + size > src.size) throw bad('package.json fuera del asar')
  let pkg
  try {
    pkg = JSON.parse(src.read(start, size).toString('utf8'))
  } catch {
    throw bad('package.json no es JSON')
  }
  if (!isObj(pkg) || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') throw bad('package.json sin name o version')
  return { name: pkg.name, version: pkg.version }
}

function assertAsarVersion(info, version) {
  if (info.name !== 'lazunox') throw new Error(`app.asar: nombre «${info.name.slice(0, 40)}» distinto de lazunox`)
  if (info.version !== version) throw new Error(`app.asar: versión «${info.version.slice(0, 40)}» distinta de ${version}`)
}

/** Carpeta win-unpacked lista para empaquetar: sin enlaces, con los ficheros imprescindibles y el asar de la versión esperada. */
export function checkWinApp(dir, { version }) {
  const files = new Set()
  for (const e of winTree(dir)) if (!e.dir) files.add(e.rel.toLowerCase())
  for (const r of WIN_REQUIRED) if (!files.has(r)) throw new Error(`falta ${r} en ${dir}`)
  const asarName = readdirSync(join(dir, 'resources')).find((n) => n.toLowerCase() === 'app.asar')
  const fd = openSync(join(dir, 'resources', asarName), 'r')
  try {
    assertAsarVersion(readAsarPackageInfoJs(fdSource(fd)), version)
  } finally {
    closeSync(fd)
  }
  return [`carpeta de la app: ${files.size} ficheros, imprescindibles presentes`, `app.asar: lazunox ${version}`]
}

/**
 * Lo que el cliente comprobará antes de extraer: nombres seguros bajo Lazunox/ (checkZipEntriesWin), sin enlaces ni duplicados,
 * ficheros imprescindibles, tope descomprimido y versión del app.asar frente a la del manifiesto. Lanza con el motivo.
 */
export function checkWinZip(zipPath, { version }) {
  const fd = openSync(zipPath, 'r')
  try {
    const src = fdSource(fd)
    const entries = readZipIndexJs(src)
    const c = checkZipEntriesWin(entries.map((e) => ({ name: e.name, isSymlink: e.isSymlink })))
    if (!c.ok) throw new Error(`entrada no permitida en el ZIP (${c.reason}): ${JSON.stringify(c.entry.slice(0, 80))}`)
    const total = entries.reduce((a, e) => a + e.size, 0)
    if (total > winUncompressedCap(src.size)) throw new Error('el ZIP se expande por encima del tope que acepta el cliente')
    const byRel = new Map()
    for (const e of entries) if (!e.isDirectory) byRel.set(e.name.slice(WIN_ZIP_ROOT.length).toLowerCase(), e)
    for (const r of WIN_REQUIRED) if (!byRel.has(r)) throw new Error(`falta ${r} en el ZIP`)
    const asar = readZipEntryJs(src, byRel.get('resources/app.asar'))
    assertAsarVersion(readAsarPackageInfoJs(bufSource(asar)), version)
    return [
      `listado del ZIP: ${entries.length} entradas, todas dentro de ${WIN_ZIP_ROOT}, sin enlaces ni duplicados`,
      `ficheros imprescindibles presentes (${WIN_REQUIRED.join(', ')})`,
      `app.asar del ZIP: lazunox ${version}`
    ]
  } finally {
    closeSync(fd)
  }
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
    appId: `cl.${alias}.lazunox`,
    publicKey: /export const UPDATE_PUBLIC_KEY = '([^']*)'/.exec(src)?.[1] ?? '',
    keyId: /export const UPDATE_KEY_ID = '([^']*)'/.exec(src)?.[1] ?? ''
  }
}
