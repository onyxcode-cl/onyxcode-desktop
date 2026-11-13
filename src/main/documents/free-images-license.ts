/** Commons metadata is untrusted data. This module never evaluates markup or follows metadata links. */
export interface FreeImageLicense {
  name: string
  url: string
  shareAlike: boolean
  notices: string
}
type Metadata = Record<string, { value?: unknown } | undefined>
// Closed initial set of Commons template families. Unknown PD labels are not evidence.
const PUBLIC_DOMAIN_BASES = new Set(['pd-old', 'pd-old-70', 'pd-old-100', 'pd-self', 'pd-user', 'pd-author', 'pd-usgov'])

export function plainMetadata(value: unknown, max = 1500): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[m]!
    )
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
      const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)
      return cp > 31 && cp < 0x10ffff ? String.fromCodePoint(cp) : ' '
    })
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Fail closed on conflicting license fields; permissive-looking names alone never suffice. */
export function commonsLicense(raw: unknown): FreeImageLicense | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const m = raw as Metadata
  const get = (key: string): string => plainMetadata(m[key]?.value, 6001)
  if (Object.values(m).some((v) => typeof v?.value === 'string' && v.value.length > 20000)) return null
  const name = get('LicenseShortName')
  const code = get('License').toLowerCase()
  const urlText = get('LicenseUrl')
  const terms = get('UsageTerms')
  const permission = get('Permission')
  const restrictions = get('Restrictions')
  const notices = [get('Attribution'), get('Credit'), permission, restrictions].filter(Boolean).join(' · ')
  // Do not truncate obligations to make a candidate fit; reject unusually long conditions.
  if (notices.length > 1800) return null
  const all = [name, code, terms, permission, restrictions, urlText, notices].join(' ')
  if (
    /\b(?:nc|nd|non[ -]?commercial|no[ -]?derivatives?|fair[ -]?use|all rights reserved|copyright uncertain|permission required)\b/i.test(
      all
    )
  )
    return null
  let url: URL
  try {
    url = new URL(urlText.startsWith('//') ? `https:${urlText}` : urlText)
  } catch {
    return null
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.hostname !== 'creativecommons.org' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    return null
  const path = url.pathname.replace(/\/$/, '')
  const cc = /^CC BY(-SA)? (1\.0|2\.0|2\.5|3\.0|4\.0)$/i.exec(name)
  if (cc) {
    const kind = cc[1] ? 'by-sa' : 'by'
    if (path !== `/licenses/${kind}/${cc[2]}` || code !== `cc-${kind}-${cc[2]}`) return null
    if (get('Copyrighted').toLowerCase() === 'false' || get('AttributionRequired').toLowerCase() === 'false') return null
    // If a usage label is present it must describe the same license family.
    if (terms && (!/attribution/i.test(terms) || /share[ -]?alike/i.test(terms) !== !!cc[1])) return null
    if ((terms.match(/\b[1-4]\.\d\b/g) ?? []).some((version) => version !== cc[2])) return null
    return { name: `CC BY${cc[1] ? '-SA' : ''} ${cc[2]}`, url: `https://creativecommons.org${path}/`, shareAlike: !!cc[1], notices }
  }
  const domainTermsConsistent =
    !terms ||
    (/\b(?:public[ -]domain|CC0|creative commons zero)\b/i.test(terms) && !/\b(?:attribution|share[ -]?alike|CC[ -]?BY)\b/i.test(terms))
  if (
    domainTermsConsistent &&
    /^CC0(?: 1\.0)?$/i.test(name) &&
    code === 'cc-zero' &&
    path === '/publicdomain/zero/1.0' &&
    get('Copyrighted').toLowerCase() !== 'true' &&
    get('AttributionRequired').toLowerCase() !== 'true'
  )
    return { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', shareAlike: false, notices }
  // Public-domain marker + template basis + non-copyrighted flag, not a generic site-wide assertion.
  if (
    domainTermsConsistent &&
    (!terms || /\bpublic[ -]domain\b/i.test(terms)) &&
    /^public domain$/i.test(name) &&
    PUBLIC_DOMAIN_BASES.has(code) &&
    get('Copyrighted').toLowerCase() === 'false' &&
    get('AttributionRequired').toLowerCase() !== 'true' &&
    path === '/publicdomain/mark/1.0'
  )
    return { name: `Dominio público (${code})`, url: 'https://creativecommons.org/publicdomain/mark/1.0/', shareAlike: false, notices }
  return null
}
