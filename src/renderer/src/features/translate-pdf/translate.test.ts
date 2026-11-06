import { describe, expect, it, vi } from 'vitest'
import type { PdfExtractResult, PdfSegment } from '@shared/translate-pdf'
import { TranslateError, cardSample, planBatches, translatePdf, type TranslateDeps, type TranslateProgress } from './translate'

const seg = (n: number): PdfSegment => ({ id: `p1-${n}`, pagina: 1, texto: `texto ${n} ` + 'x'.repeat(200) })
const segs = (n: number): PdfSegment[] => Array.from({ length: n }, (_, i) => seg(i))

/** Respuesta del «modelo»: traduce todo lo que ve en el prompt. */
function answerAll(prompt: string, glossary: Record<string, string> = {}): string {
  const body = prompt.slice(prompt.indexOf('Texts:') + 6)
  const items = JSON.parse(body) as Record<string, string>
  return JSON.stringify({ translations: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, 'TR ' + v.slice(0, 8)])), glossary })
}

function makeDeps(over: Partial<TranslateDeps> = {}, extract?: PdfExtractResult): TranslateDeps {
  return {
    extract: vi.fn(
      async (): Promise<PdfExtractResult> =>
        extract ?? { ok: true as const, jobId: 'aaaaaaaaaaaaaaaa', pages: 2, segments: segs(30), pagesWithoutText: [2] }
    ),
    apply: vi.fn(async () => ({
      ok: true as const,
      outName: 'x (en).pdf',
      report: { translated: 30, untranslated: 0, shrunk: 1, overflow: [], linksDropped: 0 }
    })),
    discard: vi.fn(async () => undefined),
    ask: vi.fn(async (p: string) => answerAll(p)),
    ...over
  }
}
const opts = (signal = new AbortController().signal, onProgress: (p: TranslateProgress) => void = () => undefined) => ({
  name: 'x.pdf',
  base64: 'AAAA',
  target: 'en' as const,
  signal,
  onProgress
})

