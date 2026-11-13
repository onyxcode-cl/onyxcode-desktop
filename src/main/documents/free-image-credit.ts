/** Display-only attribution. The verified license and original metadata stay in provenance. */
import { plainMetadata } from './free-images-license'

export const MAX_IMAGE_CREDIT_CHARS = 120

export function cleanImageAuthor(raw: string): string {
  return plainMetadata(raw, 20000)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\s+(?:for a gallery\b|for more (?:of my )?(?:photos|pictures)\b|you (?:may|can) (?:see|find)\b)[\s\S]*$/i, '')
    .replace(/\s*[·|]\s*(?:gallery|galería|flickr|own work)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·|,;:.–—-]+|[\s·|,;:.–—-]+$/g, '')
    .trim()
}

/** Never derives a license from free text: license/provider must come from verified fields. */
export function shortImageCredit(attribution: {
  author: string
  license: string
  provider: string
  transformations?: readonly string[]
}): string {
  const suffix = ` · ${attribution.license} · ${attribution.provider}${attribution.transformations?.length ? ' · ajustada' : ''}`
  const available = MAX_IMAGE_CREDIT_CHARS - 'Foto: '.length - suffix.length
  const author = cleanImageAuthor(attribution.author) || 'Autor indicado en la fuente'
  const shortened = author.length > available ? `${author.slice(0, Math.max(1, available - 1)).trimEnd()}…` : author
  return `Foto: ${shortened}${suffix}`
}
