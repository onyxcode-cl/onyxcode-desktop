/**
 * Revisión de calidad de un documento recién creado con `documentos_crear` (Word, Excel, PowerPoint), sobre los bytes del archivo y sin
 * Python: la misma lista corta ✔/✘ que `resources/opencode/skills/_shared/verificar_office.py` (que corre el agente con `bash`), pero
 * hecha por la propia herramienta, así el cierre de la tarea puede citar una revisión que de verdad aparece en la salida de una herramienta.
 * Mismo criterio que el verificador de Python: título con estilo, encabezados, viñetas con estilo de lista y tablas sin celdas vacías
 * (Word); marcador de título en cada diapositiva y nada fuera de los bordes (PowerPoint); totales con fórmula viva, sin errores y con valor
 * calculado guardado (Excel). Si no se puede abrir el archivo, lo dice («NO corrida»): nunca finge una revisión.
 */
import JSZip from 'jszip'
import { htmlFontSizesPt, pdfPageCount } from '../extras/pdf-options'
import type { PptxSpec } from '@shared/chat-doc-spec'
import { foldSubtitles, layoutOf } from '../office/craft/chat-deck'
import { isXlsxSpec } from '@shared/chat-doc-spec'
import { colLetter } from '../office/craft/chat-grid'
import { reviewFormulas } from './formula-review'
import {
  docxContrastProblems,
  docxSmallRuns,
  formulaSheetRefs,
  overlappingPairs,
  pptxBackground,
  pptxContrastProblems,
  pptxPanels,
  textExtentBox,
  pptxTextShapes,
  templateLeftovers,
  textNearEdge,
  type ContrastProblem
} from './review-checks'

export interface ReviewItem {
  ok: boolean
  text: string
  /** Aviso que no es ✔ ni ✘ (no obliga a recrear el archivo): se muestra como «ℹ». */
  note?: boolean
}
export interface ReviewResult {
  items: ReviewItem[]
  /** `false` si algún punto falló. */
  ok: boolean
}

// La etiqueta es TODA la celda: «Media» o «Suma» sueltas en una fila de una tabla de prioridades no son un total.
const TOTAL_LABEL = /^\s*(total|subtotal|suma|promedio|total general)\s*:?\s*$/i
const HAND_BULLET = /^\s*([•·▪●◦\-–*]|\d+[.)])\s+\S/
const DRAWS_FIRST_BULLET: string[] = ['cover', 'closing', 'bullets', 'steps', 'cards', 'stat']
const ERRORS = ['#DIV/0!', '#REF!', '#NAME?', '#VALUE!', '#N/A', '#NUM!', '#NULL!']

const ratioText = (p: ContrastProblem): string =>
  `${p.where} ${p.ratio.toFixed(1).replace('.', ',')}:1 (mínimo ${String(p.need).replace('.', ',')}:1)`

/** Las tres revisiones que valen para cualquier formato: restos de plantilla en el texto. */
function checkTemplate(r: Builder, text: string): void {
  const left = templateLeftovers(text)
  r.check(
    left.length === 0,
    'Sin restos de plantilla («lorem», «TODO», «[insertar…]»)',
    `Restos de plantilla en el texto: ${left.join(', ')}. Escribe el contenido real`
  )
}

function short(list: string[], n = 5): string {
  return list.slice(0, n).join(', ') + (list.length > n ? ` y ${list.length - n} más` : '')
}

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function textOf(xml: string): string {
  return unescapeXml([...xml.matchAll(/<(?:w|a):t(?:\s[^>]*)?>([^<]*)<\/(?:w|a):t>/g)].map((m) => m[1]).join(''))
}

class Builder {
  items: ReviewItem[] = []
  check(cond: boolean, good: string, bad: string): void {
    this.items.push({ ok: cond, text: cond ? good : bad })
  }
  /** Aviso que no obliga a recrear el archivo (se muestra como «ℹ»). */
  note(text: string): void {
    this.items.push({ ok: true, text, note: true })
  }
  done(): ReviewResult {
    return { items: this.items, ok: this.items.every((i) => i.ok) }
  }
}

