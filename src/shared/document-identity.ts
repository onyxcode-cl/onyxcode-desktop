import type { DocumentIdentity, DocxSpec, PptxFont, PptxPalette, PptxSpec } from './chat-doc-spec'

export interface ResolvedDocumentIdentity extends Required<Omit<DocumentIdentity, 'palette' | 'fonts'>> {
  palette: Required<PptxPalette>
  fonts: { title: PptxFont; body: PptxFont }
  seed: number
}

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
const legacy: Record<string, PptxPalette> = {
  blue: { bg: '#F6F9FE', text: '#0F172A', accent: '#2563EB', panel: '#FFFFFF', muted: '#5B6B84', accent2: '#1D4ED8', edge: '#D9E2F1' },
  green: { bg: '#F4FAF6', text: '#10281C', accent: '#15803D', panel: '#FFFFFF', muted: '#5A7566', accent2: '#166534', edge: '#D3E6DA' },
  warm: { bg: '#FFF8F0', text: '#3B2417', accent: '#D9480F', panel: '#FFFFFF', muted: '#8A6A55', accent2: '#B93A0A', edge: '#F0DDCB' },
  mono: { bg: '#FFFFFF', text: '#111111', accent: '#1D4E89', panel: '#F5F5F5', muted: '#6B7280', accent2: '#374151', edge: '#E2E2E2' },
  dark: { bg: '#07070C', text: '#F5F5FA', accent: '#8B5CF6', panel: '#12121B', muted: '#A1A1B5', accent2: '#C4B5FD', edge: '#25253A' }
}

export function resolveDocumentIdentity(spec: PptxSpec | DocxSpec): ResolvedDocumentIdentity {
  const requested = spec.identity ?? {}
  const pptx = 'slides' in spec ? spec : undefined
  // La portada/concepto ancla la identidad: corregir el cuerpo o una cifra no cambia el diseño.
  const title = pptx ? pptx.slides[0]?.title : (spec as DocxSpec).title
  const content = pptx
    ? pptx.slides
        .map((s) =>
          [
            s.title,
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
    !title?.trim() || /^(informe|presentacion|resumen|propuesta|reporte|documento|report|presentation|summary)$/.test(normalized(title))
  const concept = requested.concept ?? (genericTitle ? normalized(content).slice(0, 500) : title!)
  const key = normalized(concept)
  const seed = hash(key)
  // El contenido orienta el matiz; la huella conserva variedad dentro de cada ámbito.
  const anchor = /marin|oceano|museo|conservacion/.test(key)
    ? 176
    : /cafe|cocina|alimento/.test(key)
      ? 28
      : /financ|comite|formal|contrato/.test(key)
        ? 224
        : /seguridad|laboral|prevencion/.test(key)
          ? 40
          : /cultur|festival|campana/.test(key)
            ? 322
            : seed % 360
  const hue = (anchor + (seed % 43) - 21 + 360) % 360
  const sober = /formal|comite|financ|tecnic|cientific|investigacion/.test(key)
  const base: PptxPalette = {
    bg: hueColor(hue, 0.2, 0.97),
    text: hueColor(hue, 0.25, 0.12),
    accent: hueColor(hue, sober ? 0.48 : 0.65, 0.3)
  }
  const p = requested.palette ?? pptx?.palette ?? (pptx?.theme ? legacy[pptx.theme] : undefined) ?? base
  const bg = p.bg.toUpperCase()
  const text = accessibleIdentityColor(p.text, bg)
  // Si una tarjeta pedida invierte el contraste, acercarla al fondo conserva texto legible en ambos.
  let panel = p.panel ?? identityMix(bg, text, 0.04)
  if (identityContrast(text, panel) < 4.5) panel = bg
  const both = (color: string): string => {
    const onBg = accessibleIdentityColor(color, bg)
    return identityContrast(onBg, panel) >= 4.5 ? onBg : text
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
  const fontPairs: Array<{ title: PptxFont; body: PptxFont }> = [
    { title: 'Georgia', body: 'Arial' },
    { title: 'Arial', body: 'Verdana' },
    { title: 'Trebuchet MS', body: 'Arial' },
    { title: 'Times New Roman', body: 'Arial' }
  ]
  const fonts = { ...fontPairs[seed % fontPairs.length], ...pptx?.fonts, ...requested.fonts }
  return {
    concept,
    seed,
    palette,
    fonts,
    titles: requested.titles ?? (sober ? 'plain' : (['editorial', 'plain', 'bold'] as const)[seed % 3]),
    cards: requested.cards ?? (['square', 'rounded', 'outline'] as const)[(seed >>> 2) % 3],
    background: requested.background ?? (['plain', 'panel', 'split'] as const)[(seed >>> 4) % 3],
    rhythm: requested.rhythm ?? (sober ? 'calm' : (['calm', 'balanced', 'dynamic'] as const)[(seed >>> 6) % 3]),
    photos: requested.photos ?? (['contain', 'wide', 'portrait'] as const)[(seed >>> 8) % 3],
    cover: requested.cover ?? (['left', 'center', 'band'] as const)[(seed >>> 10) % 3],
    headers: requested.headers ?? (sober ? 'plain' : 'accent')
  }
}
