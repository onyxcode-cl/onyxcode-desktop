/**
 * Parser estructural de PowerPoint (Fase 4 del plan del visor): SIN dependencias nuevas (reusa
 * `jszip`, que ya trae `docx-preview`). No es un render fiel de PowerPoint — es una vista
 * ESTRUCTURAL: posición/tamaño (`a:xfrm`, con herencia de layout y maestro), texto con tamaño/
 * negrita/color/viñetas, rellenos sólidos, imágenes (como `data:`) y tablas simples. Una forma que
 * no se reconoce (gráfico, SmartArt, OLE…) se muestra como un recuadro vacío, nunca rompe el render
 * de las demás.
 */
import type JSZip from 'jszip'
import {
  attrNum,
  descendant,
  directChild,
  directChildren,
  emuToPercent,
  parseRels,
  parseXml,
  readXfrm,
  readXfrmDirect,
  resolveRelPath,
  type XfrmEmu
} from './ooxml'
import { bgOf, parseColorMap, parseColorScheme, solidFillOf, strokeOf, type ColorScheme } from './theme'

export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  color?: string
  sizePt?: number
  /** `<a:latin typeface="…">` tal cual — un nombre de fuente de verdad (p.ej. "Georgia"), nunca un placeholder de tema (`+mj-lt`/`+mn-lt`, que esta vista estructural no resuelve). */
  font?: string
  /** `spc` de `a:rPr`, en puntos (ya dividido por 100 — en el XML viene en centésimas, igual que `sz`) — el espaciado entre letras de una etiqueta tipo "CIFRA DESTACADA". */
  letterSpacingPt?: number
}
export interface TextParagraph {
  runs: TextRun[]
  level: number
  align?: 'l' | 'ctr' | 'r'
  bulleted: boolean
  /** `a:pPr > a:spcAft > a:spcPts@val`, en puntos (ya dividido por 100) — el espacio DESPUÉS de este párrafo (el "paraSpaceAfter" entre viñetas de `render-pptx.ts`). Sin esto, las viñetas salían más apretadas que en PowerPoint. */
  spaceAfterPt?: number
}
export interface TableCell {
  paragraphs: TextParagraph[]
}
/** `<a:prstGeom prst="…">` de la forma — solo las que cambian cómo se dibuja ("rect", la más común,
 * es el rectángulo de siempre y no necesita trackearse aparte: ver `geomOf`). Vista estructural, no
 * todas las geometrías de PowerPoint están cubiertas, pero ellipse/roundRect son las que usa nuestro
 * propio generador. */
export type ShapeGeom = 'ellipse' | 'roundRect'
export type ChartKind = 'bar' | 'line' | 'pie'
export interface ChartData {
  type: ChartKind
  categories: string[]
  values: number[]
  /** Un color por punto, en el MISMO orden que `values` — del `.pptx` real (`c:dPt`/`c:spPr`), no una paleta inventada por el visor. `undefined` si el gráfico no trae colores propios por punto. */
  colors?: string[]
}
export type Shape =
  | {
      kind: 'shape'
      xPct: number
      yPct: number
      wPct: number
      hPct: number
      fill?: string
      /** Color del contorno — solo importa pintarlo cuando NO hay `fill` (si no, un borde de 1-2px es ruido visual que PowerPoint no muestra así). */
      stroke?: string
      geom?: ShapeGeom
      /** `anchor` de `<a:bodyPr>` — dónde se ancla el texto DENTRO de la caja (t=arriba, ctr=medio, b=abajo). Sin esto, un título pensado para apoyarse abajo de una caja alta (p.ej. la portada) salía arriba, con un hueco raro debajo. */
      anchor?: 't' | 'ctr' | 'b'
      paragraphs: TextParagraph[]
    }
  | { kind: 'picture'; xPct: number; yPct: number; wPct: number; hPct: number; dataUrl?: string }
  | { kind: 'table'; xPct: number; yPct: number; wPct: number; hPct: number; rows: TableCell[][] }
  | { kind: 'chart'; xPct: number; yPct: number; wPct: number; hPct: number; chartRid?: string; chart?: ChartData }
  | { kind: 'unknown'; xPct: number; yPct: number; wPct: number; hPct: number }

