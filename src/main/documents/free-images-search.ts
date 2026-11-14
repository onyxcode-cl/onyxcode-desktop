import { plainMetadata } from './free-images-license'
import type { FreeImageRequirements } from './free-images'

export type FreeImageOrientation = 'landscape' | 'portrait' | 'square' | 'any'
export type FreeImageOrientationInput = FreeImageOrientation | 'horizontal' | 'vertical' | 'cuadrada' | 'cualquiera'

export function normalizeOrientation(value: unknown): FreeImageOrientation | undefined {
  if (value === undefined) return undefined
  const aliases: Record<string, FreeImageOrientation> = {
    landscape: 'landscape',
    horizontal: 'landscape',
    portrait: 'portrait',
    vertical: 'portrait',
    square: 'square',
    cuadrada: 'square',
    any: 'any',
    cualquiera: 'any'
  }
  return typeof value === 'string' && Object.hasOwn(aliases, value) ? aliases[value] : undefined
}

/** Explicit evidence of an overlay, not a copyright notice attached to otherwise usable pixels. */
export function hasImageOverlay(title: unknown, metadata: unknown): boolean {
  const m = metadata && typeof metadata === 'object' ? (metadata as Record<string, { value?: unknown }>) : {}
  const text = [title, m.ObjectName?.value, m.ImageDescription?.value, m.Categories?.value, m.Assessments?.value]
    .map((value) => plainMetadata(value, 20000))
    .join(' ')
  return (
    /\b(?:watermark(?:ed|s)?|watermarked images|marca(?:s)? de agua|text overlay|overlaid text|texto superpuesto)\b/i.test(text) ||
    /(?:copyright|©)/i.test([title, m.ObjectName?.value].map((v) => plainMetadata(v)).join(' ')) ||
    /\b(?:watermark|watermarked)\b/i.test(plainMetadata(m.Watermark?.value)) ||
    /^(?:true|yes|1)$/i.test(plainMetadata(m.Watermark?.value))
  )
}

