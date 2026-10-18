/**
 * Validación PURA de lo que entra a los comandos de ramas, subida y pull request (main y renderer la comparten).
 * Ningún argumento de `git`/`gh` sale de texto libre sin pasar por aquí: ramas y remotos con lista blanca de caracteres,
 * textos sin bytes nulos ni caracteres de control, y referencias a un PR solo como número o enlace de GitHub conocido.
 */

export type BranchProblem = 'empty' | 'too-long' | 'chars' | 'start' | 'dots' | 'slashes' | 'ends' | 'lock' | 'reserved'

export type CheckResult<P extends string = string> = { ok: true } | { ok: false; problem: P }

const BRANCH_CHARS = /^[A-Za-z0-9._/-]+$/
export const MAX_BRANCH_LEN = 100

/** Nombre de rama que Lazunox acepta crear/subir: ASCII, sin `..`, sin `//`, sin segmentos que empiecen por punto, sin `.lock`. */
export function checkBranchName(name: unknown): CheckResult<BranchProblem> {
  if (typeof name !== 'string' || name === '') return { ok: false, problem: 'empty' }
  if (name.length > MAX_BRANCH_LEN) return { ok: false, problem: 'too-long' }
  if (!BRANCH_CHARS.test(name)) return { ok: false, problem: 'chars' }
  if (!/^[A-Za-z0-9]/.test(name)) return { ok: false, problem: 'start' }
  if (name.includes('..')) return { ok: false, problem: 'dots' }
  if (name.includes('//')) return { ok: false, problem: 'slashes' }
  if (/[./]$/.test(name)) return { ok: false, problem: 'ends' }
  const segs = name.split('/')
  if (segs.some((s) => s.startsWith('.'))) return { ok: false, problem: 'dots' }
  if (segs.some((s) => s.toLowerCase().endsWith('.lock'))) return { ok: false, problem: 'lock' }
  if (name === 'HEAD' || name === '@') return { ok: false, problem: 'reserved' }
  return { ok: true }
}

export function isValidBranchName(name: unknown): name is string {
  return checkBranchName(name).ok
}

const REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** Nombre de un remoto ya configurado (`origin`, `upstream`…). Nunca una URL. */
export function isValidRemoteName(name: unknown): name is string {
  return typeof name === 'string' && REMOTE_RE.test(name) && !name.includes('..')
}

/** Ramas que no se tocan sin una confirmación reforzada. */
const PROTECTED_NAMES = new Set(['main', 'master', 'develop', 'development', 'trunk', 'production', 'prod', 'stable', 'release'])

/**
 * ¿Es una rama protegida por defecto? Nombres habituales, `release/*` y las que se pasen en `extra` (p. ej. la rama
 * predeterminada del remoto). Compara sin distinguir mayúsculas.
 */
export function isProtectedBranch(name: string, extra: readonly (string | null | undefined)[] = []): boolean {
  const n = name.trim().toLowerCase()
  if (!n) return false
  if (PROTECTED_NAMES.has(n)) return true
  if (n.startsWith('release/') || n.startsWith('releases/')) return true
  return extra.some((e) => typeof e === 'string' && e.trim().toLowerCase() === n)
}

/** Sugiere un nombre de rama válido a partir de un texto libre (para el campo de «Nueva rama»). */
export function suggestBranchName(text: string, fallback = 'trabajo'): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || fallback
}

// Textos ---------------------------------------------------------------------

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
export const MAX_PR_TITLE = 256
export const MAX_PR_BODY = 60_000
export const MAX_COMMIT_MESSAGE = 100_000

export function hasControlChars(s: string): boolean {
  return CONTROL.test(s)
}

/** Título de PR: una sola línea, sin caracteres de control, 1..256. */
export function checkPrTitle(title: unknown): CheckResult<'empty' | 'too-long' | 'multiline' | 'control'> {
  if (typeof title !== 'string' || !title.trim()) return { ok: false, problem: 'empty' }
  if (title.length > MAX_PR_TITLE) return { ok: false, problem: 'too-long' }
  if (/[\r\n]/.test(title)) return { ok: false, problem: 'multiline' }
  if (hasControlChars(title)) return { ok: false, problem: 'control' }
  return { ok: true }
}

export function checkPrBody(body: unknown): CheckResult<'too-long' | 'control' | 'type'> {
  if (typeof body !== 'string') return { ok: false, problem: 'type' }
  if (body.length > MAX_PR_BODY) return { ok: false, problem: 'too-long' }
  if (hasControlChars(body)) return { ok: false, problem: 'control' }
  return { ok: true }
}

// Remotos y PR ---------------------------------------------------------------

export interface ParsedRemote {
  host: string
  /** `owner/repo` si la URL lo trae con la forma habitual; si no, `null`. */
  slug: string | null
}

const SLUG_PART = /^[A-Za-z0-9_.-]{1,100}$/

/** Quita usuario y clave de una URL de remoto (`https://usuario:clave@host/x` → `https://host/x`). */
export function maskRemoteUrl(url: string): string {
  const u = url.trim()
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/@]*@)?(.*)$/i.exec(u)
  if (m) return `${m[1]}${m[3]}`
  return u
}

/** Interpreta la URL de un remoto git (https, ssh o `git@host:owner/repo.git`). `null` si no se reconoce. */
export function parseRemoteUrl(url: string): ParsedRemote | null {
  const u = url.trim()
  let host = ''
  let path = ''
  const std = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u)
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(u)
  if (std) {
    host = std[1]
    path = std[2]
  } else if (scp) {
    host = scp[1]
    path = scp[2]
  } else return null
  host = host.toLowerCase()
  path = path.replace(/\.git$/i, '').replace(/\/+$/, '')
  const parts = path.split('/')
  const slug = parts.length === 2 && parts.every((p) => SLUG_PART.test(p)) ? `${parts[0]}/${parts[1]}` : null
  return { host, slug }
}

export function isGithubHost(host: string): boolean {
  return host === 'github.com'
}

export function isValidSlug(slug: unknown): slug is string {
  if (typeof slug !== 'string') return false
  const parts = slug.split('/')
  return parts.length === 2 && parts.every((p) => SLUG_PART.test(p) && p !== '.' && p !== '..')
}

export type PrRef = { ok: true; number: number; slug: string | null } | { ok: false; problem: 'empty' | 'format' | 'host' }

/** Un PR se pide por número (`42`, `#42`) o por el enlace de GitHub (`https://github.com/o/r/pull/42`). Nada más llega a `gh`. */
export function parsePrRef(input: unknown): PrRef {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, problem: 'empty' }
  const s = input.trim()
  const num = /^#?(\d{1,7})$/.exec(s)
  if (num) {
    const n = Number(num[1])
    return n > 0 ? { ok: true, number: n, slug: null } : { ok: false, problem: 'format' }
  }
  const link = /^https:\/\/([^/]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d{1,7})(?:[/?#].*)?$/.exec(s)
  if (!link) return { ok: false, problem: 'format' }
  if (link[1].toLowerCase() !== 'github.com') return { ok: false, problem: 'host' }
  const n = Number(link[4])
  if (n <= 0) return { ok: false, problem: 'format' }
  return { ok: true, number: n, slug: `${link[2]}/${link[3]}` }
}
