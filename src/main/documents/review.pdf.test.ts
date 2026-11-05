import { describe, expect, it } from 'vitest'
import { htmlFontSizesPt } from '../extras/pdf-options'
import { reviewPdf, reviewSummary } from './review'

const pdf = (n: number): Buffer => Buffer.from(`%PDF-1.4\n1 0 obj\n<</Type /Pages\n/Count ${n}\n/Kids []>>\nendobj\n`)
const GOOD = `<!doctype html><html lang="es"><head><style>@page{size:A4;margin:20mm}body{font-size:11pt}td{font-size:10pt}</style></head><body><h1>Informe</h1><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table></body></html>`

describe('revisión de PDF (HTML + páginas)', () => {
  it('lee tamaños de letra en pt, px y rem', () => {
    expect(htmlFontSizesPt('a{font-size:12px} b{font-size: 10pt} c{font-size:1.5rem}')).toEqual([9, 10, 18])
  })
  it('un PDF bueno pasa y avisa las páginas', () => {
    const r = reviewPdf(GOOD, pdf(2))
    expect(r.ok).toBe(true)
    expect(r.items.some((i) => i.note && i.text === '2 páginas')).toBe(true)
  })
  it('letra de 7 pt es ✘', () => {
    const r = reviewPdf(GOOD.replace('10pt', '7pt'), pdf(1))
    expect(r.ok).toBe(false)
    expect(r.items.find((i) => !i.ok)?.text).toMatch(/9 px/)
  })
  it('tabla larga sin thead, sin @page, sin lang y con recursos de internet son ✘', () => {
    const rows = '<tr><td>x</td></tr>'.repeat(14)
    const r = reviewPdf(`<html><body><img src="https://x.test/a.png"><table>${rows}</table></body></html>`, pdf(1))
    const bad = r.items.filter((i) => !i.ok).map((i) => i.text)
    expect(bad.length).toBe(4)
  })
  it('restos de plantilla y PDF inválido son ✘; imagen sin alt es solo aviso', () => {
    expect(reviewPdf(GOOD.replace('Informe', 'Lorem ipsum'), pdf(1)).ok).toBe(false)
    expect(reviewPdf(GOOD, Buffer.from('no')).ok).toBe(false)
    const r = reviewPdf(GOOD.replace('</body>', '<img src="data:image/png;base64,AA"></body>'), pdf(1))
    expect(r.ok).toBe(true)
    expect(r.items.some((i) => i.note && /sin texto alternativo/.test(i.text))).toBe(true)
  })
  it('reviewSummary corre la revisión del PDF con el HTML; sin HTML dice NO corrida', async () => {
    expect(await reviewSummary('pdf', pdf(1), undefined, GOOD)).toContain('RESULTADO: OK')
    expect(await reviewSummary('pdf', pdf(1))).toContain('NO corrida')
  })
})
