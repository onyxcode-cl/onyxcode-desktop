import { isValidRepo } from '@shared/update-check'

export const GITHUB_API_BASE = 'https://api.github.com'

export interface UpdateConfig {
  /** false = sin red y aviso apagado (no hay repositorio o la variable de test no aplica). */
  configured: boolean
  repo: string
  apiBase: string
  startDelayMs: number
}

export interface ResolveInput {
  isPackaged: boolean
  env: Record<string, string | undefined>
  /** Valor de `RELEASES_REPO` (brand.ts). */
  repo: string
}

const DEFAULT_TEST_DELAY_MS = 500
const PACKAGED_DELAY_MS = 8000

/** Solo `http://127.0.0.1:<puerto>` (servidor local de tests) o cualquier `https:` sin credenciales. */
function testApiBase(raw: string | undefined): string | null {
  if (!raw) return null
  if (/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(raw)) return raw.replace(/\/+$/, '')
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' && !u.username && !u.password) return raw.replace(/\/+$/, '')
  } catch {
    /* no es una URL */
  }
  return null
}

/**
 * App empaquetada: SIEMPRE la API de GitHub y `RELEASES_REPO`; las variables de entorno se ignoran
 * (patrón de `ONYXCODE_TEST_BUNDLED_DIR`). Sin empaquetar: solo con las variables de test
 * `ONYXCODE_TEST_RELEASES_API` (+ `_REPO`, `ONYXCODE_TEST_UPDATE_DELAY_MS`); si no, apagado.
 */
export function resolveUpdateConfig(i: ResolveInput): UpdateConfig {
  if (i.isPackaged) {
    return { configured: isValidRepo(i.repo), repo: i.repo, apiBase: GITHUB_API_BASE, startDelayMs: PACKAGED_DELAY_MS }
  }
  const api = testApiBase(i.env.ONYXCODE_TEST_RELEASES_API)
  if (!api) return { configured: false, repo: i.repo, apiBase: GITHUB_API_BASE, startDelayMs: PACKAGED_DELAY_MS }
  const repo = i.env.ONYXCODE_TEST_RELEASES_REPO ?? i.repo
  const d = Number(i.env.ONYXCODE_TEST_UPDATE_DELAY_MS)
  const startDelayMs = Number.isFinite(d) && d >= 0 && d <= 60_000 ? d : DEFAULT_TEST_DELAY_MS
  return { configured: isValidRepo(repo), repo, apiBase: api, startDelayMs }
}
