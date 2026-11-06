/**
 * Orquesta «Traducir PDF sin cambiar el diseño» (F8-B200) desde el renderer: main extrae los textos (`translate:pdfExtract`), aquí se
 * traducen por lotes con el modelo del Chat (sesión efímera sin herramientas, igual que los textos de commit/PR), compartiendo un
 * glosario entre lotes para que un mismo término se traduzca igual en todo el documento, y main los escribe sobre el mismo PDF
 * (`translate:pdfApply`). Todo lo que depende del exterior se inyecta para poder probarlo.
 */
import {
  batchSegments,
  buildCardPrompt,
  buildCleanPagePrompt,
  cleanEligible,
  fallbackPageHtml,
  sanitizeCleanHtml,
  wrapCleanHtml,
  buildTranslatePrompt,
  parseCardAnswer,
  parseTranslateAnswer,
  type DocCard,
  type Glossary,
  type PdfPageClass,
  type PdfPageImageResult,
  type PdfApplyReport,
  type PdfApplyResult,
  type PdfCleanRequest,
  type PdfCleanResult,
  type PdfExtractRequest,
  type PdfExtractResult,
  type PdfFailReason,
  type PdfSegment,
  type TranslateKind,
  type TranslateLangCode
} from '@shared/translate-pdf'

export type TranslatePhase = 'reading' | 'translating' | 'writing' | 'cleaning'
export interface TranslateProgress {
  phase: TranslatePhase
  /** Lotes traducidos / total (solo en `translating`). */
  done: number
  total: number
}

export interface TranslateDeps {
  extract: (req: PdfExtractRequest) => Promise<PdfExtractResult>
  apply: (req: { jobId: string; translations: Record<string, string>; target: TranslateLangCode }) => Promise<PdfApplyResult>
  discard: (jobId: string) => Promise<void>
  /** Pregunta al modelo y devuelve su texto (lanza si falla). Con `images` el modelo además VE esas imágenes. */
  ask: (prompt: string, signal: AbortSignal, images?: { mime: string; filename: string; url: string }[]) => Promise<string>
  /** Imprime a PDF el HTML de la versión limpia. */
  clean?: (req: PdfCleanRequest) => Promise<PdfCleanResult>
  /** Dibuja una página como imagen (solo para hojas escaneadas, si el modelo lee imágenes). */
  pageImage?: (req: { jobId: string; page: number }) => Promise<PdfPageImageResult>
}

export interface TranslateOutcome {
  jobId: string
  outName: string
  report: PdfApplyReport
  pages: number
  kind?: TranslateKind
  pagesWithoutText: number[]
  /** Textos que el modelo no devolvió ni tras reintentar: quedan en el idioma original. */
  failedSegments: number
  /** Nombre de la versión limpia (PDF nuevo), si se creó. */
  cleanOutName?: string
}

export class TranslateError extends Error {
  constructor(
    readonly reason: PdfFailReason | 'model' | 'aborted' | 'tooManyFailures',
    detail?: string
  ) {
    super(detail ?? reason)
  }
}

/** Si el modelo deja sin traducir más de esta fracción de los textos, se aborta (mejor avisar que entregar un PDF a medias). */
const MAX_FAILED_FRACTION = 0.3

interface BatchContext {
  kind?: TranslateKind
  before?: string
  continuations?: Record<string, { id: string; texto: string }>
  docCard?: DocCard
  relevantGlossary?: boolean
  /** Imagen de la página de la que salen estos textos (el modelo la ve). */
  image?: { mime: string; filename: string; url: string }
}

async function translateBatch(
  deps: TranslateDeps,
  batch: PdfSegment[],
  target: TranslateLangCode,
  glossary: Glossary,
  docName: string,
  signal: AbortSignal,
  context: BatchContext = {}
): Promise<{ translations: Record<string, string>; glossary: Glossary }> {
  const translations: Record<string, string> = {}
  let pending = batch
  const newTerms: Glossary = {}
  // Hasta 3 intentos: el modelo a veces devuelve JSON roto o se salta algunos ids; solo se reintentan los que faltan.
  for (let attempt = 0; attempt < 3 && pending.length > 0; attempt++) {
    if (signal.aborted) throw new TranslateError('aborted')
    const { image, ...promptContext } = context
    const prompt = buildTranslatePrompt({
      target,
      batch: pending,
      glossary: { ...glossary, ...newTerms },
      docName,
      ...promptContext,
      pageImage: image !== undefined
    })
    let answer: string
    try {
      answer = await deps.ask(prompt, signal, image ? [image] : undefined)
    } catch (e) {
      if (signal.aborted) throw new TranslateError('aborted')
      if (attempt === 2) throw new TranslateError('model', e instanceof Error ? e.message : String(e))
      continue
    }
    try {
      const r = parseTranslateAnswer(answer, pending)
      Object.assign(translations, r.translations)
      Object.assign(newTerms, r.glossary)
      pending = pending.filter((s) => !translations[s.id])
    } catch {
      // JSON inválido: se vuelve a pedir lo mismo
    }
  }
  return { translations, glossary: newTerms }
}

