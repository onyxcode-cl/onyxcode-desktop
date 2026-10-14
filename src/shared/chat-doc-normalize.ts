/**
 * Perdona los deslices más comunes del modelo al escribir un ```pptx, ANTES de validar contra el esquema (que sigue siendo estricto):
 *  - un elemento del lienzo libre con el nombre de la forma como tipo: `{"type":"line",…}` o `"rectangle"`/`"circle"`… → `{"type":"shape","shape":…}`
 *  - números en las celdas de una tabla (`"rows":[["Pro",29990]]`) → texto.
 * No inventa nada: solo cambia el nombre de un tipo por su equivalente o convierte un número a su texto.
 */
import { FREE_SHAPES } from './chat-doc-spec'

const SHAPE_ALIAS: Record<string, string> = {
  line: 'line',
  rect: 'rect',
  rectangle: 'rect',
  square: 'rect',
  roundrect: 'roundRect',
  roundedrect: 'roundRect',
  roundedrectangle: 'roundRect',
  ellipse: 'ellipse',
  circle: 'ellipse',
  oval: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  hexagon: 'hexagon',
  rightarrow: 'rightArrow',
  arrow: 'rightArrow',
  chevron: 'chevron',
  star: 'star5',
  star5: 'star5'
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function fixElement(e: unknown): unknown {
  if (!isObj(e) || e.type === 'text' || e.type === 'shape') return e
  const alias = typeof e.type === 'string' ? SHAPE_ALIAS[e.type.toLowerCase()] : undefined
  if (!alias || !(FREE_SHAPES as readonly string[]).includes(alias)) return e
  const { type: _drop, ...rest } = e
  void _drop
  return { type: 'shape', shape: alias, ...rest }
}

function fixTable(t: unknown): unknown {
  if (!isObj(t) || !Array.isArray(t.rows) || !Array.isArray(t.columns)) return t
  const text = (c: unknown): unknown => (typeof c === 'number' && Number.isFinite(c) ? String(c) : c)
  return {
    ...t,
    columns: t.columns.map(text),
    rows: t.rows.map((r) => (Array.isArray(r) ? r.map(text) : r))
  }
}

/** Devuelve el mismo documento con los deslices corregidos (o tal cual si no es una presentación reconocible). */
export function normalizePptx(doc: unknown): unknown {
  if (!isObj(doc) || !Array.isArray(doc.slides)) return doc
  return {
    ...doc,
    slides: doc.slides.map((s) => {
      if (!isObj(s)) return s
      return {
        ...s,
        ...(Array.isArray(s.elements) ? { elements: s.elements.map(fixElement) } : {}),
        ...(s.table !== undefined ? { table: fixTable(s.table) } : {})
      }
    })
  }
}
