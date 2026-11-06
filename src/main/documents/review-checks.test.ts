import { describe, expect, it } from 'vitest'
import {
  docxContrastProblems,
  docxSmallRuns,
  formulaSheetRefs,
  overlappingPairs,
  pptxBackground,
  pptxContrastProblems,
  pptxPanels,
  pptxTextShapes,
  templateLeftovers,
  textExtentBox,
  textNearEdge,
  specGapCells,
  gapCells,
  headingJumps,
  headingStyleIssue,
  countWords,
  listRuns,
  blankRuns,
  slideTitleIssues,
  monotonousLayouts,
  denseBullets,
  percentMisfits,
  sheetShapeIssues
} from './review-checks'

describe('R7: todo viñetas', () => {
  it('4 o más láminas de contenido, todas de viñetas o sin diseño → sí; la portada no cuenta', () => {
    expect(monotonousLayouts([undefined, undefined, 'bullets', undefined, undefined])).toBe(true)
    expect(monotonousLayouts(['stat', 'bullets', 'bullets', 'bullets', 'bullets'])).toBe(true)
  })
  it('menos de 4 láminas de contenido, o alguna de otro tipo → no', () => {
    expect(monotonousLayouts([undefined, undefined, undefined, undefined])).toBe(false)
    expect(monotonousLayouts([undefined, 'bullets', 'stat', 'bullets', 'bullets'])).toBe(false)
  })
})

describe('R10: forma de las hojas', () => {
  it('hoja con solo encabezado → vacía; encabezado de 26 caracteres → largo; 13 columnas → ancha', () => {
    const r = sheetShapeIssues([
      { name: 'Vacía', rows: [['a', 'b']] },
      { name: 'Larga', rows: [['x'.repeat(26), 'b'], [1, 2]] },
      { name: 'Ancha', rows: [Array(13).fill('c'), Array(13).fill(1)] }
    ])
    expect(r.empty).toEqual(['Vacía'])
    expect(r.longHeader).toEqual([`«${'x'.repeat(25)}…» (Larga)`])
    expect(r.wide).toEqual(['Ancha (13 columnas)'])
  })
  it('encabezado de 25 caracteres y 12 columnas no avisan', () => {
    const r = sheetShapeIssues([{ name: 'Ok', rows: [Array(12).fill('c'), Array(12).fill(1)] }])
    expect(r.longHeader).toEqual([])
    expect(r.wide).toEqual([])
    expect(sheetShapeIssues([{ name: 'Ok', rows: [['x'.repeat(25)], [1]] }]).longHeader).toEqual([])
  })
})

describe('R9: porcentaje escrito como entero', () => {
  it('0,22 con formato porcentaje pasa; 22 no; una fórmula o un texto no se juzgan', () => {
    const sh = (rows: unknown[][]) => [{ name: 'Datos', columnFormats: [null, 'percent'], rows }]
    expect(percentMisfits(sh([['Región', 'Cuota'], ['Norte', 0.22]]))).toEqual([])
    expect(percentMisfits(sh([['Región', 'Cuota'], ['Norte', 22]]))).toEqual(['Datos, columna 2 (22)'])
    expect(percentMisfits(sh([['Región', 'Cuota'], ['Norte', { formula: 'B3*2', value: 44 }], ['Sur', '22']]))).toEqual([])
    // sin formato de porcentaje, un 22 es normal
    expect(percentMisfits([{ name: 'Datos', columnFormats: [null, 'integer'], rows: [['a', 'b'], ['x', 22]] }])).toEqual([])
  })
})

