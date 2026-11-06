/**
 * Traducir un PDF SIN cambiar su diseño (F8-B200). Lógica pura compartida entre main (extrae y aplica con PyMuPDF) y el renderer
 * (pide la traducción al modelo en tandas). Nada de aquí toca disco ni red.
 *
 * Flujo: `translate:pdfExtract` → lista de textos con su posición → el renderer los traduce por lotes con el modelo elegido
 * (con glosario compartido entre lotes) → `translate:pdfApply` los escribe sobre el MISMO PDF → abrir / guardar.
 */

/** Tope del PDF de entrada (el renderer ya lo leyó entero en memoria como base64). */
export const TRANSLATE_PDF_MAX_BYTES = 20 * 1024 * 1024
/** Tope de textos por PDF: protege al modelo y al bolsillo de quien usa un modelo de pago. */
export const TRANSLATE_PDF_MAX_SEGMENTS = 3000
/** Tope de caracteres totales a traducir por PDF. */
export const TRANSLATE_PDF_MAX_CHARS = 400_000

/** Idiomas de destino: los que se escriben con letras latinas (fuentes Arial/Times/Courier incluidas en el sistema). */
export const TRANSLATE_LANGS = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' }
] as const
export type TranslateLangCode = (typeof TRANSLATE_LANGS)[number]['code']

export interface PdfSegment {
  /** `p<página>-<n>`: el mismo que usa `translate_pdf.py aplicar`. */
  id: string
  pagina: number
  /** Texto original (puede llevar las etiquetas `<b>`, `<c=#rrggbb>`, `<l=N>`). */
  texto: string
  negrita?: boolean
  /** Id del texto de la página siguiente donde continúa esta frase (cortada por el cambio de hoja). */
  sigue?: string
  /** Partes resaltadas del texto, o `'todo'`. */
  resaltado?: string[] | 'todo'
}

export type PdfFailReason =
  'tooBig' | 'unreadable' | 'encrypted' | 'scanned' | 'tooLong' | 'noPython' | 'unsupported' | 'timeout' | 'failed'

/** Qué se traduce: un PDF (PyMuPDF) o un Word (python-docx). El resto del flujo es el mismo. */
export type TranslateKind = 'pdf' | 'docx'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type PdfExtractRequest = { name: string; base64: string; kind?: TranslateKind }
/** Cómo es cada página según el script: texto de verdad, foto con texto OCR invisible, o solo imagen. */
export type PdfPageClass = 'digital' | 'escaneada_ocr' | 'escaneada_sin_texto'
export type PdfExtractResult =
  | { ok: true; jobId: string; pages: number; segments: PdfSegment[]; pagesWithoutText: number[]; pageClasses?: Record<number, PdfPageClass> }
  | { ok: false; reason: PdfFailReason }

/** Una página dibujada como imagen para que el modelo la vea (solo hojas escaneadas). */
export type PdfPageImageRequest = { jobId: string; page: number }
export type PdfPageImageResult = { ok: true; mime: 'image/png'; base64: string } | { ok: false }
/** Tope de bytes de una imagen de página que se manda al renderer. */
export const TRANSLATE_PAGE_IMAGE_MAX_BYTES = 4 * 1024 * 1024

export type PdfApplyRequest = { jobId: string; translations: Record<string, string>; target: TranslateLangCode }
export interface PdfApplyReport {
  translated: number
  untranslated: number
  /** Textos cuya letra se redujo para caber. */
  shrunk: number
  /** Textos que no caben ni con la letra mínima: hay que revisar esas páginas. */
  overflow: string[]
  /** Enlaces que no se pudieron conservar. */
  linksDropped: number
  /** Word: textos cuya traducción perdió parte del formato (negrita, color…). */
  formatLost?: number
}
export type PdfApplyResult = { ok: true; report: PdfApplyReport; outName: string } | { ok: false; reason: PdfFailReason }

export const PDF_JOB_ID_RE = /^[a-f0-9]{16}$/

/** Agrupa los textos en lotes por orden de lectura: ≤ `maxItems` textos y ≤ `maxChars` caracteres (un texto largo va solo). */
export function batchSegments(segments: PdfSegment[], maxChars = 3500, maxItems = 40): PdfSegment[][] {
  const out: PdfSegment[][] = []
  let cur: PdfSegment[] = []
  let chars = 0
  for (const s of segments) {
    const len = s.texto.length
    if (cur.length > 0 && (cur.length >= maxItems || chars + len > maxChars)) {
      out.push(cur)
      cur = []
      chars = 0
    }
    cur.push(s)
    chars += len
  }
  if (cur.length > 0) out.push(cur)
  return out
}

export type Glossary = Record<string, string>