describe('translatePdf', () => {
  it('traduce por lotes, aplica y devuelve el resultado con el progreso', async () => {
    const deps = makeDeps()
    const seen: string[] = []
    const r = await translatePdf(
      deps,
      opts(new AbortController().signal, (p) => seen.push(`${p.phase}:${p.done}/${p.total}`))
    )
    expect(r).toMatchObject({ jobId: 'aaaaaaaaaaaaaaaa', outName: 'x (en).pdf', pages: 2, pagesWithoutText: [2], failedSegments: 0 })
    expect(vi.mocked(deps.ask).mock.calls.length).toBeGreaterThan(1) // 30 textos de ~210 caracteres no caben en un solo lote
    const sent = vi.mocked(deps.apply).mock.calls[0][0]
    expect(Object.keys(sent.translations)).toHaveLength(30)
    expect(sent.target).toBe('en')
    expect(seen[0]).toBe('reading:0/0')
    expect(seen.at(-1)).toMatch(/^writing:/)
    expect(deps.discard).not.toHaveBeenCalled()
  })

  it('pasa al modelo el contexto: texto anterior y la continuación de una frase cortada por la hoja', async () => {
    const segsC = segs(30)
    segsC[9] = { ...segsC[9], sigue: 'p1-25' }
    const prompts: string[] = []
    const deps = makeDeps(
      { ask: vi.fn(async (p: string) => (prompts.push(p), answerAll(p))) },
      { ok: true, jobId: 'aaaaaaaaaaaaaaaa', pages: 2, segments: segsC, pagesWithoutText: [] }
    )
    await translatePdf(deps, opts())
    expect(prompts[1]).toContain('just before the first item is')
    const withHint = prompts.find((p) => p.includes('p1-9 continues in p1-25'))
    expect(withHint).toBeTruthy()
  })

  it('el glosario que devuelve un lote viaja en el prompt del siguiente', async () => {
    const prompts: string[] = []
    const deps = makeDeps({
      ask: vi.fn(async (p: string) => {
        prompts.push(p)
        return answerAll(p, { siniestro: 'loss' })
      })
    })
    await translatePdf(deps, opts())
    expect(prompts[0]).not.toContain('siniestro → loss')
    expect(prompts[1]).toContain('siniestro → loss')
  })

  it('reintenta lo que el modelo omitió y el JSON roto', async () => {
    let calls = 0
    const deps = makeDeps(
      {
        ask: vi.fn(async (p: string) => {
          calls++
          if (calls === 1) return 'no sé qué decir' // JSON roto
          if (calls === 2) {
            const full = JSON.parse(answerAll(p)) as { translations: Record<string, string> }
            const first = Object.keys(full.translations)[0]
            delete full.translations[first] // se salta un id
            return JSON.stringify(full)
          }
          return answerAll(p)
        })
      },
      { ok: true, jobId: 'aaaaaaaaaaaaaaaa', pages: 1, segments: segs(3), pagesWithoutText: [] }
    )
    const r = await translatePdf(deps, opts())
    expect(r.failedSegments).toBe(0)
    expect(vi.mocked(deps.apply).mock.calls[0][0].translations).toHaveProperty('p1-0')
    expect(calls).toBe(3)
  })

  it('si el modelo no devuelve más de un 30 % de los textos, aborta y borra el trabajo', async () => {
    const deps = makeDeps({ ask: vi.fn(async () => '{"translations": {}}') })
    await expect(translatePdf(deps, opts())).rejects.toMatchObject({ reason: 'tooManyFailures' })
    expect(deps.discard).toHaveBeenCalledWith('aaaaaaaaaaaaaaaa')
    expect(deps.apply).not.toHaveBeenCalled()
  })

  it('un fallo del modelo en los 3 intentos es «model» con el detalle', async () => {
    const deps = makeDeps({ ask: vi.fn(async () => Promise.reject(new Error('sin cuota'))) })
    await expect(translatePdf(deps, opts())).rejects.toMatchObject({ reason: 'model', message: 'sin cuota' })
    expect(deps.discard).toHaveBeenCalled()
  })

  it('cancelar a mitad borra el trabajo y no aplica nada', async () => {
    const ctrl = new AbortController()
    const deps = makeDeps({
      ask: vi.fn(async (p: string) => {
        ctrl.abort()
        return answerAll(p)
      })
    })
    await expect(translatePdf(deps, opts(ctrl.signal))).rejects.toMatchObject({ reason: 'aborted' })
    expect(deps.discard).toHaveBeenCalled()
    expect(deps.apply).not.toHaveBeenCalled()
  })

  it.each(['scanned', 'encrypted', 'tooBig', 'noPython'] as const)(
    'si main no puede extraer (%s) lo propaga sin crear trabajo',
    async (reason) => {
      const deps = makeDeps({}, { ok: false, reason })
      await expect(translatePdf(deps, opts())).rejects.toBeInstanceOf(TranslateError)
      await expect(translatePdf(deps, opts())).rejects.toMatchObject({ reason })
      expect(deps.discard).not.toHaveBeenCalled()
    }
  )

  it('si apply falla, lo dice y borra el trabajo', async () => {
    const deps = makeDeps({ apply: vi.fn(async () => ({ ok: false as const, reason: 'timeout' as const })) })
    await expect(translatePdf(deps, opts())).rejects.toMatchObject({ reason: 'timeout' })
    expect(deps.discard).toHaveBeenCalled()
  })
})