export interface Slide {
  shapes: Shape[]
  /** `undefined` = sin color de fondo propio en ningún nivel (diapositiva/layout/maestro) — el visor usa blanco. */
  background?: string
}
export interface Deck {
  slides: Slide[]
  widthEmu: number
  heightEmu: number
}

const DEFAULT_WIDTH_EMU = 9144000
const DEFAULT_HEIGHT_EMU = 6858000
const FALLBACK_XFRM: XfrmEmu = { xEmu: 914400, yEmu: 914400, cxEmu: 3048000, cyEmu: 2032000 }

export interface LevelDefaults {
  sizePt?: number
  bold?: boolean
  bulleted?: boolean
}

export interface PlaceholderGeom {
  type?: string
  idx?: string
  xfrm?: XfrmEmu
  /** Override de nivel propio del placeholder (`<p:txBody><a:lstStyle>`), p. ej. el subtítulo de
   * portada suele traer `buNone` ahí aunque el cuerpo del maestro use viñetas por defecto. */
  lstStyleLvls: Record<number, LevelDefaults>
}

export function parsePresentation(xml: string): { widthEmu: number; heightEmu: number; slideRIds: string[] } {
  const doc = parseXml(xml)
  const sldSz = doc.getElementsByTagName('p:sldSz')[0] ?? null
  const widthEmu = attrNum(sldSz, 'cx') ?? DEFAULT_WIDTH_EMU
  const heightEmu = attrNum(sldSz, 'cy') ?? DEFAULT_HEIGHT_EMU
  const slideRIds = directChildren(doc.getElementsByTagName('p:sldIdLst')[0] ?? null, 'p:sldId')
    .map((el) => el.getAttribute('r:id'))
    .filter((id): id is string => !!id)
  return { widthEmu, heightEmu, slideRIds }
}

function phOf(sp: Element): { type?: string; idx?: string } {
  const ph = descendant(directChild(sp, 'p:nvSpPr'), 'p:ph')
  return { type: ph?.getAttribute('type') ?? undefined, idx: ph?.getAttribute('idx') ?? undefined }
}

/** Niveles 1..9 de un contenedor `a:lvlNpPr` (el `p:titleStyle`/`p:bodyStyle` del maestro, o el
 * `<a:lstStyle>` propio de un placeholder de layout) → valores por defecto por nivel (0-based). */
export function parseLvlDefaultsFrom(container: Element | null): Record<number, LevelDefaults> {
  const out: Record<number, LevelDefaults> = {}
  if (!container) return out
  for (let n = 1; n <= 9; n++) {
    const lvlEl = directChild(container, `a:lvl${n}pPr`)
    if (!lvlEl) continue
    const defRPr = directChild(lvlEl, 'a:defRPr')
    const sizeAttr = attrNum(defRPr, 'sz')
    const buNone = directChildren(lvlEl, 'a:buNone').length > 0
    const buExplicit = directChildren(lvlEl, 'a:buChar').length > 0 || directChildren(lvlEl, 'a:buAutoNum').length > 0
    out[n - 1] = {
      sizePt: sizeAttr !== undefined ? sizeAttr / 100 : undefined,
      bold: defRPr?.getAttribute('b') === '1',
      bulleted: buNone ? false : buExplicit ? true : undefined
    }
  }
  return out
}

/** `p:titleStyle`/`p:bodyStyle` del maestro → valores por defecto por nivel (0-based). */
export function parseLvlDefaults(masterDoc: Document, styleTag: 'p:titleStyle' | 'p:bodyStyle'): Record<number, LevelDefaults> {
  return parseLvlDefaultsFrom(masterDoc.getElementsByTagName(styleTag)[0] ?? null)
}