// ---------------------------------------------------------------- Word
async function reviewDocx(zip: JSZip): Promise<ReviewResult> {
  const r = new Builder()
  const doc = (await zip.file('word/document.xml')?.async('string')) ?? ''
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
  const names = new Map<string, string>()
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*\sw:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name w:val="([^"]+)"/g)) names.set(m[1], m[2])
  const tables = doc.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []
  const outside = doc.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '')
  const paras = [...outside.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((m) => {
      const xml = m[0]
      const id = /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] ?? ''
      const style = names.get(id) ?? id
      // Word guarda el nombre del estilo en minúsculas («heading 1», «title», «list paragraph»): se compara sin mayúsculas ni espacios.
      return { style, key: style.toLowerCase().replace(/\s+/g, ''), text: textOf(xml), numbered: /<w:numPr>/.test(xml), xml }
    })
    .filter((p) => p.text.trim())
  if (!paras.length) {
    r.check(false, '', 'El documento no tiene texto')
    return r.done()
  }
  const first = paras[0].style
  const firstKey = paras[0].key
  r.check(
    firstKey === 'title' || firstKey.startsWith('heading'),
    `El título usa un estilo de título («${first}»)`,
    `El primer párrafo («${paras[0].text.slice(0, 40)}») está en estilo «${first || 'Normal'}», no Title/Heading: no entra al índice ni a la navegación`
  )
  const heads = paras.filter((p) => p.key.startsWith('heading')).length
  if (paras.length > 12)
    r.check(
      heads > 0,
      `Tiene encabezados reales (${heads})`,
      `Documento de ${paras.length} párrafos sin encabezados Heading: usa estilos de encabezado`
    )
  else r.items.push({ ok: true, text: `Encabezados reales: ${heads}` })
  const manual = paras
    .filter((p) => !/^(list|heading|title)/.test(p.key) && !p.numbered && HAND_BULLET.test(p.text))
    .map((p) => p.text.slice(0, 30))
  r.check(
    manual.length === 0,
    'Las viñetas y listas usan estilo de lista',
    `${manual.length} párrafo(s) con viñeta o número escritos a mano sin estilo de lista: ${short(manual)}`
  )
  const empty: string[] = []
  tables.forEach((t, i) => {
    const rows = t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []
    if (rows.length < 2) return
    rows.forEach((row, ri) => {
      ;(row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).forEach((tc, ci) => {
        if (/<w:vMerge|<w:gridSpan/.test(tc)) return
        if (!textOf(tc).trim()) empty.push(`tabla ${i + 1} fila ${ri + 1} col ${ci + 1}`)
      })
    })
  })
  if (tables.length)
    r.check(
      empty.length === 0,
      `Las ${tables.length} tabla(s) no tienen celdas vacías`,
      `Celdas vacías en tablas: ${short(empty)} (pon el dato o «—»)`
    )
  checkTemplate(r, textOf(doc))
  const tiny = docxSmallRuns(doc, 8)
  r.check(
    tiny.length === 0,
    'Ninguna letra de menos de 8 pt',
    `Letra demasiado chica (menos de 8 pt): ${short(tiny.map((t) => `«${t.text}» ${t.sizePt} pt`))}`
  )
  const low = docxContrastProblems(doc)
  r.check(
    low.length === 0,
    'Contraste suficiente en los colores de texto comprobables (WCAG 4,5:1 / 3:1)',
    `Contraste bajo (WCAG): ${short(low.map(ratioText))}`
  )
  return r.done()
}

