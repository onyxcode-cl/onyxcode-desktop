import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseXml } from './ooxml'
import {
  buildSlideShapes,
  findGeom,
  matchPlaceholderGeom,
  parseChartXml,
  parseDeck,
  parseLvlDefaultsFrom,
  parseParagraphs,
  parsePlaceholderGeoms,
  parsePresentation,
  parseStaticShapes,
  resolveBackground,
  type PlaceholderGeom
} from './model'

// `happy-dom` tiene un bug real con XML namespaced de verdad (varios hermanos `p:sldId` repetidos se
// pierden y el tagName queda en mayúsculas) — probado contra el .pptx real de la skill, no es una
// suposición. jsdom lo parsea bien; por eso el visor de Word (F2) usa jsdom para su prueba de extremo
// a extremo, y este parser (que depende MUCHO más de XML con namespaces) lo usa para TODO.
let restoreGlobals: () => void
beforeAll(() => {
  const dom = new JSDOM()
  const saved = { DOMParser: globalThis.DOMParser, Document: globalThis.Document }
  Object.assign(globalThis, { DOMParser: dom.window.DOMParser, Document: dom.window.Document })
  restoreGlobals = () => Object.assign(globalThis, saved)
})
afterAll(() => restoreGlobals())

const fixture = (name: string): Buffer => readFileSync(fileURLToPath(new URL(`../__fixtures__/${name}`, import.meta.url)))

