/**
 * Orquesta «Traducir PDF sin cambiar el diseño» (F8-B200) desde el renderer: main extrae los textos (`translate:pdfExtract`), aquí se
 * traducen por lotes con el modelo del Chat (sesión efímera sin herramientas, igual que los textos de commit/PR), compartiendo un
 * glosario entre lotes para que un mismo término se traduzca igual en todo el documento, y main los escribe sobre el mismo PDF
 * (`translate:pdfApply`). Todo lo que depende del exterior se inyecta para poder probarlo.
 */
import {
  batchSegments,
  buildTranslatePrompt,
  parseTranslateAnswer,
  type Glossary,
  type PdfApplyReport,
  type PdfApplyResult,
  type PdfExtractRequest,
  type PdfExtractResult,
  type PdfFailReason,
  type PdfSegment,
  type TranslateLangCode
} from '@shared/translate-pdf'

export type TranslatePhase = 'reading' | 'translating' | 'writing'
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
  /** Pregunta al modelo y devuelve su texto (lanza si falla). */
  ask: (prompt: string, signal: AbortSignal) => Promise<string>
}

export interface TranslateOutcome {
  jobId: string
  outName: string
  report: PdfApplyReport
  pages: number
  pagesWithoutText: number[]
  /** Textos que el modelo no devolvió ni tras reintentar: quedan en el idioma original. */
  failedSegments: number
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

async function translateBatch(
  deps: TranslateDeps,
  batch: PdfSegment[],
  target: TranslateLangCode,
  glossary: Glossary,
  docName: string,
  signal: AbortSignal,
  context: { before?: string; continuations?: Record<string, { id: string; texto: string }> } = {}
): Promise<{ translations: Record<string, string>; glossary: Glossary }> {
  const translations: Record<string, string> = {}
  let pending = batch
  const newTerms: Glossary = {}
  // Hasta 3 intentos: el modelo a veces devuelve JSON roto o se salta algunos ids; solo se reintentan los que faltan.
  for (let attempt = 0; attempt < 3 && pending.length > 0; attempt++) {
    if (signal.aborted) throw new TranslateError('aborted')
    const prompt = buildTranslatePrompt({ target, batch: pending, glossary: { ...glossary, ...newTerms }, docName, ...context })
    let answer: string
    try {
      answer = await deps.ask(prompt, signal)
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

export async function translatePdf(
  deps: TranslateDeps,
  opts: { name: string; base64: string; target: TranslateLangCode; signal: AbortSignal; onProgress: (p: TranslateProgress) => void }
): Promise<TranslateOutcome> {
  opts.onProgress({ phase: 'reading', done: 0, total: 0 })
  const ex = await deps.extract({ name: opts.name, base64: opts.base64 })
  if (!ex.ok) throw new TranslateError(ex.reason)
  const jobId = ex.jobId
  try {
    const batches = batchSegments(ex.segments)
    const byId = new Map(ex.segments.map((s) => [s.id, s]))
    const translations: Record<string, string> = {}
    let glossary: Glossary = {}
    let failed = 0
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
      const r = await translateBatch(deps, batches[i], opts.target, glossary, opts.name, opts.signal, { before: prev, continuations })
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
    return {
      jobId,
      outName: res.outName,
      report: res.report,
      pages: ex.pages,
      pagesWithoutText: ex.pagesWithoutText,
      failedSegments: failed
    }
  } catch (e) {
    await deps.discard(jobId).catch(() => undefined)
    throw e
  }
}