describe('R8: lámina cargada', () => {
  it('más de 6 viñetas, o más de 60 palabras entre todas, cargan la lámina', () => {
    expect(denseBullets(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(false)
    expect(denseBullets(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe(true)
    expect(denseBullets([Array(30).fill('p').join(' '), Array(30).fill('p').join(' ')])).toBe(false)
    expect(denseBullets([Array(31).fill('p').join(' '), Array(30).fill('p').join(' ')])).toBe(true)
    expect(denseBullets(undefined)).toBe(false)
  })
})

describe('R6: títulos de diapositiva repetidos o con punto', () => {
  it('el mismo título (sin distinguir mayúsculas) en 2 diapositivas se marca; uno solo no', () => {
    const r = slideTitleIssues(['Resumen', 'resumen ', 'Ventas', null])
    expect(r.repeated).toEqual(['Resumen'])
    expect(slideTitleIssues(['Uno', 'Dos', null]).repeated).toEqual([])
  })
  it('título que termina en punto se marca; sin título (null) no cuenta', () => {
    expect(slideTitleIssues(['Ventas del trimestre.', null, 'Costos']).dotted).toEqual(['Ventas del trimestre.'])
    expect(slideTitleIssues([null, null]).dotted).toEqual([])
  })
})

describe('R5: párrafos vacíos seguidos', () => {
  it('dos o más vacíos seguidos cuentan como un tramo; uno solo no', () => {
    expect(blankRuns([false, true, false])).toBe(0)
    expect(blankRuns([false, true, true, false])).toBe(1)
    expect(blankRuns([true, true, true, false, true, true])).toBe(2)
  })
})

describe('R4: listas largas', () => {
  it('cuenta tramos seguidos del mismo numId; otro párrafo los corta', () => {
    expect(listRuns(['1', '1', '1'])).toEqual([3])
    expect(listRuns(['1', '1', null, '1'])).toEqual([2, 1])
    expect(listRuns(['1', '2', '2'])).toEqual([1, 2])
    expect(listRuns([null, null])).toEqual([])
  })
})

describe('R3: párrafo de cuerpo de más de 140 palabras', () => {
  it('cuenta palabras y deja pasar 140 exactas', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('  uno   dos  ')).toBe(2)
    expect(countWords(Array(140).fill('p').join(' '))).toBe(140)
    expect(countWords(Array(141).fill('p').join(' '))).toBe(141)
  })
})

describe('R1: salto de nivel de encabezado', () => {
  it('1, 2, 3 y 1, 2, 1, 2 no saltan; 1 → 3 sí, y se marca el encabezado que salta', () => {
    expect(headingJumps([1, 2, 3])).toEqual([])
    expect(headingJumps([1, 2, 1, 2])).toEqual([])
    expect(headingJumps([1, 3])).toEqual([1])
    expect(headingJumps([1, 2, 1, 3, 2])).toEqual([3])
  })
  it('bajar de nivel (3 → 1) no es un salto', () => {
    expect(headingJumps([1, 2, 3, 1])).toEqual([])
  })
})

describe('R2: título con punto final o en mayúsculas sostenidas', () => {
  it('termina en punto o va en MAYÚSCULAS (4 letras o más) → aviso', () => {
    expect(headingStyleIssue('Resumen ejecutivo.')).toBe('punto')
    expect(headingStyleIssue('RESUMEN EJECUTIVO')).toBe('mayusculas')
    expect(headingStyleIssue('ÁREAS CLAVE')).toBe('mayusculas')
  })
  it('no dispara con siglas cortas, cifras ni títulos normales', () => {
    expect(headingStyleIssue('KPI')).toBeNull()
    expect(headingStyleIssue('Q3 2026')).toBeNull()
    expect(headingStyleIssue('ROI Q3 2026')).toBeNull()
    expect(headingStyleIssue('Resumen ejecutivo')).toBeNull()
    expect(headingStyleIssue('2026')).toBeNull()
  })
})

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
  it('detecta [PENDIENTE…] y [...] pero no citas normales', () => {
    expect(templateLeftovers('Preparada para: [PENDIENTE: nombre]')).toContain('[PENDIENTE…]')
    expect(templateLeftovers('Monto [por definir]')).toContain('[PENDIENTE…]')
    expect(templateLeftovers('Total [...]')).toContain('[…]')
    expect(templateLeftovers('Según [1] y [Todo el equipo]')).toEqual([])
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
  it('contraste: texto claro sobre un panel oscuro se juzga contra el panel, no contra el fondo claro de la lámina', () => {
    const dark = '<a:solidFill><a:srgbClr val="24170F"/></a:solidFill>'
    const xml =
      sp('Panel', 0, 0, 5000, 5000, '', dark) +
      sp('Sobre el panel', 500, 500, 2000, 800, run('14.000', 40, 'FBF6EE', true)) +
      sp('Fuera del panel', 6000, 500, 2000, 800, run('claro', 40, 'FBF6EE', true))
    const shapes = pptxTextShapes(xml)
    const p = pptxContrastProblems(shapes, 'FBF6EE', 'diapositiva 4', pptxPanels(xml))
    expect(p).toHaveLength(1) // solo el que queda fuera del panel
    expect(p[0].where).toContain('claro')
    // sin paneles (comportamiento anterior) los dos salían mal
    expect(pptxContrastProblems(shapes, 'FBF6EE', 'd')).toHaveLength(2)
  })
  it('contraste: un panel que queda ENCIMA del texto en el apilado no cuenta como su fondo', () => {
    const dark = '<a:solidFill><a:srgbClr val="24170F"/></a:solidFill>'
    const xml = sp('Texto', 500, 500, 2000, 800, run('claro', 40, 'FBF6EE', true)) + sp('Panel', 0, 0, 5000, 5000, '', dark)
    expect(pptxContrastProblems(pptxTextShapes(xml), 'FBF6EE', 'd', pptxPanels(xml))).toHaveLength(1)
  })
  it('textos montados: dos cajas que se tocan pero cuyo texto no se toca no se avisan; si el texto sí llega, sí', () => {
    // Título de 30 pt en una línea dentro de una caja de 1,2 pulgadas, con una etiqueta que empieza a 1,05 pulgadas de su borde alto.
    const title = pptxTextShapes(sp('Title 1', 731520, 914400, 10698480, 1097280, run('Del piloto en Santiago a 1.200 locales en 12 meses', 30)))[0]
    const label = pptxTextShapes(sp('Etiqueta', 731520, 1874520, 3291840, 274320, run('MES 1–2', 12)))[0]
    expect(overlappingPairs([title.box!, label.box!])).toHaveLength(1) // por cajas: aviso falso
    expect(overlappingPairs([textExtentBox(title)!, textExtentBox(label)!])).toHaveLength(0) // por texto: bien
    // Un título largo que sí ocupa 3 líneas llega hasta la etiqueta: se sigue avisando.
    const long = pptxTextShapes(
      sp('Title 1', 731520, 914400, 3000000, 1097280, run('Un título larguísimo que se parte en varias líneas y termina pisando lo de abajo del todo', 30))
    )[0]
    const under = pptxTextShapes(sp('Etiqueta', 731520, 1874520, 3000000, 274320, run('MES 1–2', 12)))[0]
    expect(overlappingPairs([textExtentBox(long)!, textExtentBox(under)!])).toHaveLength(1)
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

describe('cifras que faltan, por estructura', () => {
  it('una celda de texto en una columna de números es una cifra esquivada', () => {
    const r = specGapCells('pptx', { slides: [{ table: { columns: ['Ítem', 'Monto'], rows: [['A', '$100'], ['B', '$200'], ['C', 'Por validar']] } }] })
    expect(r.join()).toContain('Por validar')
  })
  it('no marca columnas de texto ni guiones', () => {
    expect(specGapCells('docx', { blocks: [{ type: 'table', columns: ['A', 'B'], rows: [['x', 'sí'], ['y', 'no']] }] })).toEqual([])
    expect(gapCells(['A', 'B'], [['x', 1], ['y', 2], ['z', '—']])).toEqual([])
  })
  it('xlsx: la primera fila es el encabezado', () => {
    expect(specGapCells('xlsx', { sheets: [{ rows: [['Mes', 'Venta'], ['Ene', 10], ['Feb', 20], ['Mar', 'TBD']] }] }).length).toBe(1)
  })
})
