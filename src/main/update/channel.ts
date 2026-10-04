/**
 * Canal beta del aviso de versión (F8-B70, apagado por defecto: nada en la interfaz lo activa todavía).
 *
 * Estable: `GET /releases/latest` (GitHub nunca devuelve borradores ni prereleases) con `isNewerRelease`, como siempre.
 * Beta: `GET /releases?per_page=10`, se descartan los borradores y se elige la semver MAYOR entre estables y prereleases,
 * siempre que sea mayor que la instalada. Comparación semver: `0.4.0-beta.1` < `0.4.0` < `0.4.1-beta.1`.
 *
 * LÍMITE CONOCIDO: el instalador (`validateManifest` en src/shared/update-install.ts) sigue exigiendo una versión estable
 * (`isNewerRelease` con `prerelease: false` rechaza `0.4.0-beta.1` si la instalada es estable). Mientras no se amplíe allí,
 * una beta solo puede ofrecerse como aviso con «Descargar», no con «Actualizar».
 */
import { compareSemver, parseReleaseJson, parseSemver, type Semver } from '@shared/update-check'

export type UpdateChannel = 'stable' | 'beta'

export const BETA_LIST_SIZE = 10

export function releasesListUrl(repo: string, base = 'https://api.github.com'): string {
  return `${base.replace(/\/+$/, '')}/repos/${repo}/releases?per_page=${BETA_LIST_SIZE}`
}

export interface PickedRelease {
  tag: string
  url: string | null
  prerelease: boolean
  semver: Semver
}

/** Elige la release más nueva del canal beta a partir del JSON de `/releases`; null si no hay ninguna mayor que `current`. */
export function pickBetaRelease(raw: unknown, current: string): PickedRelease | null {
  if (!Array.isArray(raw)) return null
  const cur = parseSemver(current)
  if (!cur) return null
  let best: PickedRelease | null = null
  for (const item of raw.slice(0, BETA_LIST_SIZE)) {
    const rel = parseReleaseJson(item)
    if (!rel || rel.draft) continue
    const sv = parseSemver(rel.tag)
    if (!sv) continue
    if (compareSemver(sv, cur) <= 0) continue
    if (!best || compareSemver(sv, best.semver) > 0)
      best = { tag: rel.tag, url: rel.url, prerelease: rel.prerelease || sv.pre !== null, semver: sv }
  }
  return best
}
