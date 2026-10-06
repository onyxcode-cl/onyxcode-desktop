// Núcleo del generador de las claves de `resources/opencode-bin/pin.json` para «Tareas en Windows»: `wsl-rootfs` (la imagen base) y
// `assets["linux-x64"]` (el `opencode` de Linux que se instala dentro de la distro). PURO e inyectable: la red entra por `io`, así
// que las pruebas usan dobles (nunca descargan nada real). No escribe nada: devuelve el pin nuevo; `pin.mjs` lo guarda con --write.
//
// La imagen se fija con DOS construcciones independientes (CI y local): los dos `rootfs-build.json` deben coincidir entre sí y con el
// asset publicado (sha256 y tamaño), y el asset debe pasar `inspect`. El `opencode` de Linux exige la misma versión que `pin.version`,
// y que el sha256 calculado coincida con el `digest` de la API de GitHub.
import { createHash } from 'node:crypto'
import { inspectTarGz, UNPACKED_MAX } from './inspect-lib.mjs'

export const ROOTFS_REPO = 'onyxcode-cl/lazunox-wsl'
export const OPENCODE_REPO = 'anomalyco/opencode'
/** Nombre del asset de Linux x64 (glibc, no baseline). A COMPROBAR contra la release real antes del primer `--write`. */
export const OPENCODE_LINUX_ASSET = 'opencode-linux-x64.tar.gz'
export const OPENCODE_LINUX_KEY = 'linux-x64'
export const ROOTFS_VERSION_RE = /^\d{4}\.\d{1,2}\.\d{1,2}$/
export const OPENCODE_MAX_SIZE = 400_000_000

const HEX64 = /^[0-9a-f]{64}$/
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** URL fija de la imagen publicada para una versión. */
export const rootfsUrl = (version) =>
  `https://github.com/${ROOTFS_REPO}/releases/download/rootfs-${version}/lazunox-rootfs-${version}-x64.tar.gz`

/** Valida la forma de un `rootfs-build.json` y lo devuelve; lanza si no es válido. */
export function parseBuildJson(raw, label = 'rootfs-build.json') {
  const j = typeof raw === 'string' ? JSON.parse(raw) : raw
  const bad = (why) => {
    throw new Error(`${label}: ${why}`)
  }
  if (!j || typeof j !== 'object') bad('no es un objeto')
  if (j.id !== 'lazunox-rootfs') bad('id inesperado')
  if (j.arch !== 'x64') bad('arquitectura inesperada')
  if (typeof j.version !== 'string' || !ROOTFS_VERSION_RE.test(j.version)) bad('versión inválida')
  if (typeof j.sha256 !== 'string' || !HEX64.test(j.sha256)) bad('sha256 inválido')
  if (!Number.isSafeInteger(j.size) || j.size <= 0) bad('tamaño inválido')
  if (!Number.isSafeInteger(j.unpackedSize) || j.unpackedSize <= 0 || j.unpackedSize > UNPACKED_MAX) bad('tamaño descomprimido inválido')
  if (typeof j.builtAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(j.builtAt)) bad('builtAt inválido')
  if (typeof j.snapshot !== 'string' || !/^\d{8}T\d{6}Z$/.test(j.snapshot)) bad('snapshot inválido')
  if (!Number.isSafeInteger(j.epoch) || j.epoch <= 0) bad('epoch inválido')
  return j
}

/**
 * Construye el valor de la clave `wsl-rootfs`.
 * @param {{ version: string, minVersion?: string, builds: unknown[], download(url: string): Promise<Buffer>, wslConf: string }} o
 */