describe('hojas escaneadas y ficha del documento', () => {
  const scanSeg = (page: number, n: number): PdfSegment => ({ id: `p${page}-${n}`, pagina: page, texto: `texto ${page}.${n}` })
  const twoPages = (): PdfExtractResult => ({
    ok: true,
    jobId: 'aaaaaaaaaaaaaaaa',
    pages: 3,
    segments: [scanSeg(1, 0), scanSeg(1, 1), scanSeg(2, 0), scanSeg(3, 0)],
    pagesWithoutText: [],
    pageClasses: { 1: 'escaneada_ocr', 2: 'digital', 3: 'escaneada_ocr' }
  })

  it('planBatches: cada hoja escaneada va en su propio lote con su página; sin visión todo se agrupa como antes', () => {
    const e = twoPages()
    if (!e.ok) throw new Error('x')
    const plan = planBatches(e.segments, e.pageClasses, true)
    expect(plan.map((p) => [p.scannedPage, p.segments.map((s) => s.id)])).toEqual([
      [1, ['p1-0', 'p1-1']],
      [undefined, ['p2-0']],
      [3, ['p3-0']]
    ])
    expect(planBatches(e.segments, e.pageClasses, false)).toHaveLength(1)
  })

  it('con visión adjunta la imagen solo en los lotes de hojas escaneadas y avisa al modelo', async () => {
    const calls: { prompt: string; images: number }[] = []
    const pageImage = vi.fn(async ({ page }: { page: number }) => ({ ok: true as const, mime: 'image/png' as const, base64: `IMG${page}` }))
    const deps = makeDeps(
      { ask: vi.fn(async (p: string, _s: AbortSignal, images?: unknown[]) => (calls.push({ prompt: p, images: images?.length ?? 0 }), answerAll(p))), pageImage },
      twoPages()
    )
    await translatePdf(deps, { ...opts(), vision: true })
    expect(calls.map((c) => c.images)).toEqual([1, 0, 1])
    expect(calls[0].prompt).toContain('SCANNED page')
    expect(calls[1].prompt).not.toContain('SCANNED page')
    expect(pageImage).toHaveBeenCalledTimes(2)
  })

  it('sin visión no pide ninguna imagen; si la imagen falla se traduce igual, solo con texto', async () => {
    const pageImage = vi.fn(async () => ({ ok: true as const, mime: 'image/png' as const, base64: 'X' }))
    const d1 = makeDeps({ pageImage }, twoPages())
    await translatePdf(d1, opts())
    expect(pageImage).not.toHaveBeenCalled()
    const failing = vi.fn(async () => ({ ok: false as const }))
    const imgs: number[] = []
    const d2 = makeDeps(
      { pageImage: failing, ask: vi.fn(async (p: string, _s: AbortSignal, i?: unknown[]) => (imgs.push(i?.length ?? 0), answerAll(p))) },
      twoPages()
    )
    const r = await translatePdf(d2, { ...opts(), vision: true })
    expect(imgs).toEqual([0, 0, 0])
    expect(r.failedSegments).toBe(0)
  })

  it('la ficha se pide primero, su glosario viaja a los lotes y un fallo de la ficha no detiene la traducción', async () => {
    const prompts: string[] = []
    const card = JSON.stringify({ summary: 'Insurance policy, formal tone.', glossary: { Insured: 'Asegurado' } })
    const ask = vi.fn(async (p: string) => (prompts.push(p), p.includes('preparing to translate') ? card : answerAll(p)))
    await translatePdf(makeDeps({ ask }, twoPages()), { ...opts(), card: true })
    expect(prompts[0]).toContain('preparing to translate')
    expect(prompts[1]).toContain('About this document: Insurance policy, formal tone.')
    expect(prompts[1]).toContain('Insured → Asegurado')
    const bad = vi.fn(async (p: string) => {
      if (p.includes('preparing to translate')) throw new Error('boom')
      return answerAll(p)
    })
    const r = await translatePdf(makeDeps({ ask: bad }, twoPages()), { ...opts(), card: true })
    expect(r.failedSegments).toBe(0)
  })

  it('cardSample toma el comienzo de cada página y respeta el tope', () => {
    const segs = [scanSeg(1, 0), scanSeg(1, 1), scanSeg(1, 2), scanSeg(2, 0)]
    const sample = cardSample(segs)
    expect(sample).toContain('[page 1] texto 1.0 / texto 1.1')
    expect(sample).not.toContain('texto 1.2')
    expect(sample).toContain('[page 2]')
    expect(cardSample(segs, 20)).toBe('')
  })
})

