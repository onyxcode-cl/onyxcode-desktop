/**
 * Rutas del celular: resolución de enlaces simbólicos y lista de denegación de archivos sensibles (F0-T4).
 *
 * La política (`policy.ts`) es LÉXICA: no sigue enlaces simbólicos. Por eso el proxy resuelve `realpath` de toda ruta y de
 * todo `directory` ANTES de decidir y ejecutar: un enlace dentro del ámbito que apunta fuera acaba como una ruta real fuera
 * del ámbito y la política la rechaza. Aquí también vive la lista de archivos que el celular NUNCA puede leer aunque estén
 * dentro de una carpeta permitida (`.env`, claves, `.git/config`, `~/.ssh`, credenciales…).
 */
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

/** `realpath` de una ruta que puede no existir (crear archivos): se resuelve el ancestro existente más cercano. */
export function realpathLoose(p: string): string | null {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return null
  let cur = resolve(p)
  const rest: string[] = []
  for (let i = 0; i < 4096; i++) {
    try {
      const real = realpathSync.native(cur)
      return rest.length > 0 ? join(real, ...rest.reverse()) : real
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // Enlace roto o sin permiso: no se adivina (rechazar).
      if (code !== 'ENOENT') return null
      const parent = dirname(cur)
      if (parent === cur) return null
      rest.push(basename(cur))
      cur = parent
    }
  }
  return null
}

/** ¿`p` está dentro de `base` (o es `base`)? Léxico: ambos deben venir ya resueltos con `realpathLoose`. */
export function isInsideReal(base: string, p: string): boolean {
  const b = resolve(base)
  const r = resolve(p)
  return r === b || r.startsWith(b.endsWith(sep) ? b : b + sep)
}

/** `realpath` de una lista de carpetas permitidas (las que no existen o no se resuelven se descartan). */
export function realDirs(dirs: readonly string[]): string[] {
  const out: string[] = []
  for (const d of dirs) {
    if (typeof d !== 'string' || !isAbsolute(d)) continue
    let r: string
    try {
      r = realpathSync.native(d)
    } catch {
      continue // una carpeta permitida que ya no existe no abre nada
    }
    if (!out.includes(r)) out.push(r)
  }
  return out
}

// ─────────────────────────────── archivos sensibles ───────────────────────────────

/** Carpetas cuyo contenido jamás se lee desde el celular (cualquier nivel del camino). */
const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.azure', '.docker', '.gcloud', '.password-store', 'keychains'])

/** Nombres exactos (minúsculas). */
const SENSITIVE_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '_netrc',
  '.git-credentials',
  '.htpasswd',
  '.pgpass',
  '.my.cnf',
  '.dockercfg',
  '.s3cfg',
  '.boto',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml',
  'secret.json',
  'auth.json',
  'authorized_keys',
  'known_hosts',
  'kubeconfig',
  'terraform.tfvars',
  'service-account.json',
  'serviceaccount.json',
  'application_default_credentials.json',
  'gh-hosts.yml',
  'hosts.yml'
])

/** Extensiones de claves y almacenes de certificados. */
const SENSITIVE_EXT = ['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.kdbx', '.ppk', '.gpg', '.tfstate']

/** Plantillas de `.env` que sí son públicas por convención. */
const ENV_SAFE_SUFFIX = ['.example', '.sample', '.template', '.dist', '.defaults']

const KEY_FILE_RE = /^id_(rsa|dsa|ecdsa|ed25519|xmss)(?!.*\.pub$)/i
const SERVICE_ACCOUNT_RE = /^service[-_]?account.*\.json$/i

/**
 * ¿El archivo (ruta absoluta; se prueba tanto la ruta léxica como la real) es sensible? Prudente: ante la duda, sí.
 */
export function isSensitivePath(abs: string): boolean {
  if (typeof abs !== 'string' || abs.includes('\0')) return true
  const segs = abs.split(/[\\/]+/).filter(Boolean)
  const name = (segs[segs.length - 1] ?? '').toLowerCase()
  if (name === '') return false
  if (segs.slice(0, -1).some((s) => SENSITIVE_DIRS.has(s.toLowerCase()))) return true
  // `.git/config` y todo lo que cuelgue de `.git/` que guarde credenciales o hooks.
  const gi = segs.findIndex((s) => s === '.git')
  if (gi >= 0 && gi < segs.length - 1) {
    const sub = segs
      .slice(gi + 1)
      .join('/')
      .toLowerCase()
    if (
      sub === 'config' ||
      sub.startsWith('config.') ||
      sub.startsWith('hooks/') ||
      sub === 'credentials' ||
      (sub.startsWith('modules/') && sub.endsWith('/config'))
    )
      return true
  }
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) {
    return !ENV_SAFE_SUFFIX.some((s) => name.endsWith(s))
  }
  if (SENSITIVE_NAMES.has(name) || SERVICE_ACCOUNT_RE.test(name) || KEY_FILE_RE.test(name)) return true
  if (SENSITIVE_EXT.some((e) => name.endsWith(e))) return true
  // `.config/gcloud`, `.config/gh`, `.local/share/opencode`: credenciales de CLI conocidas.
  const joined = segs.join('/').toLowerCase()
  if (/(^|\/)\.config\/(gcloud|gh|op|hub)(\/|$)/.test(joined) || /(^|\/)\.local\/share\/opencode(\/|$)/.test(joined)) return true
  if (/(^|\/)library\/(keychains|cookies)(\/|$)/.test(joined)) return true
  return false
}

/** Sensible si lo es la ruta léxica o la real (un enlace `notas.txt -> .env` no debe colar el archivo). */
export function isSensitiveEither(lexical: string, real: string | null): boolean {
  return isSensitivePath(lexical) || (real !== null && isSensitivePath(real))
}