// ---------------------------------------------------------------- PowerPoint
/** Fondo sólido explícito de la diapositiva o, si no tiene, el de su diseño y el de su patrón; `null` si es de tema, degradado o imagen. */
async function slideBackground(zip: JSZip, slidePath: string, slideXml: string): Promise<string | null> {
  const own = pptxBackground(slideXml)
  if (own) return own
  const relTarget = async (path: string, type: RegExp): Promise<string | null> => {
    const dir = path.slice(0, path.lastIndexOf('/'))
    const base = path.slice(path.lastIndexOf('/') + 1)
    const rels = (await zip.file(`${dir}/_rels/${base}.rels`)?.async('string')) ?? ''
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (!type.test(m[0])) continue
      const t = /\sTarget="([^"]+)"/.exec(m[0])?.[1]
      if (!t) continue
      const parts = `${dir}/${t}`.split('/')
      const stack: string[] = []
      for (const part of parts) {
        if (part === '..') stack.pop()
        else if (part !== '.') stack.push(part)
      }
      return stack.join('/')
    }
    return null
  }
  const layout = await relTarget(slidePath, /slideLayout/)
  if (!layout) return null
  const layoutXml = (await zip.file(layout)?.async('string')) ?? ''
  const fromLayout = pptxBackground(layoutXml)
  if (fromLayout) return fromLayout
  const master = await relTarget(layout, /slideMaster/)
  return master ? pptxBackground((await zip.file(master)?.async('string')) ?? '') : null
}