/** Small deterministic expansion, bounded and inspectable; it never rewrites identity or mandatory constraints. */
export function fallbackImageQueries(r: FreeImageRequirements, originals: readonly string[]): string[] {
  const subject = r.subject.normalize('NFKC')
  const concepts: Array<[RegExp, string, string]> = [
    [/cafeter[ií]a|coffee shop|caf[eé]/i, 'coffee shop interior', 'cafe interior'],
    [/colibr[ií]|hummingbird/i, 'hummingbird', 'hummingbird flowers'],
    [/ping[uü]ino.*Humboldt|Humboldt.*penguin/i, 'Humboldt penguin', 'Spheniscus humboldti'],
    [/f[oó]sil.*dinosaurio|dinosaur.*fossil/i, 'dinosaur fossil museum', 'dinosaur skeleton museum'],
    [/mercado.*fruta|fruit market/i, 'fruit market', 'fruit market stalls'],
    [/sala de clases|aula|classroom/i, 'classroom', 'school classroom interior'],
    [/puerto.*Valpara[ií]so|Valpara[ií]so.*(?:port|harbou?r)/i, 'Valparaíso port', 'Valparaíso harbour']
  ]
  const match = concepts.find(([pattern]) => pattern.test(subject))
  // Mandatory terms survive both variants, including geographical qualifiers and proper names.
  const constraints = [...new Set([r.action, r.place, ...r.required].filter((v): v is string => !!v?.trim()))]
  // Preserve a named place even when the caller put it only in subject.
  const namedPlace = /\b(?:en|in)\s+([A-ZÁÉÍÓÚÑ][\p{L}]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}]+)*)/u.exec(subject)?.[1]
  if (namedPlace && !constraints.includes(namedPlace)) constraints.push(namedPlace)
  const seen = new Set(originals.map((q) => q.trim().toLocaleLowerCase()))
  return (match ? [match[1], match[2]] : [subject])
    .map((q) => [q, ...constraints.filter((c) => !q.toLowerCase().includes(c.toLowerCase()))].join(' '))
    .filter((q) => {
      const key = q.toLocaleLowerCase()
      if (q.length > 200 || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const topics: Array<[RegExp, RegExp]> = [
  [/cafeteria|coffee shop|cafe/i, /\b(?:caf[eéè]s?|cafeteria|coffee|coffeeshop)\b/i],
  [/colibri|hummingbird/i, /hummingbird|colibri|picaflor|trochil/i],
  [/pinguino|penguin/i, /penguin|pinguin|spheniscus/i],
  [/fosil.*dinosaurio|dinosaur.*fossil/i, /dinosaur|fossil|fosil|skeleton|esqueleto|saur|ceratops/i],
  [/mercado.*fruta|fruit market/i, /fruit|fruta|produce|vegetable|verdura/i],
  [/sala de clases|aula|classroom/i, /classroom|school|sala de clases|escuela|aula|pupils|students/i],
  [/puerto.*valparaiso|valparaiso.*(?:port|harbou?r)/i, /valparaiso/i]
]

/** Rank the combined pools, not six arbitrary page ids or just the first query.
 * Explicit places require metadata evidence; this is still not a visual certification. */
export function rankImageCandidates<T extends { title: string; description: string; categories?: string }>(
  files: readonly T[],
  r: FreeImageRequirements
): T[] {
  const topic = topics.find(([pattern]) => pattern.test(fold(r.subject)))?.[1]
  const terms = [r.subject, r.action ?? '', r.place ?? '', ...r.required].map(fold).filter(Boolean)
  return files
    .map((file, index) => {
      const title = fold(file.title),
        text = `${title} ${fold(file.description)} ${fold(file.categories ?? '')}`
      const evidence = text.replace(
        /reserva(?: nacional)? pinguino de humboldt|(?:humboldt penguin|pinguino de humboldt) (?:national|nature) reserve/g,
        ''
      )
      let score = topic?.test(title) ? 30 : topic?.test(text) ? 10 : 0
      for (const term of terms) {
        if (title.includes(term)) score += 15
        else if (text.includes(term)) score += 5
      }
      const requested = terms.join(' ')
      for (const concepts of [/vuelo|volando|flight|flying/, /flores|flowers|blossoms/, /frutas|fruits|produce/]) {
        if (concepts.test(requested) && concepts.test(text)) score += 20
      }
      if (/mercado.*fruta|fruit market/.test(fold(r.subject)) && /market stalls|fruit shops|puestos de fruta/.test(text)) score += 25
      if (/cafeteria|coffee shop|cafe/.test(fold(r.subject)) && /interior|inside|seating|tables|mesas/.test(text)) score += 20
      if (/barrio|neighbo[u]?rhood/.test(fold(r.subject))) {
        if (/barrio|neighbo[u]?rhood/.test(text)) score += 25
        if (/starbucks|costa coffee|dunkin|mcdonald/.test(text)) score -= 50
      }
      const humboldt =
        /spheniscus humboldti/.test(fold(r.subject)) || (/humboldt/.test(fold(r.subject)) && /pinguino|penguin/.test(fold(r.subject)))
      const speciesMatches = !humboldt || /spheniscus humboldti|humboldt(?:'s)? penguins?|pinguinos? de humboldt/.test(evidence)
      const placeMatches = !r.place || text.includes(fold(r.place))
      const misleadingMoth =
        /colibri|hummingbird/.test(fold(r.subject)) && /hummingbird (?:hawk[ -]?)?moth|macroglossum|esfinge colibri/.test(text)
      const unsuitableComposite =
        r.realPhoto && /stereoscopic|side.by.side|anaglyph|3d render|computer.generated/.test(`${title} ${fold(file.categories ?? '')}`)
      return {
        file,
        index,
        score,
        relevant:
          speciesMatches &&
          placeMatches &&
          !misleadingMoth &&
          !unsuitableComposite &&
          (!topic || topic.test(evidence)) &&
          !r.excluded.some((term) => text.includes(fold(term)))
      }
    })
    .filter((entry) => entry.relevant)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.file)
}

export function matchesOrientation(width: number, height: number, orientation?: FreeImageOrientationInput): boolean {
  const value = normalizeOrientation(orientation)
  return value === 'landscape' ? width > height : value === 'portrait' ? height > width : value === 'square' ? width === height : true
}