describe('parsePresentation', () => {
  it('lee el tamaño de diapositiva y los rId de las diapositivas, en orden', () => {
    const xml = `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>
      <p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId4"/>
    </p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
    expect(parsePresentation(xml)).toEqual({ widthEmu: 12192000, heightEmu: 6858000, slideRIds: ['rId3', 'rId4'] })
  })

  it('sin p:sldSz: usa el tamaño por defecto (4:3) en vez de lanzar', () => {
    const r = parsePresentation('<p:presentation xmlns:p="p"><p:sldIdLst/></p:presentation>')
    expect(r.widthEmu).toBeGreaterThan(0)
    expect(r.heightEmu).toBeGreaterThan(0)
    expect(r.slideRIds).toEqual([])
  })
})

describe('findGeom / matchPlaceholderGeom', () => {
  const geoms: PlaceholderGeom[] = [
    { type: 'title', idx: undefined, xfrm: { xEmu: 1, yEmu: 1, cxEmu: 1, cyEmu: 1 }, lstStyleLvls: {} },
    { type: 'body', idx: '1', xfrm: { xEmu: 2, yEmu: 2, cxEmu: 2, cyEmu: 2 }, lstStyleLvls: {} },
    { type: undefined, idx: '1', xfrm: { xEmu: 3, yEmu: 3, cxEmu: 3, cyEmu: 3 }, lstStyleLvls: {} }
  ]

  it('coincide por type+idx cuando el slide no da type pero sí idx (type+idx exacto, con type undefined en ambos)', () => {
    // el de la skill: slide da <p:ph idx="1"/> (sin type) y el layout tiene <p:ph idx="1"/> (sin type) también
    expect(matchPlaceholderGeom(geoms, undefined, '1')?.xEmu).toBe(3)
  })

  it('coincide por type solo cuando no hay idx', () => {
    expect(matchPlaceholderGeom(geoms, 'title', undefined)?.xEmu).toBe(1)
  })

  it('sin ninguna coincidencia: undefined, no lanza', () => {
    expect(matchPlaceholderGeom(geoms, 'ctrTitle', '9')).toBeUndefined()
    expect(findGeom(geoms, 'ctrTitle', '9')).toBeUndefined()
  })
})

describe('parseLvlDefaultsFrom', () => {
  it('lee tamaño/negrita/viñeta de cada nivel; buNone gana sobre no-declarado', () => {
    const doc = parseXml(`<a:x xmlns:a="a">
      <a:lvl1pPr><a:buChar char="&#8226;"/><a:defRPr sz="2400" b="1"/></a:lvl1pPr>
      <a:lvl2pPr><a:buNone/><a:defRPr sz="1800"/></a:lvl2pPr>
    </a:x>`)
    const defaults = parseLvlDefaultsFrom(doc.documentElement)
    expect(defaults[0]).toEqual({ sizePt: 24, bold: true, bulleted: true })
    expect(defaults[1]).toEqual({ sizePt: 18, bold: false, bulleted: false })
    expect(defaults[2]).toBeUndefined()
  })

  it('sin contenedor: objeto vacío, no lanza', () => {
    expect(parseLvlDefaultsFrom(null)).toEqual({})
  })
})

describe('parseParagraphs', () => {
  it('el texto explícito del run pisa el valor por defecto del nivel; lo que falta, hereda', () => {
    const txBody = parseXml(`<p:txBody xmlns:p="p" xmlns:a="a">
      <a:p><a:r><a:rPr b="0" sz="1200"/><a:t>chico</a:t></a:r><a:r><a:rPr/><a:t> y normal</a:t></a:r></a:p>
    </p:txBody>`).documentElement
    const [para] = parseParagraphs(txBody, () => ({ sizePt: 24, bold: true, bulleted: true }), {}, {})
    expect(para.runs[0]).toMatchObject({ text: 'chico', bold: false, sizePt: 12 })
    expect(para.runs[1]).toMatchObject({ text: ' y normal', bold: true, sizePt: 24 })
    expect(para.bulleted).toBe(true)
  })

  it('a:buNone en el propio párrafo apaga la viñeta aunque el nivel la traiga por defecto', () => {
    const txBody = parseXml(
      `<p:txBody xmlns:p="p" xmlns:a="a"><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>x</a:t></a:r></a:p></p:txBody>`
    ).documentElement
    const [para] = parseParagraphs(txBody, () => ({ bulleted: true }), {}, {})
    expect(para.bulleted).toBe(false)
  })

  it('cada párrafo usa SU PROPIO nivel (sub-viñetas), no el del primer párrafo del cuerpo', () => {
    const txBody = parseXml(
      `<p:txBody xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>nivel 0</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>nivel 1</a:t></a:r></a:p></p:txBody>`
    ).documentElement
    const levels: number[] = []
    const [p0, p1] = parseParagraphs(
      txBody,
      (level) => {
        levels.push(level)
        return {}
      },
      {},
      {}
    )
    expect(p0.level).toBe(0)
    expect(p1.level).toBe(1)
    expect(levels).toEqual([0, 1])
  })

  it('sin a:txBody: arreglo vacío, no lanza', () => {
    expect(parseParagraphs(null, () => ({}), {}, {})).toEqual([])
  })

  it('a:spcAft > a:spcPts@val (centésimas de punto) se lee como spaceAfterPt — bug real: nunca se leía, las viñetas salían más apretadas que en PowerPoint (sin el "paraSpaceAfter" que pide render-pptx.ts)', () => {
    const txBody = parseXml(
      `<p:txBody xmlns:p="p" xmlns:a="a"><a:p><a:pPr><a:spcAft><a:spcPts val="1200"/></a:spcAft></a:pPr><a:r><a:t>x</a:t></a:r></a:p></p:txBody>`
    ).documentElement
    const [para] = parseParagraphs(txBody, () => ({}), {}, {})
    expect(para.spaceAfterPt).toBe(12)
  })

  it('sin a:spcAft: spaceAfterPt queda undefined', () => {
    const txBody = parseXml(`<p:txBody xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody>`).documentElement
    const [para] = parseParagraphs(txBody, () => ({}), {}, {})
    expect(para.spaceAfterPt).toBeUndefined()
  })

  it('a:latin typeface se lee como la fuente del run — bug real: nunca se leía, todo el texto salía con la fuente por defecto del navegador sin importar el tema (Georgia/Arial)', () => {
    const txBody = parseXml(
      `<p:txBody xmlns:p="p" xmlns:a="a"><a:p><a:r><a:rPr><a:latin typeface="Georgia"/></a:rPr><a:t>x</a:t></a:r></a:p></p:txBody>`
    ).documentElement
    const [para] = parseParagraphs(txBody, () => ({}), {}, {})
    expect(para.runs[0].font).toBe('Georgia')
  })

  it('un typeface placeholder de tema (+mj-lt/+mn-lt, sin resolver contra el fontScheme) NO se usa tal cual como nombre de fuente', () => {
    const txBody = parseXml(
      `<p:txBody xmlns:p="p" xmlns:a="a"><a:p><a:r><a:rPr><a:latin typeface="+mj-lt"/></a:rPr><a:t>x</a:t></a:r></a:p></p:txBody>`
    ).documentElement
    const [para] = parseParagraphs(txBody, () => ({}), {}, {})
    expect(para.runs[0].font).toBeUndefined()
  })

  it('spc de a:rPr (centésimas de punto, igual que sz) se lee como letterSpacingPt — bug real: nunca se leía, la etiqueta tipo "CIFRA DESTACADA" salía sin el espaciado entre letras que la hace lucir "diseñada"', () => {
    const txBody = parseXml(
      `<p:txBody xmlns:p="p" xmlns:a="a"><a:p><a:r><a:rPr spc="300"/><a:t>x</a:t></a:r></a:p></p:txBody>`
    ).documentElement
    const [para] = parseParagraphs(txBody, () => ({}), {}, {})
    expect(para.runs[0].letterSpacingPt).toBe(3)
  })

  it('sin spc: letterSpacingPt queda undefined, no 0 (0 también sería un letter-spacing válido, distinto de "no se especificó")', () => {
    const txBody = parseXml(`<p:txBody xmlns:p="p" xmlns:a="a"><a:p><a:r><a:rPr/><a:t>x</a:t></a:r></a:p></p:txBody>`).documentElement
    const [para] = parseParagraphs(txBody, () => ({}), {}, {})
    expect(para.runs[0].letterSpacingPt).toBeUndefined()
  })
})

describe('resolveBackground', () => {
  const cSld = (bgXml: string): Document => parseXml(`<p:cSld xmlns:p="p" xmlns:a="a">${bgXml}</p:cSld>`)
  const withBg = (color: string): Document => cSld(`<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:bgPr></p:bg>`)
  const noBg = (): Document => cSld('')

  it('la diapositiva trae su propio fondo: ese gana, sin mirar layout ni maestro', () => {
    expect(resolveBackground(withBg('1E2761'), withBg('F00000'), withBg('00FF00'), {}, {})).toBe('#1E2761')
  })

  it('sin fondo propio: hereda del layout', () => {
    expect(resolveBackground(noBg(), withBg('2D4A9A'), withBg('00FF00'), {}, {})).toBe('#2D4A9A')
  })

  it('sin fondo propio NI en el layout: hereda del maestro', () => {
    expect(resolveBackground(noBg(), noBg(), withBg('173A2C'), {}, {})).toBe('#173A2C')
  })

  it('sin fondo en ningún nivel (o sin layout/maestro): undefined, no lanza — el visor cae a blanco', () => {
    expect(resolveBackground(noBg(), noBg(), noBg(), {}, {})).toBeUndefined()
    expect(resolveBackground(noBg(), undefined, undefined, {}, {})).toBeUndefined()
  })
})

describe('buildSlideShapes', () => {
  const baseCtx = {
    widthEmu: 1000,
    heightEmu: 1000,
    layoutGeoms: [],
    masterGeoms: [],
    titleLvls: {},
    bodyLvls: {},
    scheme: {},
    colorMap: {}
  }

  it('una forma desconocida (p:cxnSp) da kind "unknown" con geometría, sin lanzar', () => {
    const doc = parseXml(`<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:cxnSp><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:cxnSp>
    </p:spTree></p:cSld></p:sld>`)
    const [shape] = buildSlideShapes(doc, baseCtx)
    expect(shape.kind).toBe('unknown')
    expect(shape.xPct).toBe(10)
  })

  it('un gráfico (p:graphicFrame sin a:tbl) también da "unknown", no se confunde con una tabla', () => {
    const doc = parseXml(`<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="500" cy="500"/></p:xfrm>
        <a:graphic><a:graphicData uri="chart"/></a:graphic></p:graphicFrame>
    </p:spTree></p:cSld></p:sld>`)
    const [shape] = buildSlideShapes(doc, baseCtx)
    expect(shape.kind).toBe('unknown')
  })

  it('una imagen da kind "picture" con un marcador de rId pendiente de resolver', () => {
    const doc = parseXml(`<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>
      <p:pic><p:blipFill><a:blip r:embed="rId7"/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:pic>
    </p:spTree></p:cSld></p:sld>`)
    const [shape] = buildSlideShapes(doc, baseCtx)
    expect(shape.kind).toBe('picture')
    expect(shape.kind === 'picture' && shape.dataUrl).toBe('__rid__:rId7')
  })

  it('una tabla simple da kind "table" con filas y celdas con texto, en su posición REAL (no la cajita de respaldo — bug real: `p:xfrm` de un graphicFrame no está envuelto en otro `a:xfrm`, `readXfrm` siempre daba null ahí)', () => {
    const doc = parseXml(`<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:graphicFrame><p:xfrm><a:off x="200" y="300"/><a:ext cx="400" cy="100"/></p:xfrm>
        <a:graphic><a:graphicData><a:tbl>
          <a:tr><a:tc><a:txBody><a:p><a:r><a:t>uno</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>dos</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
        </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
    </p:spTree></p:cSld></p:sld>`)
    const [shape] = buildSlideShapes(doc, baseCtx)
    expect(shape.kind).toBe('table')
    expect(shape.kind === 'table' && shape.rows[0].map((c) => c.paragraphs[0].runs[0].text)).toEqual(['uno', 'dos'])
    expect({ xPct: shape.xPct, yPct: shape.yPct, wPct: shape.wPct, hPct: shape.hPct }).toEqual({ xPct: 20, yPct: 30, wPct: 40, hPct: 10 })
  })

  it('un gráfico de verdad (p:graphicFrame con c:chart) da kind "chart" con el rId pendiente de resolver, en su posición real', () => {
    const doc = parseXml(`<p:sld xmlns:p="p" xmlns:a="a" xmlns:c="c" xmlns:r="r"><p:cSld><p:spTree>
      <p:graphicFrame><p:xfrm><a:off x="100" y="100"/><a:ext cx="500" cy="500"/></p:xfrm>
        <a:graphic><a:graphicData uri="chart"><c:chart r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>
    </p:spTree></p:cSld></p:sld>`)
    const [shape] = buildSlideShapes(doc, baseCtx)
    expect(shape.kind).toBe('chart')
    expect(shape.kind === 'chart' && shape.chartRid).toBe('rId3')
    expect(shape.xPct).toBe(10)
  })

  it('geometría de la forma (prst): "ellipse"/"roundRect" se guardan, "rect" (o sin prstGeom) queda sin geom', () => {
    const shapeWith = (prst: string): string => `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
        <a:prstGeom prst="${prst}"/></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sld>`
    const ellipse = buildSlideShapes(parseXml(shapeWith('ellipse')), baseCtx)[0]
    const round = buildSlideShapes(parseXml(shapeWith('roundRect')), baseCtx)[0]
    const rect = buildSlideShapes(parseXml(shapeWith('rect')), baseCtx)[0]
    expect(ellipse.kind === 'shape' && ellipse.geom).toBe('ellipse')
    expect(round.kind === 'shape' && round.geom).toBe('roundRect')
    expect(rect.kind === 'shape' && rect.geom).toBeUndefined()
  })

  it('anchor de a:bodyPr ("t"/"ctr"/"b") se guarda — bug real: nunca se leía, un título pensado para apoyarse abajo de su caja (p.ej. la portada) salía arriba, con un hueco raro debajo', () => {
    const shapeWithAnchor = (anchor: string): string => `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr anchor="${anchor}"/></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`
    const bottom = buildSlideShapes(parseXml(shapeWithAnchor('b')), baseCtx)[0]
    const center = buildSlideShapes(parseXml(shapeWithAnchor('ctr')), baseCtx)[0]
    expect(bottom.kind === 'shape' && bottom.anchor).toBe('b')
    expect(center.kind === 'shape' && center.anchor).toBe('ctr')
  })

  it('sin a:bodyPr (o sin anchor): undefined, no lanza — el visor cae a alinear arriba', () => {
    const doc = parseXml(`<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sld>`)
    const [shape] = buildSlideShapes(doc, baseCtx)
    expect(shape.kind === 'shape' && shape.anchor).toBeUndefined()
  })

  it('una forma SIN relleno pero con contorno (p.ej. el círculo "insignia" del layout "stat") trae `stroke` — con relleno, nunca (sería ruido visual que PowerPoint no muestra así)', () => {
    const withStroke = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
        <a:noFill/><a:ln><a:solidFill><a:srgbClr val="1E2761"/></a:solidFill></a:ln></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sld>`
    const filledWithLine = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
        <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
        <a:ln><a:solidFill><a:srgbClr val="1E2761"/></a:solidFill></a:ln></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sld>`
    const strokeOnly = buildSlideShapes(parseXml(withStroke), baseCtx)[0]
    const filled = buildSlideShapes(parseXml(filledWithLine), baseCtx)[0]
    expect(strokeOnly.kind === 'shape' && strokeOnly.stroke).toBe('#1E2761')
    expect(filled.kind === 'shape' && filled.stroke).toBeUndefined()
  })

  it('una diapositiva vacía da un arreglo vacío', () => {
    const doc = parseXml(`<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld></p:sld>`)
    expect(buildSlideShapes(doc, baseCtx)).toEqual([])
  })
})

describe('parseChartXml', () => {
  const barXml = `<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea><c:barChart><c:ser>
    <c:cat><c:strRef><c:strCache>
      <c:pt idx="1"><c:v>Feb</c:v></c:pt><c:pt idx="0"><c:v>Ene</c:v></c:pt>
    </c:strCache></c:strRef></c:cat>
    <c:val><c:numRef><c:numCache>
      <c:pt idx="1"><c:v>20</c:v></c:pt><c:pt idx="0"><c:v>10</c:v></c:pt>
    </c:numCache></c:numRef></c:val>
  </c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`

  it('gráfico de barras: categorías/valores en orden de `idx`, no de aparición en el xml', () => {
    expect(parseChartXml(barXml)).toEqual({ type: 'bar', categories: ['Ene', 'Feb'], values: [10, 20] })
  })

  it('categorías con multiLvlStrRef (lo que escribe pptxgenjs cuando podrían confundirse con fecha/número) también se leen', () => {
    const xml = `<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea><c:pieChart><c:ser>
      <c:cat><c:multiLvlStrRef><c:multiLvlStrCache><c:lvl>
        <c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt>
      </c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat>
      <c:val><c:numRef><c:numCache>
        <c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt>
      </c:numCache></c:numRef></c:val>
    </c:ser></c:pieChart></c:plotArea></c:chart></c:chartSpace>`
    expect(parseChartXml(xml)).toEqual({ type: 'pie', categories: ['A', 'B'], values: [1, 2] })
  })

  it('colores REALES por punto (c:dPt/c:spPr) — lo que pinta render-pptx.ts vía `chartColors`, no una paleta inventada por el visor', () => {
    const xml = `<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea><c:barChart><c:ser>
      <c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Ene</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt></c:strCache></c:strRef></c:cat>
      <c:dPt><c:idx val="0"/><c:spPr><a:solidFill><a:srgbClr val="3A3A3A"/></a:solidFill></c:spPr></c:dPt>
      <c:dPt><c:idx val="1"/><c:spPr><a:solidFill><a:srgbClr val="1A1A1A"/></a:solidFill></c:spPr></c:dPt>
      <c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
    </c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`
    expect(parseChartXml(xml)?.colors).toEqual(['#3A3A3A', '#1A1A1A'])
  })

  it('sin c:dPt, el color de toda la serie (c:ser > c:spPr) se repite en cada punto', () => {
    const xml = `<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea><c:lineChart><c:ser>
      <c:spPr><a:solidFill><a:srgbClr val="2D4A9A"/></a:solidFill></c:spPr>
      <c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Ene</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt></c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>5</c:v></c:pt><c:pt idx="1"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val>
    </c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>`
    expect(parseChartXml(xml)?.colors).toEqual(['#2D4A9A', '#2D4A9A'])
  })

  it('sin ningún color (ni c:dPt ni c:ser > c:spPr): `colors` queda undefined, el visor cae a su paleta de respaldo', () => {
    expect(parseChartXml(barXml)?.colors).toBeUndefined()
  })

  it('sin un tipo de gráfico reconocido, o sin categorías/valores: undefined, no lanza', () => {
    expect(parseChartXml('<c:chartSpace xmlns:c="c"><c:chart><c:plotArea/></c:chart></c:chartSpace>')).toBeUndefined()
    expect(parseChartXml('no es xml')).toBeUndefined()
  })
})

describe('parsePlaceholderGeoms', () => {
  it('toma el override de nivel propio del placeholder (a:lstStyle), no solo su xfrm', () => {
    const doc = parseXml(`<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="subTitle"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="1" y="1"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr>
        <p:txBody><a:lstStyle><a:lvl1pPr><a:buNone/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`)
    const [geom] = parsePlaceholderGeoms(doc)
    expect(geom.type).toBe('subTitle')
    expect(geom.lstStyleLvls[0]?.bulleted).toBe(false)
  })
})

describe('parseStaticShapes', () => {
  it('pinta una forma decorativa del maestro (sin p:ph), como la barra de color de la skill', () => {
    const doc = parseXml(`<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="9" name="Barra"/><p:nvPr userDrawn="1"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="180000"/></a:xfrm>
          <a:solidFill><a:srgbClr val="2F5496"/></a:solidFill></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldMaster>`)
    const [shape] = parseStaticShapes(doc, 12192000, 6858000, {}, {})
    expect(shape.kind).toBe('shape')
    expect(shape.kind === 'shape' && shape.fill).toBe('#2F5496')
    expect(shape.hPct).toBeCloseTo((180000 / 6858000) * 100, 5)
  })

  it('un placeholder (con p:ph) NO se cuenta como decorativo: ya lo pinta buildSlideShapes', () => {
    const doc = parseXml(`<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`)
    expect(parseStaticShapes(doc, 1000, 1000, {}, {})).toEqual([])
  })

  it('sin a:xfrm propio: se descarta (no hay dónde pintarla), no lanza', () => {
    const doc = parseXml(`<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="1" name="sin posición"/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>
    </p:spTree></p:cSld></p:sldMaster>`)
    expect(parseStaticShapes(doc, 1000, 1000, {}, {})).toEqual([])
  })
})

describe('parseDeck con el .pptx real de la skill (3 diapositivas: portada + 2 de contenido)', () => {
  let deck: Awaited<ReturnType<typeof parseDeck>>
  beforeAll(async () => {
    const zip = await JSZip.loadAsync(fixture('sample.pptx'))
    deck = await parseDeck(zip)
  })

  it('3 diapositivas, tamaño 16:9 real del archivo', () => {
    expect(deck.slides).toHaveLength(3)
    expect(deck.widthEmu).toBe(12192000)
    expect(deck.heightEmu).toBe(6858000)
  })

  it('la barra de color del maestro (decorativa, sin placeholder) se pinta en todas las diapositivas, al fondo', () => {
    for (const slide of deck.slides) {
      const bar = slide.shapes[0]
      expect(bar.kind).toBe('shape')
      expect(bar.kind === 'shape' && bar.fill).toBe('#2F5496')
      expect(bar.wPct).toBeCloseTo(100, 0)
    }
  })

  it('portada: título en negrita grande y subtítulo SIN viñeta (el layout lo apaga)', () => {
    const [, title, subtitle] = deck.slides[0].shapes
    expect(title.kind === 'shape' && title.paragraphs[0].runs[0]).toMatchObject({
      text: 'Resultados del tercer trimestre',
      bold: true,
      sizePt: 36
    })
    expect(subtitle.kind === 'shape' && subtitle.paragraphs[0].bulleted).toBe(false)
  })

  it('diapositiva de contenido: cada viñeta del cuerpo es su propio párrafo, con viñeta', () => {
    const body = deck.slides[1].shapes[2]
    expect(body.kind === 'shape' && body.paragraphs).toHaveLength(3)
    expect(body.kind === 'shape' && body.paragraphs.every((p) => p.bulleted)).toBe(true)
  })

  it('las dos diapositivas de contenido usan el layout de contenido (mismo x/ancho de título)', () => {
    const t1 = deck.slides[1].shapes[1]
    const t2 = deck.slides[2].shapes[1]
    expect(t1.xPct).toBeCloseTo(t2.xPct, 5)
    expect(t1.wPct).toBeCloseTo(t2.wPct, 5)
  })
})
