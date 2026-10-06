// Inspector de la imagen base de «Tareas en Windows» (`lazunox-rootfs-<ver>-x64.tar.gz`). PURO y sin dependencias: lector ustar
// mínimo (con extensiones GNU `L`/`K` y pax `x`/`g` para nombres largos) sobre un Buffer; las pruebas lo ejercitan con tars creados
// en memoria. No extrae nada a disco: solo lee cabeceras y guarda el contenido de unos pocos archivos pequeños.
import { gunzipSync } from 'node:zlib'

export const UNPACKED_MAX = 943_718_400 // 900 MiB de tar descomprimido
export const MAX_KEPT_FILE = 1 << 20 // solo se retiene el contenido de archivos de hasta 1 MiB y de la lista de abajo
export const KEEP = new Set(['etc/wsl.conf', 'etc/passwd', 'etc/group', 'etc/shadow', 'etc/lazunox-rootfs.json'])
export const REQUIRED_BINARIES = [
  { name: 'python3', dirs: ['usr/bin', 'bin'] },
  { name: 'rg', dirs: ['usr/bin', 'bin'] },
  { name: 'git', dirs: ['usr/bin', 'bin'] },
  { name: 'mount', dirs: ['usr/bin', 'bin'] }
]
export const PASSWD_LINE = /^lazunox:x:1000:1000:[^:\n]*:\/home\/lazunox:\/usr\/sbin\/nologin$/m

const BLOCK = 512
const TYPES = { 0: 'file', 7: 'file', 1: 'hardlink', 2: 'symlink', 3: 'chardev', 4: 'blockdev', 5: 'dir', 6: 'fifo' }

const str = (b, o, n) => {
  const s = b.subarray(o, o + n)
  const z = s.indexOf(0)
  return s.subarray(0, z === -1 ? n : z).toString('utf8')
}

/** Número de un campo ustar: octal ASCII o base-256 (bit alto del primer byte). Lanza si no es válido. */
function num(b, o, n, what) {
  if (b[o] & 0x80) {
    let v = b[o] & 0x7f
    for (let i = 1; i < n; i++) v = v * 256 + b[o + i]
    if (!Number.isSafeInteger(v)) throw new Error(`campo ${what} fuera de rango`)
    return v
  }
  const t = str(b, o, n).trim()
  if (t === '') return 0
  if (!/^[0-7]+$/.test(t)) throw new Error(`campo ${what} no es octal: «${t}»`)
  return parseInt(t, 8)
}

/** Suma de control de una cabecera (con el campo chksum como espacios). */
function checksum(b, off) {
  let s = 0
  for (let i = 0; i < BLOCK; i++) s += i >= 148 && i < 156 ? 32 : b[off + i]
  return s
}

const isZero = (b, off) => {
  for (let i = 0; i < BLOCK; i++) if (b[off + i] !== 0) return false
  return true
}

/** Registros pax `len key=value\n` → objeto. */
function parsePax(buf) {
  const out = {}
  let p = 0
  while (p < buf.length) {
    const sp = buf.indexOf(0x20, p)
    if (sp === -1) throw new Error('registro pax mal formado')
    const len = Number(buf.subarray(p, sp).toString('ascii'))
    if (!Number.isInteger(len) || len <= sp - p + 1 || p + len > buf.length) throw new Error('longitud pax inválida')
    const rec = buf.subarray(sp + 1, p + len - 1).toString('utf8')
    const eq = rec.indexOf('=')
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
    p += len
  }
  return out
}

/**
 * Lee un tar (sin comprimir). Devuelve `{ entries, errors }`: cada entrada es `{ path, type, mode, uid, gid, size, linkname, data? }`
 * (`path` tal cual viene en el tar, sin normalizar). Los fallos de formato (cabecera corrupta, cuerpo truncado, falta de bloques
 * de cierre) van a `errors` y se corta la lectura; no lanza por contenido hostil.
 */
