import { describe, expect, it } from 'vitest'
import {
  docxContrastProblems,
  docxSmallRuns,
  formulaSheetRefs,
  overlappingPairs,
  pptxBackground,
  pptxContrastProblems,
  pptxTextShapes,
  templateLeftovers,
  textNearEdge
} from './review-checks'

describe('restos de plantilla', () => {
  it('detecta lorem, TODO, TBD, [insertar…], texto de relleno y xxx', () => {
    expect(templateLeftovers('Lorem ipsum dolor sit amet')).toEqual(['lorem ipsum'])
    expect(templateLeftovers('TODO: completar')).toContain('TODO')
    expect(templateLeftovers('Precio TBD')).toContain('TBD')
    expect(templateLeftovers('Estimado [Nombre]:')).toContain('[insertar…]')
    expect(templateLeftovers('[insert logo here]')).toContain('[insertar…]')
    expect(templateLeftovers('Haga clic para agregar título')).toContain('texto de plantilla')
    expect(templateLeftovers('tel. xxxx')).toContain('xxx')
  })
  it('no confunde la palabra «todo» ni texto normal con restos', () => {
    expect(templateLeftovers('Lo hicimos todo bien. Todo el equipo participó; el índice [1] y la nota [a].')).toEqual([])
  })
})

describe('cajas que se montan', () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })
  it('mucho montaje sí; roce y separadas no', () => {
    expect(overlappingPairs([box(0, 0, 100, 100), box(50, 0, 100, 100)])).toEqual([[0, 1]])
    expect(overlappingPairs([box(0, 0, 100, 100), box(95, 0, 100, 100)])).toEqual([])
    expect(overlappingPairs([box(0, 0, 100, 100), box(200, 200, 50, 50)])).toEqual([])
  })
  it('una caja chica dentro de una grande cuenta como montada', () => {
    expect(overlappingPairs([box(0, 0, 500, 500), box(10, 10, 50, 50)])).toEqual([[0, 1]])
  })
})