/** Geometrías (y overrides de nivel propios) de los placeholders de un layout o maestro. */
export function parsePlaceholderGeoms(doc: Document): PlaceholderGeom[] {
  const spTree = doc.getElementsByTagName('p:spTree')[0] ?? null
  const out: PlaceholderGeom[] = []
  for (const sp of directChildren(spTree, 'p:sp')) {
    const xfrm = readXfrm(directChild(sp, 'p:spPr')) ?? undefined
    const lstStyle = directChild(directChild(sp, 'p:txBody'), 'a:lstStyle')
    const lstStyleLvls = parseLvlDefaultsFrom(lstStyle)
    if (!xfrm && Object.keys(lstStyleLvls).length === 0) continue
    out.push({ ...phOf(sp), xfrm, lstStyleLvls })
  }
  return out
}

export function findGeom(geoms: PlaceholderGeom[], type: string | undefined, idx: string | undefined): PlaceholderGeom | undefined {
  if (type !== undefined || idx !== undefined) {
    const both = geoms.find((g) => g.type === type && g.idx === idx)
    if (both) return both
  }
  if (idx !== undefined) {
    const byIdx = geoms.find((g) => g.idx === idx)
    if (byIdx) return byIdx
  }
  if (type !== undefined) {
    const byType = geoms.find((g) => g.type === type)
    if (byType) return byType
  }
  return undefined
}

/** Coincidencia de placeholder de OOXML, simplificada: primero por type+idx, luego por idx, luego por type. */
export function matchPlaceholderGeom(geoms: PlaceholderGeom[], type: string | undefined, idx: string | undefined): XfrmEmu | undefined {
  return findGeom(geoms, type, idx)?.xfrm
}

const TITLE_TYPES = new Set(['title', 'ctrTitle'])

/** Nivel efectivo: el override del placeholder del layout pisa al del maestro, que pisa el de reserva
 * (`fallbackBulleted`: false para título, true para cuerpo — PowerPoint nunca pone viñeta en el
 * título aunque ningún `a:lvlNpPr` lo diga explícitamente). */
function lvlDefaultsFor(
  masterLvls: Record<number, LevelDefaults>,
  layoutOverride: Record<number, LevelDefaults> | undefined,
  level: number,
  fallbackBulleted: boolean
): LevelDefaults {
  const master = masterLvls[level]
  const layout = layoutOverride?.[level]
  return {
    sizePt: layout?.sizePt ?? master?.sizePt ?? 18,
    bold: layout?.bold ?? master?.bold ?? false,
    bulleted: layout?.bulleted ?? master?.bulleted ?? fallbackBulleted
  }
}

export function parseParagraphs(
  txBody: Element | null,
  levelDefaultsFn: (level: number) => LevelDefaults,
  scheme: ColorScheme,
  colorMap: Record<string, string>
): TextParagraph[] {
  if (!txBody) return []
  return directChildren(txBody, 'a:p').map((p) => {
    const pPr = directChild(p, 'a:pPr')
    const level = attrNum(pPr, 'lvl') ?? 0
    const lvlDefaults = levelDefaultsFn(level)
    const align = (pPr?.getAttribute('algn') as 'l' | 'ctr' | 'r' | null) ?? undefined
    const buNone = directChildren(pPr, 'a:buNone').length > 0
    const buExplicit = directChildren(pPr, 'a:buChar').length > 0 || directChildren(pPr, 'a:buAutoNum').length > 0
    const bulleted = buNone ? false : buExplicit ? true : (lvlDefaults.bulleted ?? false)
    const spcAftAttr = attrNum(directChild(directChild(pPr, 'a:spcAft'), 'a:spcPts'), 'val')
    const spaceAfterPt = spcAftAttr !== undefined ? spcAftAttr / 100 : undefined
    const runs: TextRun[] = directChildren(p, 'a:r').map((r) => {
      const rPr = directChild(r, 'a:rPr')
      const text = directChild(r, 'a:t')?.textContent ?? ''
      const boldAttr = rPr?.getAttribute('b')
      const bold = boldAttr === '1' ? true : boldAttr === '0' ? false : lvlDefaults.bold
      const italicAttr = rPr?.getAttribute('i')
      const italic = italicAttr === '1' ? true : undefined
      const sizeAttr = attrNum(rPr, 'sz')
      const sizePt = sizeAttr !== undefined ? sizeAttr / 100 : lvlDefaults.sizePt
      const color = solidFillOf(rPr, scheme, colorMap)
      const typeface = directChild(rPr, 'a:latin')?.getAttribute('typeface')
      const font = typeface && !typeface.startsWith('+') ? typeface : undefined
      const spcAttr = attrNum(rPr, 'spc')
      const letterSpacingPt = spcAttr !== undefined ? spcAttr / 100 : undefined
      return { text, bold, italic, sizePt, color, font, letterSpacingPt }
    })
    return { runs, level, align, bulleted, spaceAfterPt }
  })
}

