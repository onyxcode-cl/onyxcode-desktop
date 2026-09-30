/** Lógica pura (sin Electron) del aviso de versión nueva. */
import type { InstallState } from './update-install'

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export interface UpdateState {
  available: boolean
  configured: boolean
  enabled: boolean
  current: string
  latest: { version: string; url: string } | null
  dismissed: string | null
  lastCheck: number | null
  checking: boolean
  /** true si esta copia puede descargar e instalar sola (clave de firma, repositorio y carpeta con permiso). */
  installable: boolean
  /** Estado de la descarga/instalación (idle si no hay nada en curso). */
  install: InstallState
}

export interface Semver {
  major: number
  minor: number
  patch: number
  pre: string[] | null
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseSemver(raw: string): Semver | null {
  if (typeof raw !== 'string') return null
  const m = SEMVER_RE.exec(raw.replace(/^[vV]/, ''))
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return { major, minor, patch, pre: m[4] ? m[4].split('.') : null }
}

function comparePre(a: string[] | null, b: string[] | null): number {
  if (!a && !b) return 0
  if (!a) return 1 // sin prerelease > con prerelease
  if (!b) return -1
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (xn) return -1
    else if (yn) return 1
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePre(a.pre, b.pre)
}

export function isNewerRelease(latest: { tag: string; prerelease: boolean; draft: boolean }, current: string): boolean {
  if (latest.draft) return false
  const l = parseSemver(latest.tag)
  const c = parseSemver(current)
  if (!l || !c) return false
  if ((latest.prerelease || l.pre) && !c.pre) return false
  return compareSemver(l, c) > 0
}

export function isValidRepo(r: unknown): r is string {
  if (typeof r !== 'string' || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(r)) return false
  const name = r.split('/')[1]
  return name !== '.' && name !== '..'
}

export function releasesApiUrl(repo: string, base = 'https://api.github.com'): string {
  return `${base.replace(/\/+$/, '')}/repos/${repo}/releases/latest`
}

/** Solo devuelve una URL https://github.com/{owner}/{repo}/releases/...; si no, la página de la release por tag. */
export function safeReleaseUrl(raw: unknown, repo: string, tag: string): string {
  const fallback = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
  if (typeof raw !== 'string') return fallback
  try {
    // URL normaliza «:443» y lo borra: se mira también el texto original.
    if (/^[a-z]+:\/\/[^/?#]*[:@]/i.test(raw)) return fallback
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.hostname !== 'github.com') return fallback
    if (u.username || u.password || u.port) return fallback
    if (!u.pathname.toLowerCase().startsWith(`/${repo}/releases/`.toLowerCase())) return fallback
    return u.href
  } catch {
    return fallback
  }
}

export function nextCheckDue(o: { now: number; lastCheck: number | null; retryAfter: number | null; manual: boolean }): boolean {
  if (o.retryAfter !== null && o.now < o.retryAfter) return false
  if (o.manual) return true
  if (o.lastCheck === null) return true
  if (o.now < o.lastCheck) return true // reloj atrasado
  return o.now - o.lastCheck >= CHECK_INTERVAL_MS
}

/** Devuelve el instante (ms epoch) hasta el que no hay que volver a preguntar; entre 1 h y 24 h. */
export function parseRetryAfter(headers: { get(name: string): string | null }, now: number): number {
  let wait = HOUR_MS
  const ra = headers.get('retry-after')
  const reset = headers.get('x-ratelimit-reset')
  if (ra && /^\d+$/.test(ra.trim())) wait = Number(ra.trim()) * 1000
  else if (ra && Number.isFinite(Date.parse(ra))) wait = Date.parse(ra) - now
  else if (reset && /^\d+$/.test(reset.trim())) wait = Number(reset.trim()) * 1000 - now
  return now + Math.min(Math.max(wait, HOUR_MS), CHECK_INTERVAL_MS)
}

export function parseReleaseJson(raw: unknown): { tag: string; url: string | null; draft: boolean; prerelease: boolean } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.tag_name !== 'string' || o.tag_name.length === 0 || o.tag_name.length > 128) return null
  return {
    tag: o.tag_name,
    url: typeof o.html_url === 'string' ? o.html_url : null,
    draft: o.draft === true,
    prerelease: o.prerelease === true
  }
}
