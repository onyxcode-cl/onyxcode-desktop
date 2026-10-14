import { describe, expect, it } from 'vitest'
import { extractBrokenDocBlocks, extractChatDocBlocks, parseDataBlockDetailed } from './chatDocBlocks'

const XLSX = '```xlsx\n{"sheets":[{"name":"Gastos","rows":[["x"]]}]}\n```'
const fence = (lang: string, body: string): string => '```' + lang + '\n' + body + '\n```'

describe('tolerancia a lo que escribe GPT', () => {
  const GPT_PPTX = fence(
    'pptx',
    JSON.stringify({ title: 'x', slides: [{ title: 'Portada', subtitle: 'Sub', notes: 'n', bullets: ['a'.repeat(900)] }] })
  )

  it('un pptx con claves de más y viñetas larguísimas ya NO se ignora: se sanea', () => {
    const blocks = extractChatDocBlocks(GPT_PPTX)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind === 'pptx' && blocks[0].data.slides[0].bullets?.[0].length).toBeLessThanOrEqual(500)
  })

  it('acepta la spec dentro de una valla ```json / ```javascript / ```text si la forma es inequívoca', () => {
    for (const lang of ['json', 'javascript', 'text']) {
      const blocks = extractChatDocBlocks(fence(lang, '{"slides":[{"title":"Hola"}]}'))
      expect(blocks.map((b) => b.kind)).toEqual(['pptx'])
    }
    const docx = extractChatDocBlocks(fence('json', '{"blocks":[{"type":"paragraph","text":"Hola"}]}'))
    expect(docx.map((b) => b.kind)).toEqual(['docx'])
  })

  it('un ```json normal (configuración, datos) NO se toma por documento', () => {
    expect(extractChatDocBlocks(fence('json', '{"name":"app","version":"1.0.0"}'))).toEqual([])
    expect(extractBrokenDocBlocks(fence('json', '{"name":"app"}'))).toEqual([])
    expect(extractBrokenDocBlocks(fence('json', '{ esto no es json'))).toEqual([])
  })
})

describe('bloques cerrados pero inválidos se reportan (no se pierden en silencio)', () => {
  it('JSON roto → motivo «json»', () => {
    const broken = extractBrokenDocBlocks(fence('xlsx', '{"sheets": [oops]}'))
    expect(broken).toHaveLength(1)
    expect(broken[0]).toMatchObject({ kind: 'xlsx', reason: 'json' })
  })

  it('JSON válido pero sin la forma del documento → motivo «schema»', () => {
    const broken = extractBrokenDocBlocks(fence('docx', '{"blocks":[{"type":"image","path":"a.png"}]}'))
    expect(broken[0]).toMatchObject({ kind: 'docx', reason: 'schema' })
  })

  it('un bloque válido no aparece como roto, y uno roto no aparece como válido', () => {
    const md = `${XLSX}\n\n${fence('pptx', 'no es json')}`
    expect(extractChatDocBlocks(md).map((b) => b.kind)).toEqual(['xlsx'])
    expect(extractBrokenDocBlocks(md).map((b) => b.kind)).toEqual(['pptx'])
  })

  it('una valla SIN cerrar no cuenta como rota (todavía se está escribiendo)', () => {
    expect(extractBrokenDocBlocks('```pptx\n{"slides":[{"title":"a"')).toEqual([])
  })

  it('parseDataBlockDetailed distingue los dos motivos', () => {
    expect(parseDataBlockDetailed('pptx', 'nope')).toEqual({ ok: false, reason: 'json' })
    expect(parseDataBlockDetailed('pptx', '{"slides":[]}')).toEqual({ ok: false, reason: 'schema' })
    expect(parseDataBlockDetailed('pptx', '{"slides":[{"title":"x"}]}').ok).toBe(true)
  })
})