function geomPct(xfrm: XfrmEmu, widthEmu: number, heightEmu: number): { xPct: number; yPct: number; wPct: number; hPct: number } {
  return {
    xPct: emuToPercent(xfrm.xEmu, widthEmu),
    yPct: emuToPercent(xfrm.yEmu, heightEmu),
    wPct: emuToPercent(xfrm.cxEmu, widthEmu),
    hPct: emuToPercent(xfrm.cyEmu, heightEmu)
  }
}

const KNOWN_GEOMS: ReadonlySet<string> = new Set(['ellipse', 'roundRect'])

/** `<a:prstGeom prst="…">` de `spPr` — solo las geometrías que cambian cómo se dibuja (ver `ShapeGeom`). */
function geomOf(spPr: Element | null): ShapeGeom | undefined {
  const prst = descendant(spPr, 'a:prstGeom')?.getAttribute('prst')
  return prst && KNOWN_GEOMS.has(prst) ? (prst as ShapeGeom) : undefined
}

const KNOWN_ANCHORS: ReadonlySet<string> = new Set(['t', 'ctr', 'b'])

/** `anchor` de `<a:bodyPr>` del `txBody` — dónde se ancla el texto DENTRO de su caja. */
function anchorOf(txBody: Element | null): 't' | 'ctr' | 'b' | undefined {
  const anchor = directChild(txBody, 'a:bodyPr')?.getAttribute('anchor')
  return anchor && KNOWN_ANCHORS.has(anchor) ? (anchor as 't' | 'ctr' | 'b') : undefined
}

function parseTable(
  graphicFrame: Element,
  widthEmu: number,
  heightEmu: number,
  scheme: ColorScheme,
  colorMap: Record<string, string>
): Shape {
  // OJO: `p:xfrm` de un graphicFrame YA es el contenedor de off/ext (a diferencia de `p:spPr`, que
  // ENVUELVE a `a:xfrm`) — por eso `readXfrmDirect`, no `readXfrm` (bug real: con `readXfrm` esto
  // daba `null` siempre y la tabla cae en la cajita de respaldo, ignorando su posición/tamaño real).
  const xfrm = readXfrmDirect(directChild(graphicFrame, 'p:xfrm'))
  const pct = geomPct(xfrm ?? FALLBACK_XFRM, widthEmu, heightEmu)
  const tbl = descendant(graphicFrame, 'a:tbl')
  const rows = directChildren(tbl, 'a:tr').map((tr) =>
    directChildren(tr, 'a:tc').map((tc) => ({
      paragraphs: parseParagraphs(directChild(tc, 'a:txBody'), () => ({ sizePt: 14, bold: false, bulleted: false }), scheme, colorMap)
    }))
  )
  return { kind: 'table', ...pct, rows }
}

interface SlideContext {
  widthEmu: number
  heightEmu: number
  layoutGeoms: PlaceholderGeom[]
  masterGeoms: PlaceholderGeom[]
  titleLvls: Record<number, LevelDefaults>
  bodyLvls: Record<number, LevelDefaults>
  scheme: ColorScheme
  colorMap: Record<string, string>
}

