/** Chequeos nuevos de `reviewDocument` (aspecto, plantilla, contraste, referencias de Excel) sobre archivos mínimos armados aquí. */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { reviewDocument, reviewSummary } from './review'

const bad = (r: Awaited<ReturnType<typeof reviewDocument>>): string =>
  r.items
    .filter((i) => !i.ok)
    .map((i) => i.text)
    .join(' | ')
const notes = (r: Awaited<ReturnType<typeof reviewDocument>>): string =>
  r.items
    .filter((i) => i.note)
    .map((i) => i.text)
    .join(' | ')

const NS_P =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const sp = (name: string, x: number, y: number, w: number, h: number, text: string, sz = 18, color = '', ph = 'title') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr lang="es" sz="${sz * 100}">${color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : ''}</a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`

async function pptx(shapes: string[], bg = ''): Promise<Buffer> {
  const z = new JSZip()
  z.file('ppt/presentation.xml', '<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>')
  z.file('ppt/slides/slide1.xml', `<p:sld ${NS_P}>${bg}<p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`)
  return z.generateAsync({ type: 'nodebuffer' })
}

describe('PowerPoint: chequeos de aspecto', () => {
  const T = sp('Título', 914400, 914400, 8000000, 800000, 'Ventas del trimestre', 40)
  it('un título bien puesto pasa limpio', async () => {
    const r = await reviewDocument('pptx', await pptx([T, sp('Cuerpo', 914400, 2000000, 8000000, 2000000, 'Subieron 12 %', 18, '', '')]))
    expect(bad(r)).toBe('')
  })
  it('dos textos montados → ✘', async () => {
    const r = await reviewDocument(
      'pptx',
      await pptx([T, sp('Cuerpo', 1000000, 1000000, 8000000, 800000, 'Texto encima del título', 18, '', '')])
    )
    expect(bad(r)).toContain('montados')
  })
  it('letra de menos de 10 pt → ✘; entre 10 y 12 → aviso ℹ', async () => {
    const r = await reviewDocument('pptx', await pptx([T, sp('Nota', 914400, 5000000, 8000000, 300000, 'letra mínima', 8, '', '')]))
    expect(bad(r)).toContain('menos de 10 pt')
    const r2 = await reviewDocument('pptx', await pptx([T, sp('Nota', 914400, 5000000, 8000000, 300000, 'letra chica', 11, '', '')]))
    expect(bad(r2)).toBe('')
    expect(notes(r2)).toContain('menos de 12 pt')
  })
  it('el número de página y los pies de página pueden ser chicos', async () => {
    const r = await reviewDocument(
      'pptx',
      await pptx([
        T,
        sp('N', 914400, 6200000, 800000, 300000, '2 / 9', 8, '', ''),
        sp('Pie', 3000000, 6200000, 3000000, 300000, 'Empresa', 8, '', 'ftr')
      ])
    )
    expect(bad(r)).toBe('')
  })
  it('contraste: gris claro sobre fondo blanco → ✘ con la razón; sobre fondo oscuro pasa', async () => {
    const white = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg>'
    const dark = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="10262B"/></a:solidFill></p:bgPr></p:bg>'
    const body = sp('Cuerpo', 914400, 2000000, 8000000, 1000000, 'Texto suave', 14, 'CCCCCC', '')
    const r = await reviewDocument('pptx', await pptx([T, body], white))
    expect(bad(r)).toContain('Contraste bajo')
    expect(bad(r)).toMatch(/1,6:1 \(mínimo 4,5:1\)/)
    expect(bad(await reviewDocument('pptx', await pptx([T, body], dark)))).toBe('')
  })
  it('restos de plantilla → ✘', async () => {
    const r = await reviewDocument(
      'pptx',
      await pptx([T, sp('Cuerpo', 914400, 2000000, 8000000, 1000000, 'Lorem ipsum dolor sit amet', 18, '', '')])
    )
    expect(bad(r)).toContain('lorem ipsum')
  })
  it('texto pegado al borde → aviso ℹ, no ✘', async () => {
    const r = await reviewDocument(
      'pptx',
      await pptx([T, sp('Cuerpo', 100000, 2000000, 8000000, 1000000, 'Muy a la izquierda', 18, '', '')])
    )
    expect(bad(r)).toBe('')
    expect(notes(r)).toContain('0,3 pulgadas')
  })
})

describe('Word: chequeos nuevos', () => {
  const docx = async (body: string): Promise<Buffer> => {
    const z = new JSZip()
    z.file('word/document.xml', `<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`)
    z.file('word/styles.xml', '<w:styles><w:style w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>')
    return z.generateAsync({ type: 'nodebuffer' })
  }
  const title = '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Informe</w:t></w:r></w:p>'
  it('restos de plantilla, letra chica y contraste bajo → ✘', async () => {
    const r = await reviewDocument(
      'docx',
      await docx(
        title +
          '<w:p><w:r><w:t>Estimado [Nombre]: TODO revisar</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:sz w:val="12"/></w:rPr><w:t>pie diminuto</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:color w:val="DDDDDD"/></w:rPr><w:t>casi invisible</w:t></w:r></w:p>'
      )
    )
    expect(bad(r)).toContain('Restos de plantilla')
    expect(bad(r)).toContain('menos de 8 pt')
    expect(bad(r)).toContain('Contraste bajo')
  })
  it('un documento normal sigue pasando', async () => {
    const r = await reviewDocument('docx', await docx(title + '<w:p><w:r><w:t>Todo salió bien este trimestre.</w:t></w:r></w:p>'))
    expect(bad(r)).toBe('')
  })
})

describe('Excel: chequeos nuevos', () => {
  const xlsx = async (sheet1: string, sheetNames = ['Datos']): Promise<Buffer> => {
    const z = new JSZip()
    z.file(
      'xl/workbook.xml',
      `<workbook xmlns:r="r"><sheets>${sheetNames.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
    )
    z.file(
      'xl/_rels/workbook.xml.rels',
      `<Relationships>${sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`
    )
    sheetNames.forEach((_, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, i === 0 ? sheet1 : '<worksheet><sheetData/></worksheet>'))
    return z.generateAsync({ type: 'nodebuffer' })
  }
  const cell = (ref: string, body: string, t = '') => `<c r="${ref}"${t ? ` t="${t}"` : ''}>${body}</c>`
  const sheet = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`
  it('fórmula que apunta a una hoja inexistente o con #REF! → ✘', async () => {
    const r = await reviewDocument(
      'xlsx',
      await xlsx(sheet(`<row r="1">${cell('A1', '<f>SUM(Resumen!A1:A3)</f><v>1</v>')}${cell('B1', '<f>#REF!+1</f><v>1</v>')}</row>`))
    )
    expect(bad(r)).toContain('la hoja «Resumen» no existe')
    expect(bad(r)).toContain('#REF! dentro de la fórmula')
  })
  it('fórmula que apunta a otra hoja que sí existe pasa', async () => {
    const r = await reviewDocument(
      'xlsx',
      await xlsx(sheet(`<row r="1">${cell('A1', '<f>SUM(Ventas!A1:A3)</f><v>1</v>')}</row>`), ['Datos', 'Ventas'])
    )
    expect(bad(r)).toBe('')
  })
  it('restos de plantilla en una celda de texto inline → ✘', async () => {
    const r = await reviewDocument('xlsx', await xlsx(sheet(`<row r="1">${cell('A1', '<is><t>Lorem ipsum</t></is>', 'inlineStr')}</row>`)))
    expect(bad(r)).toContain('lorem ipsum')
  })
  it('número escrito como texto → aviso ℹ (no en la fila de encabezados)', async () => {
    const r = await reviewDocument(
      'xlsx',
      await xlsx(
        sheet(
          `<row r="1">${cell('A1', '<is><t>2024</t></is>', 'inlineStr')}</row><row r="2">${cell('A2', '<is><t>1250</t></is>', 'inlineStr')}</row>`
        )
      )
    )
    expect(bad(r)).toBe('')
    expect(notes(r)).toContain('1 celda(s) guardan un número como texto')
  })
})

describe('resumen para el agente', () => {
  it('incluye los avisos ℹ y la lista ✔/✘ nueva', async () => {
    const z = new JSZip()
    z.file('ppt/presentation.xml', '<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>')
    z.file(
      'ppt/slides/slide1.xml',
      `<p:sld ${NS_P}><p:cSld><p:spTree>${sp('Título', 914400, 914400, 8000000, 800000, 'Hola', 40)}</p:spTree></p:cSld></p:sld>`
    )
    const txt = await reviewSummary('pptx', await z.generateAsync({ type: 'nodebuffer' }))
    expect(txt).toContain('✔ Sin restos de plantilla')
    expect(txt).toContain('RESULTADO: OK')
  })
})