/** Un lote de textos; si es de una hoja escaneada, a qué página (el modelo la verá). */
export interface PlannedBatch {
  segments: PdfSegment[]
  scannedPage?: number
}

/**
 * Lotes por orden de lectura. Con visión, cada hoja escaneada con texto OCR va en lotes propios de esa página (para adjuntar su
 * imagen); el resto se agrupa como siempre. Sin visión, igual que antes.
 */
export function planBatches(segments: PdfSegment[], pageClasses: Record<number, PdfPageClass> | undefined, vision: boolean): PlannedBatch[] {
  if (!vision || !pageClasses) return batchSegments(segments).map((b) => ({ segments: b }))
  const out: PlannedBatch[] = []
  let digital: PdfSegment[] = []
  const flush = (): void => {
    for (const b of batchSegments(digital)) out.push({ segments: b })
    digital = []
  }
  let i = 0
  while (i < segments.length) {
    const page = segments[i].pagina
    let j = i
    while (j < segments.length && segments[j].pagina === page) j++
    const slice = segments.slice(i, j)
    if (pageClasses[page] === 'escaneada_ocr') {
      flush()
      for (const b of batchSegments(slice, 5000, 40)) out.push({ segments: b, scannedPage: page })
    } else digital.push(...slice)
    i = j
  }
  flush()
  return out
}

/** Muestra del documento para la ficha: el comienzo de cada página (como mucho 2 textos por página, 12 000 caracteres en total). */
export function cardSample(segments: PdfSegment[], maxChars = 12_000): string {
  const perPage = new Map<number, string[]>()
  for (const s of segments) {
    const list = perPage.get(s.pagina) ?? []
    if (list.length < 2) list.push(s.texto.replace(/<[^>]+>/g, '').slice(0, 400))
    perPage.set(s.pagina, list)
  }
  let out = ''
  for (const [page, list] of perPage) {
    const block = `[page ${page}] ` + list.join(' / ') + '\n'
    if (out.length + block.length > maxChars) break
    out += block
  }
  return out
}