const SHAPE_LIKE_TAGS = new Set(['p:sp', 'p:pic', 'p:graphicFrame', 'p:cxnSp', 'p:grpSp'])

/** Arma las formas de una diapositiva (sin resolver todavía las imágenes a `data:`: eso es async, ver `resolvePictures`). */
export function buildSlideShapes(slideDoc: Document, ctx: SlideContext): Shape[] {
  const spTree = slideDoc.getElementsByTagName('p:spTree')[0] ?? null
  const shapes: Shape[] = []
  for (const el of Array.from(spTree?.children ?? [])) {
    if (el.tagName === 'p:sp') {
      const { type, idx } = phOf(el)
      const ownXfrm = readXfrm(directChild(el, 'p:spPr'))
      const layoutGeom = findGeom(ctx.layoutGeoms, type, idx)
      const xfrm = ownXfrm ?? layoutGeom?.xfrm ?? matchPlaceholderGeom(ctx.masterGeoms, type, idx) ?? FALLBACK_XFRM
      const isTitle = type !== undefined && TITLE_TYPES.has(type)
      const masterLvls = isTitle ? ctx.titleLvls : ctx.bodyLvls
      const txBody = directChild(el, 'p:txBody')
      const paragraphs = parseParagraphs(
        txBody,
        (level) => lvlDefaultsFor(masterLvls, layoutGeom?.lstStyleLvls, level, !isTitle),
        ctx.scheme,
        ctx.colorMap
      )
      const spPr = directChild(el, 'p:spPr')
      const fill = solidFillOf(spPr, ctx.scheme, ctx.colorMap)
      const stroke = fill ? undefined : strokeOf(spPr, ctx.scheme, ctx.colorMap) // el contorno solo importa cuando NO hay relleno (ver el campo `stroke` del tipo)
      const geom = geomOf(spPr)
      const anchor = anchorOf(txBody)
      shapes.push({ kind: 'shape', ...geomPct(xfrm, ctx.widthEmu, ctx.heightEmu), fill, stroke, geom, anchor, paragraphs })
    } else if (el.tagName === 'p:pic') {
      const xfrm = readXfrm(directChild(el, 'p:spPr')) ?? FALLBACK_XFRM
      const rEmbed = descendant(directChild(el, 'p:blipFill'), 'a:blip')?.getAttribute('r:embed') ?? undefined
      shapes.push({ kind: 'picture', ...geomPct(xfrm, ctx.widthEmu, ctx.heightEmu), dataUrl: rEmbed ? `__rid__:${rEmbed}` : undefined })
    } else if (el.tagName === 'p:graphicFrame' && descendant(el, 'a:tbl')) {
      shapes.push(parseTable(el, ctx.widthEmu, ctx.heightEmu, ctx.scheme, ctx.colorMap))
    } else if (el.tagName === 'p:graphicFrame' && descendant(el, 'c:chart')) {
      // mismo bug de `p:xfrm` que `parseTable` tenía: acá directo con `readXfrmDirect`, nunca lo tuvo mal.
      const xfrm = readXfrmDirect(directChild(el, 'p:xfrm')) ?? FALLBACK_XFRM
      const chartRid = descendant(el, 'c:chart')?.getAttribute('r:id') ?? undefined
      shapes.push({ kind: 'chart', ...geomPct(xfrm, ctx.widthEmu, ctx.heightEmu), chartRid })
    } else if (SHAPE_LIKE_TAGS.has(el.tagName)) {
      const xfrm = readXfrm(directChild(el, 'p:spPr')) ?? readXfrmDirect(directChild(el, 'p:xfrm')) ?? FALLBACK_XFRM
      shapes.push({ kind: 'unknown', ...geomPct(xfrm, ctx.widthEmu, ctx.heightEmu) })
    }
    // cualquier otra etiqueta (p:nvGrpSpPr, p:grpSpPr del propio spTree, etc.) se ignora: no es una forma.
  }
  return shapes
}