const sp = (name: string, x: number, y: number, w: number, h: number, runs: string, fill = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>${fill}</p:spPr><p:txBody>${runs}</p:txBody></p:sp>`
const run = (text: string, sz?: number, color?: string, b = false) =>
  `<a:p><a:r><a:rPr lang="es"${sz ? ` sz="${sz * 100}"` : ''}${b ? ' b="1"' : ''}>${color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : ''}</a:rPr><a:t>${text}</a:t></a:r></a:p>`

describe('PowerPoint: formas con texto', () => {
  it('lee caja, tamaño, negrita, color y relleno', () => {
    const xml = sp('Título', 100, 200, 3000, 500, run('Hola', 40, 'FFFFFF', true), '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>')
    const [s] = pptxTextShapes(xml)
    expect(s.name).toBe('Título')
    expect(s.box).toEqual({ x: 100, y: 200, w: 3000, h: 500 })
    expect(s.fill).toBe('112233')
    expect(s.runs[0]).toEqual({ text: 'Hola', sizePt: 40, bold: true, color: 'FFFFFF' })
  })
  it('fondo explícito de la diapositiva', () => {
    expect(pptxBackground('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0e2a2f"/></a:solidFill></p:bgPr></p:bg>')).toBe('0E2A2F')
    expect(pptxBackground('<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>')).toBeNull()
  })
  it('contraste: gris claro sobre blanco falla; blanco sobre oscuro pasa; sin color explícito no se juzga', () => {
    const shapes = [
      ...pptxTextShapes(sp('a', 0, 0, 1, 1, run('suave', 14, 'CCCCCC'))),
      ...pptxTextShapes(sp('b', 0, 0, 1, 1, run('claro', 14, 'FFFFFF'))),
      ...pptxTextShapes(sp('c', 0, 0, 1, 1, run('heredado', 14)))
    ]
    const p = pptxContrastProblems(shapes, 'FFFFFF', 'diapositiva 1')
    expect(p).toHaveLength(2) // CCCCCC y FFFFFF sobre blanco
    expect(p.map((x) => x.where).join()).toContain('suave')
    expect(pptxContrastProblems(shapes, '0E2A2F', 'd')).toHaveLength(0) // claro sobre fondo oscuro: bien
    expect(pptxContrastProblems(shapes, null, 'd')).toHaveLength(0) // fondo desconocido: no se juzga
  })
  it('texto grande exige 3 a 1, no 4,5 a 1', () => {
    const shapes = pptxTextShapes(sp('a', 0, 0, 1, 1, run('grande', 30, '888888')))
    expect(pptxContrastProblems(shapes, 'FFFFFF', 'd')).toHaveLength(0) // #888 sobre blanco ≈ 3,5
  })
})

describe('Word', () => {
  const r = (text: string, color: string, sz = 22) =>
    `<w:r><w:rPr><w:color w:val="${color}"/><w:sz w:val="${sz}"/></w:rPr><w:t>${text}</w:t></w:r>`
  it('contraste contra la página blanca o contra el sombreado de la celda', () => {
    const doc = `<w:p>${r('suave', 'CCCCCC')}</w:p><w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="1F3864"/></w:tcPr><w:p>${r('blanco', 'FFFFFF')}</w:p></w:tc></w:tr></w:tbl>`
    const p = docxContrastProblems(doc)
    expect(p).toHaveLength(1)
    expect(p[0].where).toContain('suave')
  })
  it('letra chica', () => {
    const doc = `<w:p>${r('pie', '000000', 14)}${r('cuerpo', '000000', 22)}</w:p>`
    expect(docxSmallRuns(doc, 8)).toEqual([{ text: 'pie', sizePt: 7 }])
  })
})

describe('Excel: hojas a las que apunta una fórmula', () => {
  it('con y sin comillas, y no cuenta texto entre comillas', () => {
    expect(formulaSheetRefs("SUM(Hoja2!A1:A9)+'Ventas 2026'!B3")).toEqual(['Hoja2', 'Ventas 2026'])
    expect(formulaSheetRefs('IF(A1="Datos!",1,0)')).toEqual([])
    expect(formulaSheetRefs('SUM(A1:A9)')).toEqual([])
  })
})

describe('texto cerca del borde: se mide el texto, no la caja entera', () => {
  const W = 12192000
  const H = 6858000
  const EDGE = 274320
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })
  it('una caja ancha pegada al borde derecho NO avisa si el texto va a la izquierda', () => {
    expect(textNearEdge({ box: box(914400, 914400, W - 914400 - 100000, 500000), align: 'l', anchor: 't' }, W, H, EDGE)).toBe(false)
  })
  it('a la izquierda sí avisa; a la derecha solo con alineación a la derecha', () => {
    expect(textNearEdge({ box: box(100000, 914400, 3000000, 500000), align: 'l', anchor: 't' }, W, H, EDGE)).toBe(true)
    expect(textNearEdge({ box: box(8000000, 914400, W - 8000000 - 100000, 500000), align: 'r', anchor: 't' }, W, H, EDGE)).toBe(true)
    expect(textNearEdge({ box: box(8000000, 914400, W - 8000000 - 100000, 500000), align: 'l', anchor: 't' }, W, H, EDGE)).toBe(false)
  })
  it('centrado o anclado al medio no se mide; arriba y abajo según el anclaje', () => {
    expect(textNearEdge({ box: box(100000, 914400, W - 200000, 500000), align: 'ctr', anchor: 'ctr' }, W, H, EDGE)).toBe(false)
    expect(textNearEdge({ box: box(914400, 50000, 3000000, 500000), align: 'l', anchor: 't' }, W, H, EDGE)).toBe(true)
    expect(textNearEdge({ box: box(914400, 50000, 3000000, 500000), align: 'l', anchor: 'b' }, W, H, EDGE)).toBe(false)
    expect(textNearEdge({ box: box(914400, H - 600000, 3000000, 560000), align: 'l', anchor: 'b' }, W, H, EDGE)).toBe(true)
  })
  it('sin caja no se juzga', () => {
    expect(textNearEdge({ box: null, align: null, anchor: null }, W, H, EDGE)).toBe(false)
  })
})
