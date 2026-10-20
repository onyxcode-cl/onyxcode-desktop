import { describe, expect, it, vi } from 'vitest'
import type { PdfExtractResult, PdfSegment } from '@shared/translate-pdf'
import { TranslateError, translatePdf, type TranslateDeps, type TranslateProgress } from './translate'

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
