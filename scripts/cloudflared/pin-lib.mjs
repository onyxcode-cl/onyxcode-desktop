// Núcleo del generador de `resources/cloudflared/pin.json` (modo viaje). PURO e inyectable: todo lo que toca red, disco o
// herramientas del sistema entra por `io`, así que las pruebas lo ejercitan con dobles (nunca descargan nada real).
//
// El pin guarda DOS hashes del asset de macOS: el del `.tgz` (campo `digest` de la API de GitHub) y el del binario extraído (la
// tabla de checksums del CUERPO de la release lista el del binario, no el del `.tgz`: verificado en T0 con cloudflared 2026.9.3).
// Exige que coincidan TRES fuentes antes de escribir nada:
//   1. el cálculo local del `.tgz` descargado  = `digest` de la API,
//   2. el cálculo local del binario extraído    = el hash que lista el cuerpo de la release (o el del `.tgz`, si lo listara así),
//   3. la firma del binario: Developer ID de Cloudflare Inc., equipo 68WVV388M8, identificador `cloudflared`.
//
// Windows (`win32-x64`): la release publica el `.exe` suelto, así que `size`/`sha256` y `binSize`/`binSha256` son los MISMOS (los del
// `.exe`: es lo que exige `parsePin` de la app). Fuentes: cálculo local = `digest` de la API = checksum del cuerpo de la release. El
// sujeto Authenticode NO se puede leer desde la Mac: lo lee una persona en el PC (`scripts/win/cloudflared-subject.ps1`) y entra por
// `authenticodeSubject` (CLI: `--authenticode-subject`); el pin guarda `signature: { subject }` y la app lo compara EXACTO.
import { createHash } from 'node:crypto'

export const REPO = 'cloudflare/cloudflared'
export const SIGNATURE = {
  identifier: 'cloudflared',
  teamId: '68WVV388M8',
  authority: 'Developer ID Application: Cloudflare Inc. (68WVV388M8)'
}
export const TARGETS = { 'darwin-arm64': 'cloudflared-darwin-arm64.tgz', 'win32-x64': 'cloudflared-windows-amd64.exe' }
export const DEFAULT_TARGETS = ['darwin-arm64']
/** Mismo criterio que `SUBJECT_RE` de `src/main/remote/tunnel/binary.ts` (sin caracteres de control, 3 a 300). */
export const SUBJECT_RE = /^[^\u0000-\u001f\u007f]{3,300}$/
export const BIN_MAX_SIZE = 80_000_000

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Hash que lista el cuerpo de la release para `name` (formatos `name: hash`, `hash  name` o fila de tabla). `null` si no aparece. */
export function bodyChecksum(body, name) {
  const n = escapeRe(name)
  const a = new RegExp(`${n}[^0-9a-fA-F\\n]{0,8}([0-9a-fA-F]{64})`).exec(body)
  if (a) return a[1].toLowerCase()
  const b = new RegExp(`([0-9a-fA-F]{64})[^0-9a-fA-F\\n]{0,8}${n}`).exec(body)
  return b ? b[1].toLowerCase() : null
}

/**
 * @param {{ version: string, io: {
 *   getJson(url: string): Promise<any>,
 *   download(url: string): Promise<Buffer>,
 *   extract(tgz: Buffer): Promise<Buffer>,
 *   codesign(bin: Buffer): Promise<{ identifier: string|null, teamId: string|null, authorities: string[] }>
 * }, targets?: string[], authenticodeSubject?: string }} o
 */