async function reviewPptx(zip: JSZip, spec?: unknown): Promise<ReviewResult> {
  const r = new Builder()
  const pres = (await zip.file('ppt/presentation.xml')?.async('string')) ?? ''
  const sw = Number(/<p:sldSz[^>]*\scx="(\d+)"/.exec(pres)?.[1]) || 12192000
  const sh = Number(/<p:sldSz[^>]*\scy="(\d+)"/.exec(pres)?.[1]) || 6858000
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  if (!names.length) {
    r.check(false, '', 'La presentación no tiene diapositivas')
    return r.done()
  }
  const noTitle: string[] = []
  const outside: string[] = []
  const tiny: string[] = []
  const smallish: string[] = []
  const stacked: string[] = []
  const tight: string[] = []
  const lowContrast: ContrastProblem[] = []
  let allText = ''
  const TOL = 22860
  const EDGE = 274320 // 0,3 pulgadas: más cerca del borde que esto se ve apretado
  const FOOTER_PH = new Set(['ftr', 'sldNum', 'dt'])
  for (const [i, name] of names.entries()) {
    const xml = (await zip.file(name)!.async('string')) ?? ''
    const sps = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []
    const textShapes = pptxTextShapes(xml)
    allText += ' ' + textOf(xml)
    for (const ts of textShapes) {
      if (ts.placeholder && FOOTER_PH.has(ts.placeholder)) continue
      for (const run of ts.runs) {
        // El número de página («2 / 3») y el pie son texto de apoyo: se admite más chico.
        if (run.sizePt == null || /^\s*\d+(\s*\/\s*\d+)?\s*$/.test(run.text)) continue
        if (run.sizePt < 10) tiny.push(`${i + 1} («${run.text.trim().slice(0, 20)}» ${run.sizePt} pt)`)
        else if (run.sizePt < 12) smallish.push(String(i + 1))
      }
      // El número de página («02», «2 / 9») pegado a la esquina es normal: no se avisa.
      const pageNumber = ts.runs.every((r) => /^\s*\d+(\s*\/\s*\d+)?\s*$/.test(r.text))
      const b = ts.box
      if (
        !pageNumber &&
        b &&
        b.x >= -TOL &&
        b.y >= -TOL &&
        b.x + b.w <= sw + TOL &&
        b.y + b.h <= sh + TOL &&
        textNearEdge(ts, sw, sh, EDGE)
      )
        tight.push(`${i + 1} («${ts.name}»)`)
    }
    const boxed = textShapes.filter((t) => t.box && !(t.placeholder && FOOTER_PH.has(t.placeholder)))
    for (const [a, c] of overlappingPairs(boxed.map((t) => textExtentBox(t)!))) stacked.push(`${i + 1} («${boxed[a].name}» con «${boxed[c].name}»)`)
    lowContrast.push(...pptxContrastProblems(textShapes, await slideBackground(zip, name, xml), `diapositiva ${i + 1}`, pptxPanels(xml)))
    const hasTitle = sps.some((s) => /<p:ph[^>]*\stype="(title|ctrTitle)"/.test(s) && textOf(s).trim())
    if (!hasTitle) noTitle.push(String(i + 1))
    const shapes = [
      ...sps,
      ...(xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []),
      ...(xml.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g) ?? [])
    ]
    for (const s of shapes) {
      const relevant = s.startsWith('<p:sp>') ? !!textOf(s).trim() : true
      if (!relevant) continue
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(s)
      if (!off) continue
      const [x, y, cx, cy] = off.slice(1).map(Number)
      if (x < -TOL || y < -TOL || x + cx > sw + TOL || y + cy > sh + TOL)
        outside.push(`${i + 1} («${/<p:cNvPr[^>]*\sname="([^"]*)"/.exec(s)?.[1] ?? 'forma'}»)`)
    }
  }
  r.check(
    noTitle.length === 0,
    `Las ${names.length} diapositivas tienen marcador de título`,
    `${noTitle.length} diapositiva(s) sin marcador de título con texto (nº ${short(noTitle, 12)}): sin él no hay esquema ni lectores de pantalla`
  )
  // Lo que se pidió en la portada (subtítulo o primera viñeta) tiene que estar en el archivo.
  const first =
    spec && typeof spec === 'object' && Array.isArray((spec as PptxSpec).slides) ? foldSubtitles(spec as PptxSpec).slides[0] : undefined
  // Solo se exige si el diseño de la primera diapositiva dibuja su primera viñeta (section, kpis, chart, table, quote… no la dibujan).
  const wanted = first && DRAWS_FIRST_BULLET.includes(layoutOf(first, 0)) ? first.bullets?.[0] : undefined
  if (wanted) {
    const cover = textOf((await zip.file(names[0])!.async('string')) ?? '')
    const norm = (t: string): string => t.replace(/\s+/g, ' ').trim().toLowerCase()
    r.check(
      norm(cover).includes(norm(wanted).slice(0, 30)),
      'El subtítulo pedido de la portada está en el archivo',
      `El subtítulo pedido de la portada («${wanted.slice(0, 40)}») no aparece en la diapositiva 1`
    )
  }
  r.check(outside.length === 0, 'Nada fuera de los bordes', `Contenido fuera de los bordes en diapositiva ${short(outside)}`)
  r.check(
    stacked.length === 0,
    'Ningún texto montado sobre otro',
    `Textos montados unos sobre otros en diapositiva ${short(stacked)}: sepáralos o acorta el contenido`
  )
  r.check(
    tiny.length === 0,
    'Ninguna letra de menos de 10 pt',
    `Letra demasiado chica (menos de 10 pt) en diapositiva ${short(tiny)}: usa 14 pt o más para el cuerpo`
  )
  r.check(
    lowContrast.length === 0,
    'Contraste suficiente en los colores de texto comprobables (WCAG 4,5:1 / 3:1)',
    `Contraste bajo (WCAG) en ${short(lowContrast.map(ratioText))}: cambia el color del texto o del fondo`
  )
  checkTemplate(r, allText)
  if (tight.length)
    r.note(`Texto a menos de 0,3 pulgadas del borde en diapositiva ${short(tight)}: déjale al menos 0,5 pulgadas de margen si puedes`)
  if (smallish.length)
    r.note(`Letra de menos de 12 pt en diapositiva ${short([...new Set(smallish)], 8)}: para el cuerpo conviene 14 pt o más`)
  return r.done()
}

// ---------------------------------------------------------------- Excel
function colNumber(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
}

/** Hojas del libro en su orden y con su nombre real (`xl/workbook.xml` + sus relaciones), no por el nombre del archivo. */
async function sheetFiles(zip: JSZip): Promise<Array<{ path: string; title: string }>> {
  const all = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  try {
    const wb = (await zip.file('xl/workbook.xml')?.async('string')) ?? ''
    const rels = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? ''
    const target = new Map<string, string>()
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\sId="([^"]+)"/.exec(m[0])?.[1]
      const t = /\sTarget="([^"]+)"/.exec(m[0])?.[1]
      if (id && t) target.set(id, 'xl/' + t.replace(/^\/?(xl\/)?/, ''))
    }
    const ordered: Array<{ path: string; title: string }> = []
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const name = /\sname="([^"]*)"/.exec(m[0])?.[1]
      const rid = /\sr:id="([^"]+)"/.exec(m[0])?.[1]
      const path = rid ? target.get(rid) : undefined
      if (name && path && zip.file(path)) ordered.push({ path, title: unescapeXml(name) })
    }
    if (ordered.length === all.length) return ordered
  } catch {
    // sin nombres: cae al orden numérico
  }
  return all
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
    .map((path, i) => ({ path, title: `Hoja${i + 1}` }))
}

