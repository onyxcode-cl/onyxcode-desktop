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
  'tooBig' | 'unreadable' | 'encrypted' | 'scanned' | 'noText' | 'tooLong' | 'noPython' | 'unsupported' | 'timeout' | 'failed'

/** Qué se traduce: un PDF (PyMuPDF), un Word (python-docx) o un Excel (`translate_xlsx.py`). El resto del flujo es el mismo. */
export type TranslateKind = 'pdf' | 'docx' | 'xlsx'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** Nombre del tipo de documento para los textos que van al modelo (en inglés). */
function kindLabel(kind: TranslateKind | undefined): string {
  return kind === 'docx' ? 'Word document' : kind === 'xlsx' ? 'Excel workbook' : 'PDF'
}

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
  /** Word y Excel: textos cuya traducción perdió parte del formato (negrita, color…). */
  formatLost?: number
  /** Excel: celdas cuyo texto traducido es más largo que el ancho de su columna (no se cambian los anchos para no alterar el diseño). */
  cutOff?: number
}
export type PdfApplyResult = { ok: true; report: PdfApplyReport; outName: string } | { ok: false; reason: PdfFailReason }

/** Versión LIMPIA: un PDF nuevo armado desde cero (HTML) con el texto traducido, para hojas escaneadas. */
export type PdfCleanRequest = { jobId: string; html: string }
export type PdfCleanResult = { ok: true; outName: string } | { ok: false; reason: PdfFailReason }
/** Tope del HTML de la versión limpia (el motor de impresión rechaza más de 5 MB). */
export const TRANSLATE_CLEAN_HTML_MAX = 4 * 1024 * 1024

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
    `You are a professional translator. Translate every text below into ${lang}. The texts come from the ${kindLabel(opts.kind)} "${opts.docName}"; each one sits in a fixed place of the ${opts.kind === 'xlsx' ? 'sheet (a cell, a chart title or a comment)' : 'page'}, so keep each translation about as long as the original.`,
    '',
    'Rules:',
    '- Translate ALL human-readable text, even short labels and headings. Keep numbers, dates, amounts, references and codes exactly.',
    '- Do NOT translate code, commands, file names, paths, URLs, e-mail addresses or configuration keys. Proper names of people and companies stay as they are.',
    opts.kind === 'xlsx'
      ? '- Some texts carry tags like <r1>…</r1><r2>…</r2> that mark runs with different formatting inside one cell: keep every tag exactly, around the equivalent translated words. Cells are short: do not add line breaks that were not in the original.'
      : `- Keep the tags exactly where they belong around the equivalent translated words: <b>…</b> (bold), ${opts.kind === 'docx' ? '<i>…</i> (italic), <u>…</u> (underline), ' : ''}<c=#rrggbb>…</c> (color), <l=N>…</l> (link) and [[…]] (highlight).`,
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
    `You are preparing to translate the ${kindLabel(opts.kind)} "${opts.docName}" into ${lang}. Below is a sample of its text (the beginning of each page, in reading order).`,
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

/** Instrucción para que el modelo reconstruya UNA hoja escaneada como HTML limpio, con los textos ya traducidos. */
export function buildCleanPagePrompt(opts: {
  target: TranslateLangCode
  page: number
  pages: number
  docName: string
  /** Textos de la hoja ya traducidos, en orden de lectura. */
  paragraphs: { id: string; texto: string }[]
  docCard?: DocCard
  /** Va adjunta la imagen de la hoja original. */
  pageImage: boolean
}): string {
  const lang = TRANSLATE_LANGS.find((l) => l.code === opts.target)?.name ?? opts.target
  return [
    `You are rebuilding page ${opts.page} of ${opts.pages} of the scanned document "${opts.docName}" as clean HTML in ${lang}.`,
    opts.pageImage
      ? 'The attached image is the original page. Below are the texts of that page, already translated into ' + lang + ', in reading order (they were read by OCR, so a few words of the page may be missing from the list).'
      : 'Below are the texts of that page, already translated into ' + lang + ', in reading order.',
    '',
    'Rules:',
    '- Output ONLY an HTML fragment for this one page: a single <section class="page">…</section>. No <html>, <head>, <body>, <style> or <script>, no markdown fences, no comments.',
    '- Use the given translations as they are (do not rephrase them). If the image shows text that is missing from the list (labels, headings, field names, "Signature"…), translate it yourself and include it where it belongs.',
    '- Follow the structure of the page: <h1>/<h2> for headings, <p> for paragraphs, numbered clauses stay as text, <table> with <th> for tables and forms (empty cells where the form has blanks). If the page has two or three columns, wrap them in <div class="cols2"> or <div class="cols3"> in reading order.',
    '- Keep codes, numbers, dates and names exactly. Put page footers or document codes in <p class="foot">.',
    '- Only simple tags (h1-h3, p, ul, ol, li, table, thead, tbody, tr, th, td, div, span, strong, em, br, hr). No images, no links, no inline styles.',
    ...(opts.docCard?.summary ? [`- About this document: ${opts.docCard.summary}`] : []),
    '',
    'Translated texts (id: text):',
    opts.paragraphs.map((p) => `${p.id}: ${p.texto}`).join('\n')
  ].join('\n')
}

