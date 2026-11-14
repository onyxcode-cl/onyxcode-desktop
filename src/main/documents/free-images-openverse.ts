import { commonsLicense, plainMetadata, type FreeImageLicense } from './free-images-license'
import { hasImageOverlay } from './free-images-search'

export const OPENVERSE_API = 'https://api.openverse.org/v1/images/'
export interface OpenverseReference {
  title: string
  url: string
  license: FreeImageLicense
  id: string
}

/** Openverse is a discovery index, never evidence of an upstream license by itself.
 * Only Commons origins currently have a keyless verifier with exact version/hash binding.
 * An unimplemented origin is rejected, even if Openverse calls it freely licensed. */
export function parseOpenverseReferences(raw: unknown): OpenverseReference[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { results?: unknown }).results)) return []
  const results: OpenverseReference[] = []
  for (const entry of (raw as { results: unknown[] }).results.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (
      e.source !== 'wikimedia' ||
      e.provider !== 'wikimedia' ||
      e.mature === true ||
      typeof e.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.id) ||
      typeof e.foreign_landing_url !== 'string' ||
      typeof e.url !== 'string'
    )
      continue
    let landing: URL
    try {
      landing = new URL(e.foreign_landing_url)
    } catch {
      continue
    }
    if (
      landing.protocol !== 'https:' ||
      landing.hostname !== 'commons.wikimedia.org' ||
      landing.port ||
      landing.username ||
      landing.password ||
      landing.search ||
      landing.hash ||
      !landing.pathname.startsWith('/wiki/File:')
    )
      continue
    let title: string
    try {
      title = decodeURIComponent(landing.pathname.slice('/wiki/'.length)).replace(/_/g, ' ')
    } catch {
      continue
    }
    if (title.length > 500 || /[|\u0000-\u001f]/.test(title) || hasImageOverlay(title, {})) continue
    const code = plainMetadata(e.license),
      version = plainMetadata(e.license_version)
    const name = code === 'cc0' ? 'CC0 1.0' : code === 'by' || code === 'by-sa' ? `CC ${code.toUpperCase()} ${version}` : ''
    // A generic PDM marker cannot establish the public-domain basis; Commons will decide that separately.
    const license =
      code === 'pdm' && version === '1.0' && e.license_url === 'https://creativecommons.org/publicdomain/mark/1.0/'
        ? { name: 'Dominio público', url: e.license_url, shareAlike: false, notices: '' }
        : commonsLicense({
            LicenseShortName: { value: name },
            License: { value: code === 'cc0' ? 'cc-zero' : `cc-${code}-${version}` },
            LicenseUrl: { value: e.license_url }
          })
    if (!license) continue
    results.push({ title, url: e.url, license, id: e.id })
  }
  return results
}