export async function buildPin({ version, io, targets = DEFAULT_TARGETS, authenticodeSubject }) {
  if (!/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(version)) throw new Error(`versión inválida: ${version}`)
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('sin plataformas que fijar')
  for (const key of targets) if (!Object.hasOwn(TARGETS, key)) throw new Error(`plataforma desconocida: ${key}`)
  if (targets.includes('win32-x64')) {
    const s = authenticodeSubject
    if (typeof s !== 'string' || !SUBJECT_RE.test(s)) throw new Error('win32-x64 exige --authenticode-subject (sujeto leído en Windows)')
    if (!/Cloudflare/i.test(s)) throw new Error('el sujeto Authenticode no parece de Cloudflare')
  }
  const release = await io.getJson(`https://api.github.com/repos/${REPO}/releases/tags/${version}`)
  if (!release || typeof release !== 'object' || release.tag_name !== version) throw new Error('la release no es la pedida')
  const published = String(release.published_at ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) throw new Error('la release no trae fecha de publicación')
  const assets = {}
  for (const key of targets) {
    const name = TARGETS[key]
    const entry = (release.assets ?? []).find((a) => a.name === name)
    if (!entry) throw new Error(`falta el asset ${name}`)
    const url = `https://github.com/${REPO}/releases/download/${version}/${name}`
    if (entry.browser_download_url !== url) throw new Error(`URL inesperada para ${name}`)
    const apiDigest = /^sha256:([0-9a-f]{64})$/.exec(String(entry.digest ?? ''))?.[1]
    if (!apiDigest) throw new Error(`la API no da el digest de ${name}`)
    if (key === 'win32-x64') {
      const exe = await io.download(url)
      const exeHash = sha256(exe)
      if (exe.length !== entry.size) throw new Error(`tamaño del .exe distinto del de la API (${exe.length} ≠ ${entry.size})`)
      if (exeHash !== apiDigest) throw new Error('el SHA-256 del .exe no coincide con el `digest` de la API')
      if (exe.length > BIN_MAX_SIZE) throw new Error('el .exe es demasiado grande')
      if (exe[0] !== 0x4d || exe[1] !== 0x5a) throw new Error('el .exe no empieza por la cabecera MZ')
      const listedExe = bodyChecksum(String(release.body ?? ''), name)
      if (!listedExe) throw new Error('el cuerpo de la release no lista el checksum del asset')
      if (listedExe !== exeHash) throw new Error('el SHA-256 calculado no coincide con el que lista el cuerpo de la release')
      assets[key] = {
        url,
        size: exe.length,
        sha256: exeHash,
        binSize: exe.length,
        binSha256: exeHash,
        binMaxSize: BIN_MAX_SIZE,
        signature: { subject: authenticodeSubject }
      }
      continue
    }
    const tgz = await io.download(url)
    const tgzHash = sha256(tgz)
    if (tgz.length !== entry.size) throw new Error(`tamaño del .tgz distinto del de la API (${tgz.length} ≠ ${entry.size})`)
    if (tgzHash !== apiDigest) throw new Error('el SHA-256 del .tgz no coincide con el `digest` de la API')
    const bin = await io.extract(tgz)
    const binHash = sha256(bin)
    if (bin.length > BIN_MAX_SIZE) throw new Error('el binario extraído es demasiado grande')
    const listed = bodyChecksum(String(release.body ?? ''), name)
    if (!listed) throw new Error('el cuerpo de la release no lista el checksum del asset')
    if (listed !== binHash && listed !== tgzHash)
      throw new Error('el SHA-256 calculado no coincide con el que lista el cuerpo de la release')
    const sig = await io.codesign(bin)
    if (sig.identifier !== SIGNATURE.identifier || sig.teamId !== SIGNATURE.teamId || !sig.authorities.includes(SIGNATURE.authority))
      throw new Error('la firma del binario no es la de Cloudflare Inc. (68WVV388M8)')
    assets[key] = {
      url,
      size: tgz.length,
      sha256: tgzHash,
      binSize: bin.length,
      binSha256: binHash,
      binMaxSize: BIN_MAX_SIZE,
      signature: { ...SIGNATURE }
    }
  }
  return { version, releasedAt: published, assets }
}

/**
 * Une el pin nuevo con el que ya está escrito: solo si es de la MISMA versión conserva las plataformas que el nuevo no trae (así fijar
 * Windows no borra macOS). Con otra versión, el nuevo manda solo (no se mezclan hashes de versiones distintas).
 */
export function mergePin(existing, fresh) {
  if (!existing || existing.version !== fresh.version) return fresh
  return { ...fresh, assets: { ...existing.assets, ...fresh.assets } }
}

/** JSON estable (2 espacios y salto final) para escribir `pin.json`. */
export function serializePin(pin) {
  return `${JSON.stringify(pin, null, 2)}\n`
}