/** Formas decorativas (sin placeholder, `p:sp` con `a:xfrm` propio) de un layout o maestro — por
 * ejemplo la barra de color que la skill `pptx` dibuja en el maestro: no es contenido de ninguna
 * diapositiva, pero PowerPoint la pinta en todas las que usan ese maestro/layout, así que el visor
 * también. Un placeholder (con `p:ph`) NUNCA se pinta acá: ya lo pinta `buildSlideShapes` si la
 * diapositiva lo usa, y pintarlo también acá lo duplicaría. */
export function parseStaticShapes(
  doc: Document,
  widthEmu: number,
  heightEmu: number,
  scheme: ColorScheme,
  colorMap: Record<string, string>
): Shape[] {
  const spTree = doc.getElementsByTagName('p:spTree')[0] ?? null
  const shapes: Shape[] = []
  for (const sp of directChildren(spTree, 'p:sp')) {
    const ph = descendant(directChild(sp, 'p:nvSpPr'), 'p:ph')
    if (ph) continue
    const xfrm = readXfrm(directChild(sp, 'p:spPr'))
    if (!xfrm) continue
    const fill = solidFillOf(directChild(sp, 'p:spPr'), scheme, colorMap)
    const paragraphs = parseParagraphs(directChild(sp, 'p:txBody'), () => ({}), scheme, colorMap)
    shapes.push({ kind: 'shape', ...geomPct(xfrm, widthEmu, heightEmu), fill, paragraphs })
  }
  return shapes
}

const MEDIA_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

/** Cambia los `dataUrl` placeholder (`__rid__:<id>`) de las imágenes por el `data:` real, leyendo del zip. */
async function resolvePictures(shapes: Shape[], slideRels: Map<string, string>, slidePath: string, zip: JSZip): Promise<void> {
  for (const shape of shapes) {
    if (shape.kind !== 'picture' || !shape.dataUrl?.startsWith('__rid__:')) continue
    const rid = shape.dataUrl.slice('__rid__:'.length)
    const target = slideRels.get(rid)
    shape.dataUrl = undefined
    if (!target) continue
    const mediaPath = resolveRelPath(slidePath, target)
    const ext = mediaPath.slice(mediaPath.lastIndexOf('.')).toLowerCase()
    const mime = MEDIA_MIME[ext]
    const file = zip.file(mediaPath)
    if (!mime || !file) continue
    const base64 = await file.async('base64')
    shape.dataUrl = `data:${mime};base64,${base64}`
  }
}

/** Puntos `<c:pt idx="i"><c:v>…</c:v></c:pt>` de un `c:strCache`/`c:numCache`/`c:lvl`, en orden de `idx` (no de aparición: OOXML no lo garantiza). */
function orderedChartPoints(cache: Element | null): string[] {
  return directChildren(cache, 'c:pt')
    .map((pt) => ({ idx: attrNum(pt, 'idx') ?? 0, v: directChild(pt, 'c:v')?.textContent ?? '' }))
    .sort((a, b) => a.idx - b.idx)
    .map((p) => p.v)
}

/** `<c:cat>` trae `c:strRef` (caso normal) O `c:multiLvlStrRef` (categorías que podrían confundirse con fecha/número — `pptxgenjs` usa esta forma) — a ambas hay que saber llegarles. */
function chartCategoryCache(catEl: Element | null): Element | null {
  const strCache = directChild(directChild(catEl, 'c:strRef'), 'c:strCache')
  if (strCache) return strCache
  const multiCache = directChild(directChild(catEl, 'c:multiLvlStrRef'), 'c:multiLvlStrCache')
  return directChild(multiCache, 'c:lvl')
}

const CHART_TYPE_TAGS: Record<string, ChartKind> = { 'c:barChart': 'bar', 'c:lineChart': 'line', 'c:pieChart': 'pie' }

