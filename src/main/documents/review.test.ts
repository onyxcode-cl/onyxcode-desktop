import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reviewDocument, reviewSummary } from './review'

const fx = (n: string): Buffer => readFileSync(join(__dirname, 'fixtures-review', n))
const bad = (r: Awaited<ReturnType<typeof reviewDocument>>): string =>
  r.items
    .filter((i) => !i.ok)
    .map((i) => i.text)
    .join(' | ')

describe('revisión de calidad de documentos_crear', () => {
  it('Word malo: título sin estilo, viñetas a mano y celdas vacías', async () => {
    const r = await reviewDocument('docx', fx('malo.docx'))
    expect(r.ok).toBe(false)
    expect(bad(r)).toContain('no Title/Heading')
    expect(bad(r)).toContain('escritos a mano')
    expect(bad(r)).toContain('Celdas vacías')
  })
  it('Word bueno pasa', async () => {
    const r = await reviewDocument('docx', fx('bueno.docx'))
    expect(bad(r)).toBe('')
    expect(r.ok).toBe(true)
  })
  it('Word largo (>12 párrafos) con estilos que Word guarda en minúsculas («heading 1», «title»): no da ✘ falso', async () => {
    const r = await reviewDocument('docx', fx('largo.docx'))
    expect(bad(r)).toBe('')
    expect(r.items.map((i) => i.text).join(' | ')).toContain('Tiene encabezados reales (5)')
    expect(r.items[0].text).toContain('«Title»')
  })
  it('Excel: total pegado y celda con error; fórmula sin valor guardado', async () => {
    const r = await reviewDocument('xlsx', fx('malo.xlsx'))
    expect(bad(r)).toContain('número pegado')
    const s = await reviewDocument('xlsx', fx('sinvalor.xlsx'))
    expect(bad(s)).toContain('sin valor recalculado')
  })
  it('Excel: «Media» o «Suma de…» en una tabla de prioridades no son un total pegado', async () => {
    const r = await reviewDocument('xlsx', fx('prioridades.xlsx'))
    expect(bad(r)).toBe('')
    expect(r.items.map((i) => i.text).join(' | ')).toContain('Sin filas de total')
  })
  it('PowerPoint: sin marcador de título y fuera del borde; con título pasa', async () => {
    const r = await reviewDocument('pptx', fx('malo.pptx'))
    expect(bad(r)).toContain('sin marcador de título')
    expect(bad(r)).toContain('fuera de los bordes')
    expect((await reviewDocument('pptx', fx('bueno.pptx'))).ok).toBe(true)
  })
  it('PowerPoint: si se pidió un subtítulo en la portada y no está en el archivo, ✘', async () => {
    const spec = { slides: [{ title: 'Con título', subtitle: 'Resumen para el directorio' }] }
    const r = await reviewDocument('pptx', fx('bueno.pptx'), spec)
    expect(bad(r)).toContain('subtítulo pedido de la portada')
    const ok = await reviewDocument('pptx', fx('bueno.pptx'), { slides: [{ title: 'Con título', subtitle: 'Con título' }] })
    expect(ok.items.map((i) => i.text).join(' | ')).toContain('subtítulo pedido de la portada está en el archivo')
    // diseños que no dibujan viñetas (section, kpis…): no se exige un subtítulo que el motor nunca pintaría
    for (const layout of ['kpis', 'section', 'chart', 'table']) {
      const r2 = await reviewDocument('pptx', fx('bueno.pptx'), { slides: [{ title: 'Con título', layout, bullets: ['Fuente: ERP'] }] })
      expect(bad(r2)).toBe('')
    }
    // sin spec (o con lienzo libre) no se inventa una exigencia
    const sinSpec = await reviewDocument('pptx', fx('bueno.pptx'))
    expect(sinSpec.items.map((i) => i.text).join(' | ')).not.toContain('subtítulo pedido')
    expect(sinSpec.ok).toBe(true)
  })
  it('el resumen para el agente trae la lista ✔/✘ y dice cuándo no se corrió', async () => {
    const ok = await reviewSummary('pptx', fx('bueno.pptx'))
    expect(ok).toContain('✔ Las 1 diapositivas tienen marcador de título')
    expect(ok).toContain('RESULTADO: OK')
    const mal = await reviewSummary('docx', fx('malo.docx'))
    expect(mal).toContain('✘')
    expect(mal).toContain('MISMO nombre')
    expect(await reviewSummary('docx', Buffer.from('no es un zip'))).toContain('NO corrida')
    expect(await reviewSummary('pdf', Buffer.from('%PDF'))).toContain('NO corrida')
  })
})