/** Los términos del glosario que más pesan en el prompt: hasta `max`, los más recientes. */
export function trimGlossary(g: Glossary, max = 60): Glossary {
  const entries = Object.entries(g)
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - max)))
}

/** Instrucción para el modelo (en inglés: la entienden todos). El lote va como JSON `{id: texto}`. */
export function buildTranslatePrompt(opts: {
  target: TranslateLangCode
  batch: PdfSegment[]
  glossary: Glossary
  docName: string
  kind?: TranslateKind
  /** Último texto original del lote anterior: solo contexto, no se traduce. */
  before?: string
  /** Textos de otros lotes donde continúan frases de este (id → texto), solo contexto. */
  continuations?: Record<string, { id: string; texto: string }>
  /** Ficha del documento (de qué trata y en qué tono), la misma en todos los lotes. */
  docCard?: DocCard
  /** Va adjunta la imagen de la página de la que salen estos textos (hoja escaneada leída por OCR). */
  pageImage?: boolean
  /** Solo se manda al modelo lo del glosario que aparece en este lote (más lo de la ficha), no «los más recientes». */
  relevantGlossary?: boolean
}): string {
  const lang = TRANSLATE_LANGS.find((l) => l.code === opts.target)?.name ?? opts.target
  const items: Record<string, string> = {}
  for (const s of opts.batch) items[s.id] = s.texto
  // Solo los resaltados parciales: si todo el texto está resaltado, `translate_pdf.py` ya lo marca entero.
  const marks = opts.batch.filter((s): s is PdfSegment & { resaltado: string[] } => Array.isArray(s.resaltado) && s.resaltado.length > 0)
  const gl = opts.relevantGlossary
    ? glossaryFor(opts.batch.map((x) => x.texto).join('\n'), opts.glossary, opts.docCard?.glossary)
    : trimGlossary(opts.glossary)
  return [
    `You are a professional translator. Translate every text below into ${lang}. The texts come from the ${opts.kind === 'docx' ? 'Word document' : 'PDF'} "${opts.docName}"; each one sits in a fixed place of the page, so keep each translation about as long as the original.`,
    '',
    'Rules:',
    '- Translate ALL human-readable text, even short labels and headings. Keep numbers, dates, amounts, references and codes exactly.',
    '- Do NOT translate code, commands, file names, paths, URLs, e-mail addresses or configuration keys. Proper names of people and companies stay as they are.',
    `- Keep the tags exactly where they belong around the equivalent translated words: <b>…</b> (bold), ${opts.kind === 'docx' ? '<i>…</i> (italic), <u>…</u> (underline), ' : ''}<c=#rrggbb>…</c> (color), <l=N>…</l> (link) and [[…]] (highlight).`,
    marks.length
      ? '- Some texts have highlighted parts. For each id below, wrap in [[ ]] the words of YOUR translation that correspond to the highlighted part of the original (and only those):\n' +
        marks.map((s) => `  ${s.id}: ${s.resaltado.map((r) => JSON.stringify(r)).join(' + ')}`).join('\n')
      : '',
    '- Never merge, split, drop or reorder the items: answer every id you received.',
    ...(opts.pageImage
      ? [
          '- The attached image is the page these texts come from. The texts were read from a SCANNED page by OCR, so they may contain recognition errors, broken words or lines out of order: use the image to understand the page and silently correct obvious OCR mistakes in your translation, but never invent text that is not on the page.'
        ]
      : []),
    ...(opts.docCard?.summary ? [`- About this document: ${opts.docCard.summary}`] : []),
    ...(Object.keys(opts.continuations ?? {}).length
      ? [
          '- Some texts are cut by a page break: the sentence continues in a text that is NOT in this list (shown below as context). Translate the piece you receive so it reads naturally and joins well with its continuation:',
          ...Object.entries(opts.continuations ?? {}).map(
            ([id, c]) => `  ${id} continues in ${c.id}: ${JSON.stringify(c.texto.slice(0, 200))}`
          )
        ]
      : []),
    opts.before
      ? `- For context only (do NOT translate or return it), the text just before the first item is: ${JSON.stringify(opts.before.slice(0, 300))}`
      : '',
    Object.keys(gl).length
      ? '- Use this glossary for consistency (source → target):\n' +
        Object.entries(gl)
          .map(([k, v]) => `  ${k} → ${v}`)
          .join('\n')
      : '',
    '',
    'Answer with ONLY a JSON object (no markdown fences, no comments) of this shape:',
    '{"translations": {"<id>": "<translated text>", …}, "glossary": {"<recurring source term>": "<its translation>", …}}',
    'In "glossary" list up to 15 technical terms, names or phrases that appear in this batch and will probably recur, with the translation you chose.',
    '',
    'Texts:',
    JSON.stringify(items, null, 1)
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/** Ficha del documento: de qué trata y los términos clave con UNA traducción fija (se prepara antes de traducir y va en cada lote). */
export interface DocCard {
  summary: string
  glossary: Glossary
}

/** Pide la ficha a partir de una muestra del texto (el comienzo de cada página). */
export function buildCardPrompt(opts: { target: TranslateLangCode; docName: string; kind?: TranslateKind; sample: string }): string {
  const lang = TRANSLATE_LANGS.find((l) => l.code === opts.target)?.name ?? opts.target
  return [
    `You are preparing to translate the ${opts.kind === 'docx' ? 'Word document' : 'PDF'} "${opts.docName}" into ${lang}. Below is a sample of its text (the beginning of each page, in reading order).`,
    '',
    'Answer with ONLY a JSON object (no markdown fences, no comments) of this shape:',
    '{"summary": "<2-3 sentences: what kind of document it is, its subject, its register or tone and the source language>", "glossary": {"<term or phrase that will recur>": "<the one translation to use every time>"}}',
    'In "glossary" put up to 40 key terms: defined terms, capitalised role names (for example the parties of a contract), technical or legal vocabulary, product names. Prefer standard, neutral terminology of the target language. Names of people and companies stay unchanged.',
    '',
    'Sample:',
    opts.sample
  ].join('\n')
}

/** Lee la ficha; `null` si el modelo no devolvió un JSON utilizable (la ficha es opcional: se traduce igual). */
export function parseCardAnswer(text: string): DocCard | null {
  const raw = firstJsonObject(text)
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { summary?: unknown; glossary?: unknown }
    const summary = typeof o.summary === 'string' ? o.summary.trim().slice(0, 600) : ''
    const glossary: Glossary = {}
    if (o.glossary && typeof o.glossary === 'object') {
      for (const [k, v] of Object.entries(o.glossary as Record<string, unknown>)) {
        if (typeof v === 'string' && k.trim() && v.trim() && k.length <= 120 && v.length <= 160) glossary[k.trim()] = v.trim()
      }
    }
    return summary || Object.keys(glossary).length ? { summary, glossary } : null
  } catch {
    return null
  }
}

/** Del glosario, lo que aparece en este lote (sin distinguir mayúsculas) y los términos de la ficha; hasta `max` términos. */
export function glossaryFor(batchText: string, glossary: Glossary, core: Glossary = {}, max = 60): Glossary {
  const hay = batchText.toLowerCase()
  const out: Glossary = {}
  for (const [k, v] of Object.entries(core)) if (Object.keys(out).length < max) out[k] = v
  for (const [k, v] of Object.entries(glossary)) {
    if (Object.keys(out).length >= max) break
    if (hay.includes(k.toLowerCase())) out[k] = v
  }
  return out
}

/** Primer objeto JSON balanceado dentro de un texto (el modelo a veces añade una frase o pone el JSON entre ```). */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export interface ParsedAnswer {
  translations: Record<string, string>
  glossary: Glossary
  /** Ids del lote que el modelo no devolvió (o devolvió vacíos). */
  missing: string[]
}

/** Lee la respuesta del modelo. Lanza si no hay JSON utilizable; los ids ajenos al lote se ignoran. */
export function parseTranslateAnswer(text: string, batch: PdfSegment[]): ParsedAnswer {
  const raw = firstJsonObject(text)
  if (!raw) throw new Error('sin JSON')
  const obj = JSON.parse(raw) as unknown
  if (!obj || typeof obj !== 'object') throw new Error('JSON inválido')
  const o = obj as { translations?: unknown; glossary?: unknown }
  // Algunos modelos devuelven directamente {id: texto}.
  const tr = (o.translations && typeof o.translations === 'object' ? o.translations : obj) as Record<string, unknown>
  const translations: Record<string, string> = {}
  const ids = new Set(batch.map((s) => s.id))
  for (const [k, v] of Object.entries(tr)) if (ids.has(k) && typeof v === 'string' && v.trim()) translations[k] = v
  const glossary: Glossary = {}
  if (o.glossary && typeof o.glossary === 'object') {
    for (const [k, v] of Object.entries(o.glossary as Record<string, unknown>)) {
      if (typeof v === 'string' && k.trim() && v.trim() && k.length <= 120 && v.length <= 160) glossary[k.trim()] = v.trim()
    }
  }
  return { translations, glossary, missing: batch.filter((s) => !translations[s.id]).map((s) => s.id) }
}

/** Nombre del archivo traducido: «informe.pdf» → «informe (en).pdf». */
export function translatedName(name: string, target: TranslateLangCode, kind: TranslateKind = 'pdf'): string {
  const base =
    name
      .replace(kind === 'docx' ? /\.docx$/i : /\.pdf$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .trim() || 'documento'
  return `${base} (${target}).${kind}`
}