async function reviewXlsx(zip: JSZip, spec?: unknown): Promise<ReviewResult> {
  const r = new Builder()
  const sst = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? ''
  const shared = (sst.match(/<si>[\s\S]*?<\/si>/g) ?? []).map((s) =>
    unescapeXml([...s.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join(''))
  )
  const sheets = await sheetFiles(zip)
  if (!sheets.length) {
    r.check(false, '', 'El libro no tiene hojas')
    return r.done()
  }
  const errors: string[] = []
  const pasted: string[] = []
  const noValue: string[] = []
  const brokenRefs: string[] = []
  const textAsNumber: string[] = []
  /** Resultado numérico guardado en el archivo para cada celda con fórmula, por posición de hoja y celda. */
  const computed = new Map<string, number>()
  const known = new Set(sheets.map((x) => x.title.toLowerCase()))
  let allText = ''
  let formulas = 0
  for (const [sheetIndex, { path: name, title }] of sheets.entries()) {
    const xml = (await zip.file(name)!.async('string')) ?? ''
    const sheet = title
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const cells = [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => {
        const attrs = m[1]
        const body = m[2] ?? ''
        const ref = /\sr="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? ''
        const type = /\st="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
        const fText = /<f\b[^>]*>([^<]*)<\/f>/.exec(body)?.[1]
        const f = /<f\b/.test(body)
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1]
        let text: string | null = null
        if (type === 's' && v !== undefined) text = shared[Number(v)] ?? null
        else if (type === 'inlineStr') text = unescapeXml([...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join(''))
        else if (type === 'str' && v !== undefined) text = unescapeXml(v)
        return { ref, type, f, fText: fText === undefined ? undefined : unescapeXml(fText), v, text }
      })
      const label = cells.find((c) => c.text && !c.f && TOTAL_LABEL.test(c.text))
      for (const c of cells) {
        if (c.text) allText += ' ' + c.text
        // Número escrito como texto en una celda que no es un encabezado ni un código con ceros a la izquierda.
        if (c.text && c.type !== 'n' && !c.f && /^-?[1-9]\d{0,14}([.,]\d+)?$/.test(c.text.trim()) && Number(/\d+/.exec(c.ref)?.[0]) > 1)
          textAsNumber.push(`${sheet}!${c.ref}`)
        if (c.fText !== undefined) {
          if (/#REF!/.test(c.fText)) brokenRefs.push(`${sheet}!${c.ref} (#REF! dentro de la fórmula)`)
          for (const target of formulaSheetRefs(c.fText))
            if (!known.has(target.toLowerCase())) brokenRefs.push(`${sheet}!${c.ref} (la hoja «${target}» no existe)`)
        }
        if (c.f) {
          formulas++
          if (c.v === undefined || c.v === '') noValue.push(`${sheet}!${c.ref}`)
          else if (c.type === 'n' && Number.isFinite(Number(c.v))) computed.set(`${sheetIndex}:${c.ref}`, Number(c.v))
        }
        if (c.type === 'e' || (c.text && ERRORS.includes(c.text.trim())))
          errors.push(`${sheet}!${c.ref} (${c.type === 'e' ? c.v : c.text})`)
        if (label && c !== label && colNumber(c.ref) > colNumber(label.ref) && !c.f && c.type === 'n' && c.v !== undefined)
          pasted.push(`${sheet}!${c.ref}`)
      }
    }
  }
  r.check(errors.length === 0, 'Ninguna celda con error', `Celdas con error: ${short(errors)}`)
  r.check(
    brokenRefs.length === 0,
    'Ninguna fórmula apunta a una hoja que no existe',
    `Fórmulas con referencias rotas: ${short(brokenRefs)}`
  )
  checkTemplate(r, allText)
  if (isXlsxSpec(spec)) {
    const found = reviewFormulas(spec)
    const errs = found.filter((x) => x.severity === 'error')
    r.check(
      errs.length === 0,
      'Las fórmulas pasan la revisión (referencias, rangos y totales)',
      `Fórmulas con problemas: ${short(
        errs.map((x) => `${x.sheet}!${x.cell} (${x.message})`),
        4
      )}`
    )
    for (const w of found.filter((x) => x.severity === 'warning').slice(0, 3)) r.note(`${w.sheet}!${w.cell}: ${w.message}`)
    // Valor declarado (`value`) contra el que calculó el programa: si el modelo se equivocó en la cuenta, también se equivocará en su resumen.
    const app = (await zip.file('docProps/app.xml')?.async('string')) ?? ''
    if (/<Application>GridCraft<\/Application>/.test(app)) {
      const big: string[] = []
      const small: string[] = []
      spec.sheets.forEach((sh, si) =>
        sh.rows.forEach((row, ri) =>
          row.forEach((cell, ci) => {
            if (cell === null || typeof cell !== 'object' || typeof cell.value !== 'number') return
            const ref = `${colLetter(ci)}${ri + 1}`
            const real = computed.get(`${si}:${ref}`)
            if (real === undefined) return
            const diff = Math.abs(cell.value - real)
            const tol = Math.max(1e-6, Math.abs(real) * 1e-6)
            if (diff <= tol) return
            const label = `${sh.name}!${ref} (declaraste ${cell.value}, la fórmula da ${Math.round(real * 1e6) / 1e6})`
            if (diff > Math.max(0.01, Math.abs(real) * 0.01)) big.push(label)
            else small.push(label)
          })
        )
      )
      r.check(
        big.length === 0,
        'Los valores declarados coinciden con los calculados',
        `Valores declarados que no coinciden con el cálculo real: ${short(big, 4)}. El archivo ya guarda el valor calculado; usa ESE en tu resumen o corrige la fórmula`
      )
      if (small.length) r.note(`Diferencia menor al 1 % entre lo declarado y lo calculado: ${short(small, 3)}`)
    }
  }
  if (textAsNumber.length)
    r.note(
      `${textAsNumber.length} celda(s) guardan un número como texto (${short(textAsNumber, 4)}): no se suman ni se ordenan bien; pásalos como número de JSON`
    )
  r.check(
    pasted.length === 0,
    formulas ? 'Los totales son fórmulas vivas' : 'Sin filas de total',
    `Fila de total con número pegado, no fórmula: ${short(pasted)}`
  )
  if (formulas) {
    const app = (await zip.file('docProps/app.xml')?.async('string')) ?? ''
    const calculated = /<Application>GridCraft<\/Application>/.test(app)
    if (noValue.length)
      r.check(
        false,
        '',
        `${noValue.length} fórmula(s) sin valor recalculado (se verán vacías en visores que no calculan): ${short(noValue)}`
      )
    else if (calculated) r.check(true, `Las ${formulas} fórmula(s) tienen su valor calculado por GridCraft`, '')
    else
      r.items.push({
        ok: true,
        note: true,
        text:
          `Las ${formulas} fórmula(s) llevan el valor que escribió el modelo: NO se recalculó (no hay GridCraft). No lo cites como verificado: ` +
          'comprueba el total con una suma aparte (p. ej. con `bash`) y, si no puedes, dilo en «Para revisar»'
      })
  } else r.items.push({ ok: true, text: 'No hay fórmulas que recalcular' })
  return r.done()
}

// ---------------------------------------------------------------- PDF
/** Revisión de un PDF hecho desde HTML: se juzga el HTML (que es lo que escribió quien lo pide) y el número de páginas del PDF. */
export function reviewPdf(html: string, bytes: Buffer): ReviewResult {
  const r = new Builder()
  r.check(bytes.subarray(0, 4).toString('latin1') === '%PDF', 'El archivo es un PDF válido', 'El archivo no es un PDF válido')
  const pages = pdfPageCount(bytes)
  if (pages > 0) r.note(`${pages} página${pages === 1 ? '' : 's'}`)
  const sizes = htmlFontSizesPt(html)
  const min = sizes.length ? Math.min(...sizes) : null
  r.check(
    min === null || min >= 7.5,
    'Letra de al menos 10 px',
    `Hay letra de ${Math.round((min ?? 0) / 0.75)} px, ilegible impresa. Sube todo a 10 px o más (11 px o más en tablas): si una tabla no cabe, acorta las celdas o quita columnas en vez de achicar la letra`
  )
  r.check(!/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) && !/url\(\s*["']?\s*https?:/i.test(html), 'Sin recursos de internet', 'Hay recursos de internet (src/href/url http): el PDF no tiene red; usa data: o quítalos')
  const longTables = (html.match(/<table\b[\s\S]*?<\/table>/gi) ?? []).filter((t) => (t.match(/<tr\b/gi) ?? []).length > 12)
  r.check(
    longTables.every((t) => /<thead\b/i.test(t)),
    'Las tablas largas tienen <thead> (se repite en cada página)',
    'Una tabla de más de 12 filas no tiene <thead>: sin él el encabezado no se repite en las páginas siguientes'
  )
  r.check(/@page\b/i.test(html), 'Define @page (márgenes y tamaño)', 'Falta @page con tamaño A4 y márgenes de unos 18 a 22 mm')
  r.check(/<html\b[^>]*\blang\s*=/i.test(html), 'Declara el idioma (<html lang>)', 'Falta <html lang="es"> (accesibilidad y separación de sílabas)')
  const noAlt = (html.match(/<img\b[^>]*>/gi) ?? []).filter((t) => !/\balt\s*=/i.test(t)).length
  if (noAlt) r.note(`${noAlt} imagen${noAlt === 1 ? '' : 'es'} sin texto alternativo (alt)`)
  checkTemplate(r, html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
  return r.done()
}

export async function reviewDocument(kind: 'docx' | 'xlsx' | 'pptx', bytes: Buffer, spec?: unknown): Promise<ReviewResult> {
  const zip = await JSZip.loadAsync(bytes)
  if (kind === 'docx') return reviewDocx(zip)
  if (kind === 'pptx') return reviewPptx(zip, spec)
  return reviewXlsx(zip, spec)
}

/** Texto que se agrega a la respuesta de `crear`: la lista ✔/✘ o, si no se pudo, una frase explícita de que NO se corrió. */
export async function reviewSummary(
  tipo: string,
  bytes: Buffer,
  review: typeof reviewDocument = reviewDocument,
  spec?: unknown
): Promise<string> {
  if (tipo === 'pdf' && typeof spec !== 'string')
    return '\nRevisión de calidad: NO corrida (no se recibió el HTML del PDF). No la cites como hecha.'
  if (tipo !== 'docx' && tipo !== 'xlsx' && tipo !== 'pptx' && tipo !== 'pdf')
    return '\nRevisión de calidad: NO corrida (tipo no revisable). No la cites como hecha.'
  try {
    const res = tipo === 'pdf' ? reviewPdf(spec as string, bytes) : await review(tipo, bytes, spec)
    const lines = res.items.map((i) => `  ${i.note ? 'ℹ' : i.ok ? '✔' : '✘'} ${i.text}`).join('\n')
    return (
      `\nRevisión de calidad de la herramienta (salida de esta herramienta: puedes citarla en «Cómo se verificó»):\n${lines}\n` +
      (res.ok
        ? 'RESULTADO: OK'
        : 'RESULTADO: hay puntos ✘. Corrígelos creando el documento de nuevo con OTRO nombre (todo de una vez) y en el cierre di qué corregiste.')
    )
  } catch {
    return '\nRevisión de calidad: NO corrida (no se pudo abrir el archivo creado para revisarlo). No la cites como hecha.'
  }
}
