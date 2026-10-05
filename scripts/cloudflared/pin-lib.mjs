// Núcleo del generador de `resources/cloudflared/pin.json` (modo viaje). PURO e inyectable: todo lo que toca red, disco o
// herramientas del sistema entra por `io`, así que las pruebas lo ejercitan con dobles (nunca descargan nada real).
//
// El pin guarda DOS hashes del asset de macOS: el del `.tgz` (campo `digest` de la API de GitHub) y el del binario extraído (la
// tabla de checksums del CUERPO de la release lista el del binario, no el del `.tgz`: verificado en T0 con cloudflared 2026.9.3).
// Exige que coincidan TRES fuentes antes de escribir nada:
//   1. el cálculo local del `.tgz` descargado  = `digest` de la API,
//   2. el cálculo local del binario extraído    = el hash que lista el cuerpo de la release (o el del `.tgz`, si lo listara así),
//   3. la firma del binario: Developer ID de Cloudflare Inc., equipo 68WVV388M8, identificador `cloudflared`.
import { createHash } from 'node:crypto'

export const REPO = 'cloudflare/cloudflared'
export const SIGNATURE = {
  identifier: 'cloudflared',
  teamId: '68WVV388M8',
  authority: 'Developer ID Application: Cloudflare Inc. (68WVV388M8)'
}
export const TARGETS = { 'darwin-arm64': 'cloudflared-darwin-arm64.tgz' }
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
 * } }} o
 */
export async function buildPin({ version, io }) {
  if (!/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(version)) throw new Error(`versión inválida: ${version}`)
  const release = await io.getJson(`https://api.github.com/repos/${REPO}/releases/tags/${version}`)
  if (!release || typeof release !== 'object' || release.tag_name !== version) throw new Error('la release no es la pedida')
  const published = String(release.published_at ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) throw new Error('la release no trae fecha de publicación')
  const assets = {}
  for (const [key, name] of Object.entries(TARGETS)) {
    const entry = (release.assets ?? []).find((a) => a.name === name)
    if (!entry) throw new Error(`falta el asset ${name}`)
    const url = `https://github.com/${REPO}/releases/download/${version}/${name}`
    if (entry.browser_download_url !== url) throw new Error(`URL inesperada para ${name}`)
    const apiDigest = /^sha256:([0-9a-f]{64})$/.exec(String(entry.digest ?? ''))?.[1]
    if (!apiDigest) throw new Error(`la API no da el digest de ${name}`)
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

/** JSON estable (2 espacios y salto final) para escribir `pin.json`. */
export function serializePin(pin) {
  return `${JSON.stringify(pin, null, 2)}\n`
}