export function readTar(buf) {
  const entries = []
  const errors = []
  let off = 0
  let pending = {} // extensiones (L, K, x) que valen para la SIGUIENTE entrada
  let global = {}
  let ended = false
  try {
    while (off < buf.length) {
      if (off + BLOCK > buf.length) throw new Error('cabecera truncada')
      if (isZero(buf, off)) {
        if (off + 2 * BLOCK <= buf.length && isZero(buf, off + BLOCK)) {
          ended = true
          // Lo que sigue al cierre solo puede ser relleno de ceros.
          for (let i = off + 2 * BLOCK; i < buf.length; i++) if (buf[i] !== 0) throw new Error('datos tras el cierre del tar')
          break
        }
        throw new Error('un solo bloque de ceros: tar corrupto')
      }
      if (num(buf, off + 148, 8, 'chksum') !== checksum(buf, off)) throw new Error(`suma de control inválida en el desplazamiento ${off}`)
      const typeflag = buf[off + 156] === 0 ? '0' : String.fromCharCode(buf[off + 156])
      const size = num(buf, off + 124, 12, 'size')
      const bodyStart = off + BLOCK
      const padded = Math.ceil(size / BLOCK) * BLOCK
      if (bodyStart + padded > buf.length) throw new Error(`cuerpo truncado (${size} bytes) en el desplazamiento ${off}`)
      const body = buf.subarray(bodyStart, bodyStart + size)
      const isUstar = str(buf, off + 257, 5) === 'ustar'
      let name = str(buf, off, 100)
      const prefix = isUstar ? str(buf, off + 345, 155) : ''
      if (prefix) name = `${prefix}/${name}`
      const next = bodyStart + padded
      if (typeflag === 'L') pending.path = str(body, 0, body.length)
      else if (typeflag === 'K') pending.linkpath = str(body, 0, body.length)
      else if (typeflag === 'x') pending = { ...pending, ...parsePax(body) }
      else if (typeflag === 'g') global = { ...global, ...parsePax(body) }
      else {
        const p = { ...global, ...pending }
        pending = {}
        const type = TYPES[typeflag] ?? `otro(${typeflag})`
        const path = p.path ?? name
        const realSize = p.size !== undefined ? Number(p.size) : size
        const entry = {
          path,
          type,
          mode: num(buf, off + 100, 8, 'mode'),
          uid: p.uid !== undefined ? Number(p.uid) : num(buf, off + 108, 8, 'uid'),
          gid: p.gid !== undefined ? Number(p.gid) : num(buf, off + 116, 8, 'gid'),
          size: type === 'file' ? realSize : 0,
          linkname: p.linkpath ?? str(buf, off + 157, 100)
        }
        const key = normalize(path)
        if (type === 'file' && KEEP.has(key) && size <= MAX_KEPT_FILE) entry.data = Buffer.from(body)
        entries.push(entry)
      }
      off = next
    }
    if (!ended) throw new Error('el tar no termina con los dos bloques de ceros (truncado)')
  } catch (e) {
    errors.push(`tar ilegible: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { entries, errors }
}

/** `./etc/passwd` y `etc/passwd/` → `etc/passwd`; la raíz es ``. */
export function normalize(p) {
  return p
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
    .replace(/^\.$/, '')
}

/** Ruta segura dentro de la imagen: relativa (o con `./`), sin `..`, sin raíz absoluta, sin NUL ni `\`. */
export function unsafePath(p) {
  if (p.length === 0) return 'ruta vacía'
  if (p.startsWith('/')) return 'ruta absoluta'
  if (p.includes('\0')) return 'NUL en la ruta'
  if (p.includes('\\')) return 'barra invertida en la ruta'
  const parts = normalize(p).split('/')
  if (parts.includes('..')) return 'componente ..'
  if (normalize(p) !== '' && (parts.includes('.') || parts.includes(''))) return 'componente . o vacío'
  return null
}

/**
 * Comprueba la imagen. `entries` sale de `readTar`; `wslConf` es el contenido EXACTO esperado de `/etc/wsl.conf`
 * (el de `resources/wsl/wsl.conf`); `unpackedSize` el tamaño del tar descomprimido.
 * @returns {{ ok: boolean, errors: string[], info: { entries: number, unpackedSize: number, version: string|null } }}
 */
export function inspectEntries(entries, { wslConf, unpackedSize, unpackedMax = UNPACKED_MAX, expectedVersion = null }) {
  const errors = []
  const by = new Map()
  const children = new Map() // carpeta normalizada → nº de hijos
  const exists = (p) => by.has(p)
  for (const e of entries) {
    const bad = unsafePath(e.path)
    if (bad) {
      errors.push(`ruta insegura «${e.path}»: ${bad}`)
      continue
    }
    const key = normalize(e.path)
    by.set(key, e)
    if (key) {
      const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : ''
      children.set(parent, (children.get(parent) ?? 0) + 1)
    }
    if (e.type === 'hardlink') {
      const t = e.linkname
      if (unsafePath(t)) errors.push(`enlace duro inseguro «${e.path}» → «${t}»`)
    }
    if (e.type.startsWith('otro(')) errors.push(`tipo de entrada no admitido ${e.type} en «${e.path}»`)
    if (e.type !== 'symlink' && (e.mode & 0o6000) !== 0) errors.push(`setuid/setgid en «${e.path}» (modo ${(e.mode & 0o7777).toString(8)})`)
  }
  if (unpackedSize > unpackedMax) errors.push(`tamaño descomprimido ${unpackedSize} > ${unpackedMax}`)

  const wsl = by.get('etc/wsl.conf')
  if (!wsl || wsl.type !== 'file') errors.push('falta /etc/wsl.conf')
  else if (!wsl.data || wsl.data.toString('utf8') !== wslConf) errors.push('/etc/wsl.conf no es igual a resources/wsl/wsl.conf')

  const passwd = by.get('etc/passwd')
  if (!passwd?.data) errors.push('falta /etc/passwd')
  else if (!PASSWD_LINE.test(passwd.data.toString('utf8')))
    errors.push('/etc/passwd no trae lazunox:x:1000:1000:…:/home/lazunox:/usr/sbin/nologin')
  else {
    const lines = passwd.data.toString('utf8').split('\n')
    const withUid = lines.filter((l) => l.split(':')[2] === '1000')
    if (withUid.length !== 1) errors.push('el uid 1000 debe ser solo de lazunox')
  }
  const group = by.get('etc/group')
  if (!group?.data || !/^lazunox:x:1000:/m.test(group.data.toString('utf8'))) errors.push('/etc/group no trae el grupo lazunox (1000)')
  const shadow = by.get('etc/shadow')
  if (shadow?.data) {
    const root = shadow.data
      .toString('utf8')
      .split('\n')
      .find((l) => l.startsWith('root:'))
    if (!root || !/^root:[*!]/.test(root)) errors.push('la cuenta root no está bloqueada en /etc/shadow')
  } else errors.push('falta /etc/shadow')

  for (const bad of ['usr/bin/sudo', 'bin/sudo', 'usr/sbin/sudo', 'etc/sudoers']) {
    if (exists(bad)) errors.push(`no debe haber ${bad}`)
  }

  const opt = by.get('opt/lazunox')
  if (!opt || opt.type !== 'dir') errors.push('falta la carpeta /opt/lazunox')
  else {
    if ((opt.mode & 0o7777) !== 0o755 || opt.uid !== 0 || opt.gid !== 0) errors.push('/opt/lazunox debe ser root:root 0755')
    if ((children.get('opt/lazunox') ?? 0) > 0) errors.push('/opt/lazunox debe estar vacío')
  }

  const inst = by.get('usr/local/sbin/lazunox-install')
  if (!inst || inst.type !== 'file') errors.push('falta /usr/local/sbin/lazunox-install')
  else if ((inst.mode & 0o7777) !== 0o755 || inst.uid !== 0 || inst.gid !== 0) errors.push('lazunox-install debe ser root:root 0755')

  for (const { name, dirs } of REQUIRED_BINARIES) {
    if (!dirs.some((d) => exists(`${d}/${name}`))) errors.push(`falta el binario ${name} (${dirs.map((d) => `/${d}/${name}`).join(' o ')})`)
  }

  let version = null
  const marker = by.get('etc/lazunox-rootfs.json')
  if (!marker?.data) errors.push('falta /etc/lazunox-rootfs.json')
  else {
    try {
      const j = JSON.parse(marker.data.toString('utf8'))
      if (j?.id !== 'lazunox-rootfs' || typeof j.version !== 'string' || !/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(j.version))
        errors.push('/etc/lazunox-rootfs.json no tiene id y versión válidos')
      else version = j.version
      if (version && expectedVersion && version !== expectedVersion)
        errors.push(`la versión de la imagen es ${version}, se esperaba ${expectedVersion}`)
    } catch {
      errors.push('/etc/lazunox-rootfs.json no es JSON')
    }
  }
  return { ok: errors.length === 0, errors, info: { entries: entries.length, unpackedSize, version } }
}

/**
 * Inspecciona un `.tar.gz` en memoria. Descomprime con tope (`unpackedMax`+1) para no agotar la memoria con una bomba.
 * @param {Buffer} tgz
 * @param {{ wslConf: string, unpackedMax?: number, expectedVersion?: string|null }} opts
 */
export function inspectTarGz(tgz, opts) {
  const max = opts.unpackedMax ?? UNPACKED_MAX
  let tar
  try {
    tar = gunzipSync(tgz, { maxOutputLength: max + BLOCK * 4 })
  } catch (e) {
    const tooBig = e?.code === 'ERR_BUFFER_TOO_LARGE'
    return {
      ok: false,
      errors: [tooBig ? `la imagen descomprimida pasa de ${max} bytes` : `gzip ilegible: ${e?.message ?? e}`],
      info: { entries: 0, unpackedSize: tooBig ? max + 1 : 0, version: null }
    }
  }
  const { entries, errors: tarErrors } = readTar(tar)
  const r = inspectEntries(entries, { ...opts, unpackedSize: tar.length })
  const errors = [...tarErrors, ...r.errors]
  return { ok: errors.length === 0, errors, info: r.info }
}