export async function buildRootfsPin({ version, minVersion = version, builds, download, wslConf }) {
  if (!ROOTFS_VERSION_RE.test(version)) throw new Error(`versión inválida: ${version}`)
  if (!ROOTFS_VERSION_RE.test(minVersion) || compareVersions(minVersion, version) > 0) throw new Error('minVersion debe ser ≤ version')
  if (!Array.isArray(builds) || builds.length !== 2) throw new Error('hacen falta las DOS construcciones (CI y local)')
  const [a, b] = builds.map((x, i) => parseBuildJson(x, `construcción ${i + 1}`))
  for (const k of ['version', 'sha256', 'size', 'unpackedSize', 'snapshot', 'epoch', 'builtAt']) {
    if (a[k] !== b[k]) throw new Error(`las dos construcciones difieren en ${k} (${a[k]} ≠ ${b[k]})`)
  }
  if (a.version !== version) throw new Error(`las construcciones son de la versión ${a.version}, no de ${version}`)
  const url = rootfsUrl(version)
  const tgz = await download(url)
  if (tgz.length !== a.size) throw new Error(`tamaño del asset distinto del de las construcciones (${tgz.length} ≠ ${a.size})`)
  if (sha256(tgz) !== a.sha256) throw new Error('el SHA-256 del asset publicado no coincide con el de las construcciones')
  const r = inspectTarGz(tgz, { wslConf, expectedVersion: version })
  if (!r.ok) throw new Error(`la imagen no pasa inspect:\n- ${r.errors.join('\n- ')}`)
  if (r.info.unpackedSize !== a.unpackedSize) throw new Error('el tamaño descomprimido real no coincide con rootfs-build.json')
  return {
    version,
    minVersion,
    builtAt: a.builtAt,
    url,
    sha256: a.sha256,
    size: a.size,
    unpackedMax: UNPACKED_MAX
  }
}

/** Compara dos versiones `YYYY.M.D` numéricamente. */
export function compareVersions(x, y) {
  const p = (v) => v.split('.').map(Number)
  const [a, b] = [p(x), p(y)]
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/**
 * Asset `linux-x64` de opencode para la versión del pin, comprobado contra la API de GitHub (digest, tamaño y URL).
 * @param {{ version: string, io: { getJson(url: string): Promise<any>, download(url: string): Promise<Buffer> } }} o
 */
export async function buildOpencodeLinuxAsset({ version, io }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`versión de opencode inválida: ${version}`)
  const tag = `v${version}`
  const release = await io.getJson(`https://api.github.com/repos/${OPENCODE_REPO}/releases/tags/${tag}`)
  if (!release || typeof release !== 'object' || release.tag_name !== tag) throw new Error('la release de opencode no es la pedida')
  const entry = (release.assets ?? []).find((x) => x.name === OPENCODE_LINUX_ASSET)
  if (!entry) throw new Error(`falta el asset ${OPENCODE_LINUX_ASSET} en la release ${tag}`)
  const url = `https://github.com/${OPENCODE_REPO}/releases/download/${tag}/${OPENCODE_LINUX_ASSET}`
  if (entry.browser_download_url !== url) throw new Error(`URL inesperada para ${OPENCODE_LINUX_ASSET}`)
  const apiDigest = /^sha256:([0-9a-f]{64})$/.exec(String(entry.digest ?? ''))?.[1]
  if (!apiDigest) throw new Error('la API no da el digest del asset de opencode')
  const buf = await io.download(url)
  if (buf.length !== entry.size) throw new Error(`tamaño del .tar.gz de opencode distinto del de la API (${buf.length} ≠ ${entry.size})`)
  if (buf.length > OPENCODE_MAX_SIZE) throw new Error('el asset de opencode es demasiado grande')
  const hash = sha256(buf)
  if (hash !== apiDigest) throw new Error('el SHA-256 del asset de opencode no coincide con el `digest` de la API')
  return { url, sha256: hash, size: buf.length }
}

/**
 * Devuelve `existing` con `wsl-rootfs` y `assets["linux-x64"]` añadidos o reemplazados (el resto del pin queda igual, en el mismo
 * orden). No modifica `existing`.
 */
export function mergePin(existing, { rootfs, opencodeLinux }) {
  if (!existing || typeof existing.version !== 'string' || !existing.assets || typeof existing.assets !== 'object')
    throw new Error('pin.json existente inválido')
  if (!rootfs || !HEX64.test(rootfs.sha256)) throw new Error('falta el pin de la imagen')
  if (!opencodeLinux || !HEX64.test(opencodeLinux.sha256)) throw new Error('falta el asset linux-x64 de opencode')
  if (!opencodeLinux.url.includes(`/v${existing.version}/`)) throw new Error('el asset linux-x64 no es de la versión de opencode del pin')
  const out = { ...existing, assets: { ...existing.assets, [OPENCODE_LINUX_KEY]: opencodeLinux }, 'wsl-rootfs': rootfs }
  return out
}

/** JSON estable (2 espacios y salto final) para escribir `pin.json`. */
export function serializePin(pin) {
  return `${JSON.stringify(pin, null, 2)}\n`
}
