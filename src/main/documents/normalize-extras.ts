import { MAX_FOOTER_CHARS, MAX_NOTE_CHARS } from '@shared/chat-doc-spec'

type Obj = Record<string, unknown>
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Tolerancia acotada: solo notas accesorias de texto. Rutas, contenido y límites siguen validándose después. */
export function normalizeDocumentExtras(tipo: string, spec: unknown): { spec: unknown; warnings: string[] } {
  const warnings: string[] = []
  if (!object(spec) || !['pptx', 'docx'].includes(tipo)) return { spec, warnings }
  const clean = (value: unknown, path: string, limits: Partial<Record<'footer' | 'note', number>> = {}): unknown => {
    if (!object(value)) return value
    const copy = { ...value }
    for (const key of ['footer', 'note'] as const) {
      const text = copy[key]
      if (typeof text !== 'string') continue
      const limit = limits[key]
      if (limit === undefined || text.length > limit) {
        delete copy[key]
        warnings.push(`Se ignoró ${path}.${key}: nota accesoria ${limit === undefined ? 'no admitida en ese lugar' : 'demasiado larga'}.`)
      }
    }
    return copy
  }
  const out = clean(spec, 'spec', { footer: tipo === 'pptx' ? MAX_FOOTER_CHARS : 200 }) as Obj
  if (tipo === 'pptx' && Array.isArray(out.slides)) {
    out.slides = out.slides.map((value, i) => {
      const path = `spec.slides[${i}]`
      const slide = clean(value, path, { note: MAX_NOTE_CHARS })
      if (!object(slide)) return slide
      for (const key of ['table', 'image']) if (slide[key] !== undefined) slide[key] = clean(slide[key], `${path}.${key}`)
      if (Array.isArray(slide.elements)) slide.elements = slide.elements.map((e, j) => clean(e, `${path}.elements[${j}]`))
      return slide
    })
  }
  if (tipo === 'docx' && Array.isArray(out.blocks)) out.blocks = out.blocks.map((b, i) => clean(b, `spec.blocks[${i}]`))
  return { spec: out, warnings }
}