describe('versión limpia de un escaneo', () => {
  const scanned = (): PdfExtractResult => ({
    ok: true,
    jobId: 'aaaaaaaaaaaaaaaa',
    pages: 2,
    segments: [
      { id: 'p1-0', pagina: 1, texto: 'one' },
      { id: 'p2-0', pagina: 2, texto: 'two' }
    ],
    pagesWithoutText: [],
    pageClasses: { 1: 'escaneada_ocr', 2: 'escaneada_ocr' }
  })
  const img = vi.fn(async () => ({ ok: true as const, mime: 'image/png' as const, base64: 'X' }))
  const askClean = (prompts: string[]) =>
    vi.fn(async (p: string, _s: AbortSignal, i?: unknown[]) => {
      prompts.push(p)
      if (p.includes('rebuilding page')) return `<section class="page"><p>PAGE ${i ? 'CON-IMAGEN' : 'SIN'}</p><script>x</script></section>`
      return answerAll(p)
    })

  it('con visión y todo escaneado, la IA arma el HTML de cada hoja y main lo imprime; el progreso incluye «cleaning»', async () => {
    const prompts: string[] = []
    const clean = vi.fn(async () => ({ ok: true as const, outName: 'x (en, limpio).pdf' }))
    const seen: string[] = []
    const r = await translatePdf(makeDeps({ ask: askClean(prompts), pageImage: img, clean }, scanned()), {
      ...opts(new AbortController().signal, (p) => seen.push(p.phase)),
      vision: true,
      clean: true
    })
    expect(r.cleanOutName).toBe('x (en, limpio).pdf')
    expect(prompts.filter((p) => p.includes('rebuilding page'))).toHaveLength(2)
    const html = (clean.mock.calls[0] as unknown as [{ html: string }])[0].html
    expect(html).toContain('<p>PAGE CON-IMAGEN</p>')
    expect(html).not.toContain('<script')
    expect(html.match(/<section class="page">/g)).toHaveLength(2)
    expect(seen).toContain('cleaning')
  })

  it('no la crea si no se pidió, si el modelo no ve imágenes o si hay una hoja digital', async () => {
    const clean = vi.fn(async () => ({ ok: true as const, outName: 'z.pdf' }))
    const a = await translatePdf(makeDeps({ pageImage: img, clean }, scanned()), { ...opts(), vision: true })
    const b = await translatePdf(makeDeps({ pageImage: img, clean }, scanned()), { ...opts(), clean: true })
    const mixed = scanned()
    if (mixed.ok) mixed.pageClasses = { 1: 'escaneada_ocr', 2: 'digital' }
    const c = await translatePdf(makeDeps({ pageImage: img, clean }, mixed), { ...opts(), vision: true, clean: true })
    expect([a.cleanOutName, b.cleanOutName, c.cleanOutName]).toEqual([undefined, undefined, undefined])
    expect(clean).not.toHaveBeenCalled()
  })

  it('si el modelo falla en una hoja se usa una hoja simple con los textos; si main falla, la traducción sigue entera', async () => {
    const ask = vi.fn(async (p: string) => {
      if (p.includes('rebuilding page')) throw new Error('boom')
      return answerAll(p)
    })
    const clean = vi.fn(async () => ({ ok: false as const, reason: 'failed' as const }))
    const r = await translatePdf(makeDeps({ ask, pageImage: img, clean }, scanned()), { ...opts(), vision: true, clean: true })
    const html = (clean.mock.calls[0] as unknown as [{ html: string }])[0].html
    expect(html.match(/<section class="page"><p>/g)).toHaveLength(2)
    expect(r.cleanOutName).toBeUndefined()
    expect(r.failedSegments).toBe(0)
    expect(r.outName).toBe('x (en).pdf')
  })
})