/** Un color por `idx` de `<c:dPt>` (el color de CADA punto, lo que pinta `render-pptx.ts` vía `chartColors`) — si un punto no trae el suyo, cae al color de toda la serie (`c:ser > c:spPr`). */
function chartPointColors(ser: Element, count: number): string[] | undefined {
  const perPoint = new Map<number, string>()
  for (const dPt of directChildren(ser, 'c:dPt')) {
    const idx = attrNum(directChild(dPt, 'c:idx'), 'val')
    const color = solidFillOf(directChild(dPt, 'c:spPr'), {}, {})
    if (idx !== undefined && color) perPoint.set(idx, color)
  }
  const seriesColor = solidFillOf(directChild(ser, 'c:spPr'), {}, {})
  const colors = Array.from({ length: count }, (_, i) => perPoint.get(i) ?? seriesColor)
  return colors.every((c): c is string => !!c) ? colors : undefined
}

/** `chartN.xml` → tipo + categorías + valores + colores reales de la PRIMERA serie — suficiente para
 * una vista estructural (nunca un render fiel: sin ejes/leyenda de verdad, eso lo pinta el propio
 * `PptxViewer`). `undefined` si no se reconoce el tipo de gráfico o faltan datos, nunca lanza. */
export function parseChartXml(xml: string): ChartData | undefined {
  const doc = parseXml(xml)
  const plotArea = doc.getElementsByTagName('c:plotArea')[0] ?? null
  const typeTag = Object.keys(CHART_TYPE_TAGS).find((t) => directChild(plotArea, t))
  if (!typeTag) return undefined
  const ser = descendant(directChild(plotArea, typeTag), 'c:ser')
  if (!ser) return undefined
  const categories = orderedChartPoints(chartCategoryCache(directChild(ser, 'c:cat')))
  const numCache = directChild(directChild(directChild(ser, 'c:val'), 'c:numRef'), 'c:numCache')
  const values = orderedChartPoints(numCache)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  if (categories.length === 0 || values.length === 0) return undefined
  return { type: CHART_TYPE_TAGS[typeTag], categories, values, colors: chartPointColors(ser, values.length) }
}

/**
 * El fondo de UNA diapositiva, con la herencia real de PowerPoint (ECMA-376 §19.3.1.1): si la
 * diapositiva no trae `<p:bg>` propio, hereda del layout; si tampoco, del maestro. Bug real que esto
 * arregla: antes esta herencia no existía — `<p:bg>` nunca se leía en ningún nivel, así que el fondo de
 * color a toda página que configura `render-pptx.ts` (portada/sección/cifra/cierre) nunca se pintaba.
 */
export function resolveBackground(
  slideDoc: Document,
  layoutDoc: Document | undefined,
  masterDoc: Document | undefined,
  scheme: ColorScheme,
  colorMap: Record<string, string>
): string | undefined {
  return (
    bgOf(slideDoc.getElementsByTagName('p:cSld')[0] ?? null, scheme, colorMap) ??
    bgOf(layoutDoc?.getElementsByTagName('p:cSld')[0] ?? null, scheme, colorMap) ??
    bgOf(masterDoc?.getElementsByTagName('p:cSld')[0] ?? null, scheme, colorMap)
  )
}

