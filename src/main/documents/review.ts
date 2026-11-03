/**
 * Revisión de calidad de un documento recién creado con `documentos_crear` (Word, Excel, PowerPoint), sobre los bytes del archivo y sin
 * Python: la misma lista corta ✔/✘ que `resources/opencode/skills/_shared/verificar_office.py` (que corre el agente con `bash`), pero
 * hecha por la propia herramienta, así el cierre de la tarea puede citar una revisión que de verdad aparece en la salida de una herramienta.
 * Mismo criterio que el verificador de Python: título con estilo, encabezados, viñetas con estilo de lista y tablas sin celdas vacías
 * (Word); marcador de título en cada diapositiva y nada fuera de los bordes (PowerPoint); totales con fórmula viva, sin errores y con valor
 * calculado guardado (Excel). Si no se puede abrir el archivo, lo dice («NO corrida»): nunca finge una revisión.
 */
import JSZip from 'jszip'
import type { PptxSpec } from '@shared/chat-doc-spec'
import { foldSubtitles, layoutOf } from '../office/craft/chat-deck'

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
  return r.done()
}

// ---------------------------------------------------------------- PowerPoint
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
  const TOL = 22860
  for (const [i, name] of names.entries()) {
    const xml = (await zip.file(name)!.async('string')) ?? ''
    const sps = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []
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

async function reviewXlsx(zip: JSZip): Promise<ReviewResult> {
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
  let formulas = 0
  for (const { path: name, title } of sheets) {
    const xml = (await zip.file(name)!.async('string')) ?? ''
    const sheet = title
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const cells = [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => {
        const attrs = m[1]
        const body = m[2] ?? ''
        const ref = /\sr="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? ''
        const type = /\st="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
        const f = /<f\b/.test(body)
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1]
        let text: string | null = null
        if (type === 's' && v !== undefined) text = shared[Number(v)] ?? null
        else if (type === 'inlineStr') text = unescapeXml([...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join(''))
        else if (type === 'str' && v !== undefined) text = unescapeXml(v)
        return { ref, type, f, v, text }
      })
      const label = cells.find((c) => c.text && !c.f && TOTAL_LABEL.test(c.text))
      for (const c of cells) {
        if (c.f) {
          formulas++
          if (c.v === undefined || c.v === '') noValue.push(`${sheet}!${c.ref}`)
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

export async function reviewDocument(kind: 'docx' | 'xlsx' | 'pptx', bytes: Buffer, spec?: unknown): Promise<ReviewResult> {
  const zip = await JSZip.loadAsync(bytes)
  if (kind === 'docx') return reviewDocx(zip)
  if (kind === 'pptx') return reviewPptx(zip, spec)
  return reviewXlsx(zip)
}

/** Texto que se agrega a la respuesta de `crear`: la lista ✔/✘ o, si no se pudo, una frase explícita de que NO se corrió. */
export async function reviewSummary(
  tipo: string,
  bytes: Buffer,
  review: typeof reviewDocument = reviewDocument,
  spec?: unknown
): Promise<string> {
  if (tipo !== 'docx' && tipo !== 'xlsx' && tipo !== 'pptx')
    return '\nRevisión de calidad: NO corrida (no aplica a PDF). No la cites como hecha.'
  try {
    const res = await review(tipo, bytes, spec)
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