const SAFE_TAGS = new Set(['section', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'strong', 'b', 'em', 'i', 'u', 'br', 'hr', 'sup', 'sub'])

/**
 * Deja solo etiquetas sencillas del HTML que devolvió el modelo (es DATO, no se confía en él): sin scripts, estilos, enlaces,
 * imágenes ni atributos salvo `class` (de una lista corta) y `colspan`/`rowspan`. El texto se conserva escapado.
 */
export function sanitizeCleanHtml(raw: string): string {
  let h = raw.replace(/```(?:html)?/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  h = h.replace(/<(script|style|iframe|object|embed|svg|math|template)[\s\S]*?<\/\1\s*>/gi, '')
  return h.trim().replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (m, name: string, attrs: string) => {
    const tag = name.toLowerCase()
    if (!SAFE_TAGS.has(tag)) return ''
    if (m.startsWith('</')) return `</${tag}>`
    const keep: string[] = []
    const cls = /\bclass\s*=\s*"(page|cols2|cols3|foot)"/i.exec(attrs)
    if (cls) keep.push(`class="${cls[1].toLowerCase()}"`)
    for (const a of ['colspan', 'rowspan']) {
      const v = new RegExp(`\\b${a}\\s*=\\s*"(\\d{1,2})"`, 'i').exec(attrs)
      if (v) keep.push(`${a}="${v[1]}"`)
    }
    return `<${tag}${keep.length ? ' ' + keep.join(' ') : ''}${/\/\s*>$/.test(m) ? ' /' : ''}>`
  })
}

const escHtml = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Página mínima cuando el modelo no devolvió HTML utilizable: los textos traducidos en orden, como párrafos. */
export function fallbackPageHtml(paragraphs: { texto: string }[]): string {
  return `<section class="page">${paragraphs.map((p) => `<p>${escHtml(p.texto)}</p>`).join('')}</section>`
}

/** Documento HTML completo (A4, márgenes de 18 mm, letra de 11,5 px o más) con las hojas ya saneadas. */
export function wrapCleanHtml(sections: string[], lang: TranslateLangCode, title: string): string {
  const css = [
    '@page { size: A4; margin: 18mm }',
    'body { font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; line-height: 1.45; color: #1a1a1a; margin: 0 }',
    '.page { break-after: page; page-break-after: always } .page:last-child { break-after: auto; page-break-after: auto }',
    'h1 { font-size: 22px; margin: 0 0 10px } h2 { font-size: 16px; margin: 14px 0 6px } h3 { font-size: 13px; margin: 10px 0 4px }',
    'p { margin: 0 0 7px; text-align: left; hyphens: auto } .foot { font-size: 10.5px; color: #555; text-align: left }',
    '.cols2 { column-count: 2; column-gap: 8mm } .cols3 { column-count: 3; column-gap: 7mm }',
    'table { border-collapse: collapse; width: 100%; margin: 6px 0 } th, td { border: 1px solid #999; padding: 4px 6px; vertical-align: top; text-align: left }',
    'th { background: #eee } tr { break-inside: avoid }'
  ].join('\n')
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>\n${css}\n</style></head><body>${sections.join('\n')}</body></html>`
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

/** Nombre de la versión limpia: «informe.pdf» → «informe (en, limpio).pdf». */
export function cleanName(name: string, target: TranslateLangCode): string {
  return translatedName(name, target).replace(/\)\.pdf$/, ', limpio).pdf')
}

/** ¿Conviene crear también la versión limpia? Solo si TODAS las páginas con texto son escaneos (de lo contrario el original ya conserva el diseño). */
export function cleanEligible(segments: PdfSegment[], pageClasses: Record<number, PdfPageClass> | undefined): boolean {
  if (!pageClasses || segments.length === 0) return false
  return segments.every((s) => pageClasses[s.pagina] === 'escaneada_ocr')
}

/** Nombre del archivo traducido: «informe.pdf» → «informe (en).pdf». */
export function translatedName(name: string, target: TranslateLangCode, kind: TranslateKind = 'pdf'): string {
  const base =
    name
      .replace(new RegExp(`\\.${kind}$`, 'i'), '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .trim() || 'documento'
  return `${base} (${target}).${kind}`
}