export async function translatePdf(
  deps: TranslateDeps,
  opts: {
    name: string
    base64: string
    kind?: TranslateKind
    target: TranslateLangCode
    signal: AbortSignal
    onProgress: (p: TranslateProgress) => void
    /** El modelo lee imágenes: las hojas escaneadas se le muestran como imagen junto a sus textos. */
    vision?: boolean
    /** Antes de traducir, el modelo lee una muestra y arma la ficha del documento y un glosario fijo. */
    card?: boolean
    /** En documentos escaneados, crea además una versión limpia (PDF nuevo, la IA reconstruye cada hoja). Por omisión no. */
    clean?: boolean
  }
): Promise<TranslateOutcome> {
  opts.onProgress({ phase: 'reading', done: 0, total: 0 })
  const ex = await deps.extract({ name: opts.name, base64: opts.base64, kind: opts.kind })
  if (!ex.ok) throw new TranslateError(ex.reason)
  const jobId = ex.jobId
  try {
    const useVision = opts.vision === true && deps.pageImage !== undefined
    const planned = planBatches(ex.segments, ex.pageClasses, useVision)
    const batches = planned.map((p) => p.segments)
    const byId = new Map(ex.segments.map((s) => [s.id, s]))
    const translations: Record<string, string> = {}
    let glossary: Glossary = {}
    let failed = 0
    let docCard: DocCard | undefined
    if (opts.card === true && ex.segments.length > 0) {
      opts.onProgress({ phase: 'reading', done: 0, total: 0 })
      try {
        const answer = await deps.ask(
          buildCardPrompt({ target: opts.target, docName: opts.name, kind: opts.kind, sample: cardSample(ex.segments) }),
          opts.signal
        )
        docCard = parseCardAnswer(answer) ?? undefined
      } catch {
        if (opts.signal.aborted) throw new TranslateError('aborted')
        // la ficha es una ayuda: sin ella se traduce igual
      }
      if (docCard) glossary = { ...docCard.glossary }
    }
    const images = new Map<number, { mime: string; filename: string; url: string } | null>()
    const imageOf = async (page: number): Promise<{ mime: string; filename: string; url: string } | undefined> => {
      if (!useVision || !deps.pageImage) return undefined
      if (!images.has(page)) {
        try {
          const r = await deps.pageImage({ jobId, page })
          images.set(page, r.ok ? { mime: r.mime, filename: `page-${page}.png`, url: `data:${r.mime};base64,${r.base64}` } : null)
        } catch {
          images.set(page, null)
        }
      }
      return images.get(page) ?? undefined
    }
    /** Versión limpia: la IA ve cada hoja con sus textos ya traducidos y escribe su HTML; main lo imprime a PDF. Nunca rompe la traducción. */
    const buildClean = async (): Promise<string | undefined> => {
      const pages = [...new Set(ex.segments.map((s) => s.pagina))].sort((a, b) => a - b)
      const sections: string[] = []
      for (let i = 0; i < pages.length; i++) {
        if (opts.signal.aborted) throw new TranslateError('aborted')
        opts.onProgress({ phase: 'cleaning', done: i, total: pages.length })
        const paragraphs = ex.segments
          .filter((s) => s.pagina === pages[i])
          .map((s) => ({ id: s.id, texto: translations[s.id] ?? s.texto }))
        const image = await imageOf(pages[i])
        let html = ''
        try {
          const answer = await deps.ask(
            buildCleanPagePrompt({
              target: opts.target,
              page: pages[i],
              pages: ex.pages,
              docName: opts.name,
              paragraphs,
              docCard,
              pageImage: image !== undefined
            }),
            opts.signal,
            image ? [image] : undefined
          )
          html = sanitizeCleanHtml(answer).trim()
        } catch {
          if (opts.signal.aborted) throw new TranslateError('aborted')
        }
        sections.push(/<section[\s>]/i.test(html) ? html : fallbackPageHtml(paragraphs))
      }
      opts.onProgress({ phase: 'cleaning', done: pages.length, total: pages.length })
      try {
        const r = await deps.clean!({ jobId, html: wrapCleanHtml(sections, opts.target, opts.name.replace(/\.pdf$/i, '')) })
        return r.ok ? r.outName : undefined
      } catch {
        return undefined
      }
    }
    for (let i = 0; i < batches.length; i++) {
      if (opts.signal.aborted) throw new TranslateError('aborted')
      opts.onProgress({ phase: 'translating', done: i, total: batches.length })
      const inBatch = new Set(batches[i].map((s) => s.id))
      const continuations: Record<string, { id: string; texto: string }> = {}
      for (const s of batches[i]) {
        const next = s.sigue && !inBatch.has(s.sigue) ? byId.get(s.sigue) : undefined
        if (next) continuations[s.id] = { id: next.id, texto: next.texto }
      }
      const prev = i > 0 ? batches[i - 1].at(-1)?.texto : undefined
      const scanned = planned[i].scannedPage
      const r = await translateBatch(deps, batches[i], opts.target, glossary, opts.name, opts.signal, {
        kind: opts.kind,
        before: prev,
        continuations,
        ...(docCard ? { docCard, relevantGlossary: true } : {}),
        ...(scanned !== undefined ? { image: await imageOf(scanned) } : {})
      })
      Object.assign(translations, r.translations)
      glossary = { ...glossary, ...r.glossary }
      failed += batches[i].filter((s) => !r.translations[s.id]).length
      if (failed / ex.segments.length > MAX_FAILED_FRACTION) throw new TranslateError('tooManyFailures')
    }
    opts.onProgress({ phase: 'translating', done: batches.length, total: batches.length })
    if (opts.signal.aborted) throw new TranslateError('aborted')
    opts.onProgress({ phase: 'writing', done: batches.length, total: batches.length })
    const res = await deps.apply({ jobId, translations, target: opts.target })
    if (!res.ok) throw new TranslateError(res.reason)
    let cleanOutName: string | undefined
    if (opts.clean === true && useVision && deps.clean && cleanEligible(ex.segments, ex.pageClasses)) {
      cleanOutName = await buildClean()
    }
    return {
      jobId,
      outName: res.outName,
      report: res.report,
      pages: ex.pages,
      kind: opts.kind,
      pagesWithoutText: ex.pagesWithoutText,
      failedSegments: failed,
      ...(cleanOutName ? { cleanOutName } : {})
    }
  } catch (e) {
    await deps.discard(jobId).catch(() => undefined)
    throw e
  }
}
