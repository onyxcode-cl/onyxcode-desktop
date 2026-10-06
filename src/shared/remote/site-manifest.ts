/**
 * Manifiesto del sitio del control remoto (`<CLOUD_ORIGIN>/site-manifest.json`; dominio en `CLOUD_DOMAIN`, EXTERNO-PENDIENTE: D3) y su firma Ed25519.
 *
 * Lo genera y firma el dueño en su Mac (`scripts/site-release.mjs`) y lo comprueba el Mac cada 6 h (`site-watch.ts`). TypeScript
 * puro (la verificación de la firma y los hashes viven en `src/main/remote/site-watch.ts`, que usa `node:crypto`).
 *
 * Qué detecta: una manipulación NO dirigida del sitio (alguien cambió un archivo de arranque, las cabeceras o el service worker).
 * Qué NO detecta: una versión distinta servida solo al celular (quien controle el borde de Cloudflare podría hacerlo): riesgo
 * residual documentado en docs/SEGURIDAD.md. Nada que la página diga de sí misma es una prueba.
 */
export const SITE_MANIFEST_PATH = '/site-manifest.json'
export const SITE_SIGNATURE_PATH = '/site-manifest.sig'
export const SITE_MANIFEST_MAX_BYTES = 256 * 1024
export const SITE_FILE_MAX_BYTES = 4 * 1024 * 1024
export const SITE_MAX_FILES = 2000
export const SITE_MAX_STARTUP = 40

export interface SiteFile {
  /** Ruta relativa al sitio, sin `/` inicial (`assets/index-AbC123.js`). */
  p: string
  sha256: string
}

export interface SiteManifest {
  v: 1
  keyId: string
  /** Huella de la publicación (12 hex; la misma que lleva el service worker). */
  build: string
  version: string
  /** Contador creciente (segundos de publicación): el Mac no acepta uno menor que el último que vio (sin volver atrás). */
  seq: number
  publishedAt: string
  /** CSP exacta que el sitio debe mandar en `index.html`. */
  csp: string
  files: SiteFile[]
  /** Archivos del arranque que el Mac descarga y compara (subconjunto de `files`). */
  startup: string[]
}

const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const SHA_RE = /^[0-9a-f]{64}$/
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function safeSitePath(p: unknown): p is string {
  return typeof p === 'string' && PATH_RE.test(p) && !p.includes('..') && !p.includes('//') && !p.endsWith('/')
}

/** Valida la forma del manifiesto ya VERIFICADO (la firma manda; esto es defensa en profundidad). `null` si algo no cuadra. */
export function parseSiteManifest(text: string): SiteManifest | null {
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(o)) return null
  const keys = ['v', 'keyId', 'build', 'version', 'seq', 'publishedAt', 'csp', 'files', 'startup']
  if (Object.keys(o).some((k) => !keys.includes(k)) || keys.some((k) => !(k in o))) return null
  if (o.v !== 1) return null
  if (typeof o.keyId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(o.keyId)) return null
  if (typeof o.build !== 'string' || !/^[a-f0-9]{12}$/.test(o.build)) return null
  if (typeof o.version !== 'string' || !/^[A-Za-z0-9.+-]{1,32}$/.test(o.version)) return null
  if (typeof o.seq !== 'number' || !Number.isSafeInteger(o.seq) || o.seq < 1) return null
  if (typeof o.publishedAt !== 'string' || o.publishedAt.length > 40) return null
  if (typeof o.csp !== 'string' || o.csp.length < 10 || o.csp.length > 2000) return null
  if (!Array.isArray(o.files) || o.files.length === 0 || o.files.length > SITE_MAX_FILES) return null
  const files: SiteFile[] = []
  const seen = new Set<string>()
  for (const f of o.files) {
    if (!isObj(f) || Object.keys(f).some((k) => k !== 'p' && k !== 'sha256')) return null
    if (!safeSitePath(f.p) || typeof f.sha256 !== 'string' || !SHA_RE.test(f.sha256) || seen.has(f.p)) return null
    seen.add(f.p)
    files.push({ p: f.p, sha256: f.sha256 })
  }
  if (!Array.isArray(o.startup) || o.startup.length === 0 || o.startup.length > SITE_MAX_STARTUP) return null
  const startup: string[] = []
  for (const p of o.startup) {
    if (!safeSitePath(p) || !seen.has(p) || startup.includes(p)) return null
    startup.push(p)
  }
  // Lo mínimo que el sitio no puede dejar de proteger.
  for (const must of ['index.html', 'sw.js', 'manifest.webmanifest']) if (!startup.includes(must)) return null
  return { v: 1, keyId: o.keyId, build: o.build, version: o.version, seq: o.seq, publishedAt: o.publishedAt, csp: o.csp, files, startup }
}