/** Cambia el `chartRid` pendiente de cada gráfico por sus datos de verdad, leyendo `ppt/charts/chartN.xml` del zip. */
async function resolveCharts(shapes: Shape[], slideRels: Map<string, string>, slidePath: string, zip: JSZip): Promise<void> {
  for (const shape of shapes) {
    if (shape.kind !== 'chart' || !shape.chartRid) continue
    const target = slideRels.get(shape.chartRid)
    if (!target) continue
    const file = zip.file(resolveRelPath(slidePath, target))
    if (!file) continue
    shape.chart = parseChartXml(await file.async('string'))
  }
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}
function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
async function readRels(zip: JSZip, partPath: string): Promise<Map<string, string>> {
  const relsPath = `${dirname(partPath)}/_rels/${basename(partPath)}.rels`
  const file = zip.file(relsPath)
  if (!file) return new Map()
  return parseRels(await file.async('string'))
}
/** Parsea un `.pptx` entero a un `Deck` (Fase 4). Único punto async: lee del zip, resuelve layout/maestro/tema por diapositiva (con caché) e incrusta imágenes como `data:`. */
export async function parseDeck(zip: JSZip): Promise<Deck> {
  const presentationPath = 'ppt/presentation.xml'
  const presentationXml = await zip.file(presentationPath)!.async('string')
  const { widthEmu, heightEmu, slideRIds } = parsePresentation(presentationXml)
  const presRels = await readRels(zip, presentationPath)

  const docCache = new Map<string, Document>()
  const geomCache = new Map<string, PlaceholderGeom[]>()
  async function docAt(path: string): Promise<Document> {
    const cached = docCache.get(path)
    if (cached) return cached
    const xml = await zip.file(path)!.async('string')
    const doc = parseXml(xml)
    docCache.set(path, doc)
    return doc
  }
  async function geomsAt(path: string): Promise<PlaceholderGeom[]> {
    const cached = geomCache.get(path)
    if (cached) return cached
    const geoms = parsePlaceholderGeoms(await docAt(path))
    geomCache.set(path, geoms)
    return geoms
  }

  const slides: Slide[] = []
  for (const rId of slideRIds) {
    const target = presRels.get(rId)
    if (!target) continue
    const slidePath = resolveRelPath(presentationPath, target)
    const slideXml = await zip.file(slidePath)!.async('string')
    const slideDoc = parseXml(slideXml)
    const slideRels = await readRels(zip, slidePath)

    const layoutTarget = [...slideRels.values()].find((t) => t.includes('slideLayout'))
    const layoutPath = layoutTarget ? resolveRelPath(slidePath, layoutTarget) : undefined
    const layoutGeoms = layoutPath ? await geomsAt(layoutPath) : []

    let masterPath: string | undefined
    let masterDoc: Document | undefined
    if (layoutPath) {
      const layoutRels = await readRels(zip, layoutPath)
      const masterTarget = [...layoutRels.values()].find((t) => t.includes('slideMaster'))
      masterPath = masterTarget ? resolveRelPath(layoutPath, masterTarget) : undefined
      masterDoc = masterPath ? await docAt(masterPath) : undefined
    }
    const masterGeoms = masterPath ? await geomsAt(masterPath) : []
    const titleLvls = masterDoc ? parseLvlDefaults(masterDoc, 'p:titleStyle') : {}
    const bodyLvls = masterDoc ? parseLvlDefaults(masterDoc, 'p:bodyStyle') : {}

    let scheme: ColorScheme = {}
    let colorMap: Record<string, string> = {}
    if (masterDoc && masterPath) {
      colorMap = parseColorMap(masterDoc)
      const masterRels = await readRels(zip, masterPath)
      const themeTarget = [...masterRels.values()].find((t) => t.includes('theme'))
      if (themeTarget) {
        const themePath = resolveRelPath(masterPath, themeTarget)
        scheme = parseColorScheme(await docAt(themePath))
      }
    }

    const masterDecor = masterDoc ? parseStaticShapes(masterDoc, widthEmu, heightEmu, scheme, colorMap) : []
    const layoutDoc = layoutPath ? await docAt(layoutPath) : undefined
    const layoutDecor = layoutDoc ? parseStaticShapes(layoutDoc, widthEmu, heightEmu, scheme, colorMap) : []

    const shapes = buildSlideShapes(slideDoc, { widthEmu, heightEmu, layoutGeoms, masterGeoms, titleLvls, bodyLvls, scheme, colorMap })
    await resolvePictures(shapes, slideRels, slidePath, zip)
    await resolveCharts(shapes, slideRels, slidePath, zip)
    const background = resolveBackground(slideDoc, layoutDoc, masterDoc, scheme, colorMap)
    // orden de PowerPoint: lo del maestro queda más al fondo, luego el layout, luego la diapositiva.
    slides.push({ shapes: [...masterDecor, ...layoutDecor, ...shapes], background })
  }

  return { slides, widthEmu, heightEmu }
}
