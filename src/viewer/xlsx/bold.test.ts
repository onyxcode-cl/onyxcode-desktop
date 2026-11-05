import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { read } from 'xlsx'
import { boldCellsOf, hasBoldTag } from './bold'
import { workbookToGrid } from './model'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

interface Opts {
  fonts: string
  xfs: string
  sheet: string
  shared?: string
  cols?: string
  /** Prefijo de espacio de nombres para las etiquetas de la hoja (`x:`), como hacen algunos programas. */
  prefix?: string
}

async function book(o: Opts): Promise<Uint8Array> {
  const z = new JSZip()
  z.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${o.shared ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : ''}</Types>`
  )
  z.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  )
  z.file(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/></sheets></workbook>`
  )
  z.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${o.shared ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : ''}</Relationships>`
  )
  z.file(
    'xl/styles.xml',
    `<?xml version="1.0"?><styleSheet xmlns="${NS}"><fonts count="2">${o.fonts}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs>${o.xfs}</cellXfs></styleSheet>`
  )
  if (o.shared) z.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="${NS}">${o.shared}</sst>`)
  z.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet xmlns="${NS}"><dimension ref="A1:B3"/>${o.cols ?? ''}<sheetData>${o.sheet}</sheetData></worksheet>`
  )
  return z.generateAsync({ type: 'uint8array' })
}

const FONTS = '<font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font>'
const XFS = '<xf fontId="0"/><xf fontId="1" applyFont="1"/>'

async function boldOf(o: Opts): Promise<string[]> {
  const wb = read(await book(o), { type: 'array', dense: true, cellStyles: true, bookFiles: true })
  return [...(boldCellsOf(wb).get('Ventas') ?? [])].sort()
}

describe('negritas del Excel (qué estilo usa cada celda)', () => {
  it('estilo de celda: solo las celdas cuyo estilo apunta a una fuente en negrita', async () => {
    const sheet =
      '<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Día</t></is></c><c r="B1" s="1" t="inlineStr"><is><t>Monto</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Lunes</t></is></c><c r="B2"><v>100</v></c></row><row r="3"><c r="A3" s="1" t="inlineStr"><is><t>Total</t></is></c><c r="B3" s="1"><v>660</v></c></row>'
    expect(await boldOf({ fonts: FONTS, xfs: XFS, sheet })).toEqual(['0,0', '0,1', '2,0', '2,1'])
  })

  it('<b val="0"/> o <b val="false"/> no es negrita, <b val="1"/> y <b val="true"/> sí', () => {
    expect(hasBoldTag('<b val="0"/>')).toBe(false)
    expect(hasBoldTag('<b val="false"/>')).toBe(false)
    expect(hasBoldTag('<b val="1"/>')).toBe(true)
    expect(hasBoldTag('<b val="true"/>')).toBe(true)
    expect(hasBoldTag('<b/>')).toBe(true)
    expect(hasBoldTag('<i/><sz val="11"/>')).toBe(false)
    expect(hasBoldTag('<x:b/>')).toBe(true)
  })

  it('la fuente se busca por su índice, no por el del estilo (xf 0 usa la fuente 1 en negrita)', async () => {
    const sheet = '<row r="1"><c r="A1" s="0" t="inlineStr"><is><t>a</t></is></c><c r="B1" s="1" t="inlineStr"><is><t>b</t></is></c></row>'
    expect(await boldOf({ fonts: FONTS, xfs: '<xf fontId="1"/><xf fontId="0"/>', sheet })).toEqual(['0,0'])
  })

  it('texto enriquecido en textos compartidos: todo en negrita sí, mezclado no', async () => {
    const shared =
      '<si><r><rPr><b/></rPr><t>Total</t></r></si><si><r><rPr><b/></rPr><t>Mitad </t></r><r><t>y mitad</t></r></si><si><t>normal</t></si>'
    const sheet = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
    expect(await boldOf({ fonts: FONTS, xfs: XFS, sheet, shared })).toEqual(['0,0'])
  })

  it('texto enriquecido dentro de la propia hoja (inlineStr)', async () => {
    const sheet =
      '<row r="1"><c r="A1" t="inlineStr"><is><r><rPr><b val="1"/></rPr><t>Gordo</t></r></is></c><c r="B1" t="inlineStr"><is><r><t>flaco</t></r></is></c></row>'
    expect(await boldOf({ fonts: FONTS, xfs: XFS, sheet })).toEqual(['0,0'])
  })

  it('negrita puesta a la columna o a la fila: no se hereda a las celdas que ya existen con estilo propio (como en Excel)', async () => {
    const cols = '<cols><col min="1" max="1" width="12" style="1" customWidth="1"/></cols>'
    const sheet =
      '<row r="1" s="1" customFormat="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="B1" s="1" t="inlineStr"><is><t>y</t></is></c></row>'
    expect(await boldOf({ fonts: FONTS, xfs: XFS, sheet, cols })).toEqual(['0,1'])
  })

  it('etiquetas con prefijo de espacio de nombres (<x:c s="1">) también se leen', async () => {
    const sheet =
      '<x:row r="1"><x:c r="A1" s="1" t="inlineStr"><x:is><x:t>a</x:t></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>b</x:t></x:is></x:c></x:row>'
    expect(await boldOf({ fonts: FONTS, xfs: XFS, sheet })).toEqual(['0,0'])
  })

  it('llega a la cuadrícula: GridCell.bold en las celdas del estilo y en las del texto enriquecido', async () => {
    const shared = '<si><r><rPr><b/></rPr><t>Total</t></r></si>'
    const sheet =
      '<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Día</t></is></c></row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>5</v></c></row>'
    const wb = read(await book({ fonts: FONTS, xfs: XFS, sheet, shared }), {
      type: 'array',
      dense: true,
      cellStyles: true,
      bookFiles: true
    })
    const g = workbookToGrid(wb).sheets[0]
    expect(g.cells[0][0].bold).toBe(true)
    expect(g.cells[1][0].bold).toBe(true)
    expect(g.cells[1][1].bold).toBeUndefined()
  })
})
