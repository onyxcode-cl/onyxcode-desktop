import type { DocumentIdentity, DocxSpec, PptxFont, PptxPalette, PptxSpec } from './chat-doc-spec'

export interface ResolvedDocumentIdentity extends Required<Omit<DocumentIdentity, 'palette' | 'fonts'>> {
  palette: Required<PptxPalette>
  fonts: { title: PptxFont; body: PptxFont }
  seed: number
  tone: DocumentTone
}

/** Tono resuelto, no un menú obligatorio del esquema. Orienta tipografía y composición. */
export type DocumentTone = 'playful' | 'luxury' | 'technical' | 'rock' | 'institutional' | 'editorial' | 'general'

const rgb = (hex: string): number[] =>
  hex
    .replace('#', '')
    .match(/../g)!
    .map((n) => parseInt(n, 16))
const hex = (values: number[]): string =>
  '#' +
  values
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
export function identityMix(a: string, b: string, t: number): string {
  const end = rgb(b)
  return hex(rgb(a).map((v, i) => v + (end[i] - v) * t))
}
export function identityContrast(a: string, b: string): number {
  const lum = (color: string): number =>
    rgb(color)
      .map((v) => {
        const c = v / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Conserva el color solicitado si es legible; acerca su luminosidad al extremo que cumple AA. */
export function accessibleIdentityColor(foreground: string, background: string): string {
  if (identityContrast(foreground, background) >= 4.5) return foreground.toUpperCase()
  const end = identityContrast('#000000', background) > identityContrast('#FFFFFF', background) ? '#000000' : '#FFFFFF'
  for (let step = 1; step <= 20; step++) {
    const candidate = identityMix(foreground, end, step / 20)
    if (identityContrast(candidate, background) >= 4.5) return candidate
  }
  return end
}

/** No depende de reloj, plataforma, orden de claves, cifras o aleatoriedad. */
function hash(text: string): number {
  let n = 2166136261
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619)
  return n >>> 0
}
const normalized = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\d.,%]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
function hueColor(hue: number, saturation: number, light: number): string {
  const f = (n: number): number => {
    const k = (n + hue / 30) % 12
    return 255 * (light - saturation * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return hex([f(0), f(8), f(4)])
}
function toneFor(text: string): DocumentTone {
  if (/\b(infantil|infancia|ninos?|ninas?|dinosaurios?|kids|children|playful|juguetes?)\b/.test(text)) return 'playful'
  const musicalContext = /\b(musica|musical|music|canciones?|songs?|setlist|teloneros?|guitarras?|album|concert)\b/.test(text)
  if (/\b(rock|punk|concierto)\b/.test(text) || (musicalContext && /\b(metal|gira|band|tour)\b/.test(text))) return 'rock'
  if (/lujo|luxury|premium|pasteleria|patisserie|francesa|boutique|alta cocina|joyeria/.test(text)) return 'luxury'
  if (/tecnic|cientific|investigacion|ingenier|solar|fotovoltaic|minera|mineria|industrial|software|arquitect/.test(text))
    return 'technical'
  if (/instituci|clinica|dental|salud|comite|financ|formal|contrato|trimestral|corporativ/.test(text)) return 'institutional'
  if (/museo|marin|oceano|conservacion|cultur|editorial|festival|campana|turismo/.test(text)) return 'editorial'
  return 'general'
}

const themeHue: Record<NonNullable<PptxSpec['theme']>, number> = { blue: 220, green: 140, warm: 24, mono: 215, dark: 270 }
const fontPairs: Record<DocumentTone, Array<{ title: PptxFont; body: PptxFont }>> = {
  playful: [
    { title: 'Comic Sans MS', body: 'Verdana' },
    { title: 'Trebuchet MS', body: 'Comic Sans MS' }
  ],
  luxury: [
    { title: 'Georgia', body: 'Times New Roman' },
    { title: 'Times New Roman', body: 'Georgia' }
  ],
  technical: [
    { title: 'Courier New', body: 'Tahoma' },
    { title: 'Arial Black', body: 'Verdana' }
  ],
  rock: [
    { title: 'Impact', body: 'Trebuchet MS' },
    { title: 'Arial Black', body: 'Tahoma' }
  ],
  institutional: [
    { title: 'Tahoma', body: 'Verdana' },
    { title: 'Verdana', body: 'Arial' }
  ],
  editorial: [
    { title: 'Georgia', body: 'Trebuchet MS' },
    { title: 'Times New Roman', body: 'Verdana' }
  ],
  general: [
    { title: 'Georgia', body: 'Verdana' },
    { title: 'Trebuchet MS', body: 'Tahoma' },
    { title: 'Arial Black', body: 'Arial' }
  ]
}

export function resolveDocumentIdentity(spec: PptxSpec | DocxSpec): ResolvedDocumentIdentity {
  const requested = spec.identity ?? {}
  const pptx = 'slides' in spec ? spec : undefined
  // La portada/concepto ancla la identidad: corregir el cuerpo o una cifra no cambia el diseño.
  const cover = pptx?.slides[0]
  const freeTitle = cover?.elements?.filter((element) => element.type === 'text').sort((a, b) => (b.size ?? 24) - (a.size ?? 24))[0]?.text
  const title = pptx ? (cover?.title ?? freeTitle) : (spec as DocxSpec).title
  const content = pptx
    ? pptx.slides
        .map((s) =>
          [
            s.title,
            'subtitle' in s && typeof s.subtitle === 'string' ? s.subtitle : undefined,
            ...(s.elements ?? []).flatMap((element) => (element.type === 'text' ? [element.text] : [])),
            ...(s.bullets ?? []),
            ...(s.columns ?? []).flatMap((c) => [c.heading, ...c.bullets]),
            ...(s.kpis ?? []).map((k) => k.label),
            ...(s.chart?.categories ?? []),
            ...(s.table?.columns ?? [])
          ]
            .flat()
            .join(' ')
        )
        .join(' ')
    : (spec as DocxSpec).blocks
        .map((b) => ('text' in b ? b.text : 'items' in b ? b.items.flat().join(' ') : 'columns' in b ? b.columns.join(' ') : b.type))
        .join(' ')
  const genericTitle =
    !title?.trim() ||
    /^(informe|presentacion|resumen|propuesta|reporte|documento|report|presentation|summary|portada)( (trimestral|anual|mensual|ejecutivo|quarterly|annual|monthly))?$/.test(
      normalized(title)
    )
  const concept = requested.concept ?? (genericTitle ? normalized(content).slice(0, 500) : title!)
  const key = normalized(concept)
  const seed = hash(key)
  // Una marca/concepto explícitos anclan también el tono; sin ellos, el cuerpo aporta el contexto
  // que no cabe en títulos como «Ruta nocturna» o «Bienvenidos». Corregir cifras no cambia la huella.
  const context = requested.concept ? key : normalized(`${concept} ${content}`)
  const tone = toneFor(context)
  // El tema nombrado es una inspiración cromática. La materia y el tono conservan una identidad
  // propia incluso si dos documentos llegan con el mismo «warm» o «green» del modelo.
  const anchor = /solar|fotovoltaic/.test(context)
    ? 42
    : /pasteleria|patisserie|francesa/.test(context)
      ? 338
      : /dinosaur|infantil|ninos/.test(context)
        ? 112
        : /clinica|dental|salud/.test(context)
          ? 184
          : /marin|oceano|museo|conservacion/.test(context)
            ? 176
            : /cafe|cocina|alimento/.test(context)
              ? 28
              : /financ|comite|formal|contrato/.test(context)
                ? 224
                : /seguridad|laboral|prevencion|minera|mineria/.test(context)
                  ? 40
                  : /cultur|festival|campana/.test(context)
                    ? 322
                    : seed % 360
  const startingHue = pptx?.theme ? themeHue[pptx.theme] : anchor
  const distance = ((anchor - startingHue + 540) % 360) - 180
  const hue = (startingHue + distance * 0.72 + (seed % 43) - 21 + 360) % 360
  const sober = tone === 'institutional' || tone === 'technical'
  const dark = pptx?.theme === 'dark' || tone === 'rock'
  const neutral = pptx?.theme === 'mono'
  const saturation = neutral ? 0.13 : (sober ? 0.43 : 0.61) + ((seed >>> 8) % 14) / 100
  const bgLight = dark ? 0.065 + ((seed >>> 12) % 4) / 100 : 0.94 + ((seed >>> 12) % 4) / 100
  const base: PptxPalette = {
    bg: hueColor(hue, neutral ? 0.025 : tone === 'luxury' ? 0.32 : 0.2, bgLight),
    text: hueColor(hue, neutral ? 0.02 : 0.25, dark ? 0.96 : 0.12),
    accent: hueColor(hue, saturation, dark ? 0.68 : 0.29 + ((seed >>> 16) % 7) / 100),
    accent2: hueColor((hue + (tone === 'playful' ? 72 : 32)) % 360, saturation * 0.8, dark ? 0.76 : 0.3)
  }
  const p = requested.palette ?? pptx?.palette ?? base
  const bg = p.bg.toUpperCase()
  const text = accessibleIdentityColor(p.text, bg)
  // Si una tarjeta pedida invierte el contraste, acercarla al fondo conserva texto legible en ambos.
  let panel = p.panel ?? identityMix(bg, text, 0.04)
  if (identityContrast(text, panel) < 4.5) panel = bg
  const both = (color: string): string => {
    const onBg = accessibleIdentityColor(color, bg)
    if (identityContrast(onBg, panel) >= 4.5) return onBg
    // Aumentar contraste solo lo necesario conserva el matiz; no sustituir todo acento por tinta.
    for (let step = 1; step <= 20; step++) {
      const candidate = identityMix(onBg, text, step / 20)
      if (identityContrast(candidate, bg) >= 4.5 && identityContrast(candidate, panel) >= 4.5) return candidate
    }
    return text
  }
  const palette: Required<PptxPalette> = {
    bg,
    text,
    panel,
    accent: both(p.accent),
    accent2: both(p.accent2 ?? identityMix(p.accent, text, 0.2)),
    muted: both(p.muted ?? identityMix(text, bg, 0.35)),
    edge: p.edge ?? identityMix(bg, text, 0.2)
  }
  const pairs = fontPairs[tone]
  const fonts = { ...pairs[seed % pairs.length], ...pptx?.fonts, ...requested.fonts }
  return {
    concept,
    seed,
    tone,
    palette,
    fonts,
    titles: requested.titles ?? (sober ? 'plain' : (['editorial', 'plain', 'bold'] as const)[seed % 3]),
    cards:
      requested.cards ??
      (tone === 'playful'
        ? 'rounded'
        : tone === 'luxury'
          ? 'outline'
          : tone === 'technical'
            ? 'square'
            : (['square', 'rounded', 'outline'] as const)[(seed >>> 2) % 3]),
    background: requested.background ?? (tone === 'luxury' ? 'plain' : (['plain', 'panel', 'split'] as const)[(seed >>> 4) % 3]),
    rhythm:
      requested.rhythm ??
      (sober || tone === 'luxury'
        ? 'calm'
        : tone === 'rock' || tone === 'playful'
          ? 'dynamic'
          : (['calm', 'balanced', 'dynamic'] as const)[(seed >>> 6) % 3]),
    photos: requested.photos ?? (['contain', 'wide', 'portrait'] as const)[(seed >>> 8) % 3],
    cover: requested.cover ?? (['left', 'center', 'band'] as const)[(seed >>> 10) % 3],
    headers: requested.headers ?? (sober ? 'plain' : 'accent')
  }
}
