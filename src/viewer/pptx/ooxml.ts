/**
 * Utilidades mínimas de lectura de XML de OOXML (Fase 4 del plan del visor): solo lo que hace falta
 * para leer `.pptx` de forma estructural — nunca escribe, nunca resuelve XXE (no se usan entidades
 * externas; `DOMParser` del navegador ya las ignora) ni sigue referencias fuera del propio paquete.
 */

/** Hijos directos con esa etiqueta (NO descendientes — un `p:grpSp` anidado no debe contarse dos veces). */
export function directChildren(el: Element | null, tag: string): Element[] {
  if (!el) return []
  return Array.from(el.children).filter((c) => c.tagName === tag)
}

/** Primer hijo directo con esa etiqueta, o null. */
export function directChild(el: Element | null, tag: string): Element | null {
  return directChildren(el, tag)[0] ?? null
}

/** Primer descendiente (a cualquier profundidad) con esa etiqueta — para elementos que no se anidan
 * (`a:xfrm`, `a:off`, `a:ext` dentro de un `p:spPr` que no tiene grupos adentro). */
export function descendant(el: Element | null, tag: string): Element | null {
  return el?.getElementsByTagName(tag)[0] ?? null
}

export function attrNum(el: Element | null, name: string): number | undefined {
  const v = el?.getAttribute(name)
  if (v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

/** 1 EMU = 1/914400 pulgada; acá se expresa como porcentaje del ancho/alto de la diapositiva. */
export function emuToPercent(emu: number, totalEmu: number): number {
  if (totalEmu <= 0) return 0
  return (emu / totalEmu) * 100
}

export interface XfrmEmu {
  xEmu: number
  yEmu: number
  cxEmu: number
  cyEmu: number
}

/** `<a:off x y/><a:ext cx cy/>` directo de un elemento QUE YA ES el contenedor de transformación (p.ej.
 * el propio `<p:xfrm>` de un `p:graphicFrame` — a diferencia de `<p:spPr>`, que envuelve a `<a:xfrm>`
 * en vez de ser uno). `readXfrm` (abajo) es el caso común; este es el que hace falta para tablas/gráficos. */
export function readXfrmDirect(xfrm: Element | null): XfrmEmu | null {
  if (!xfrm) return null
  const off = directChild(xfrm, 'a:off')
  const ext = directChild(xfrm, 'a:ext')
  const xEmu = attrNum(off, 'x')
  const yEmu = attrNum(off, 'y')
  const cxEmu = attrNum(ext, 'cx')
  const cyEmu = attrNum(ext, 'cy')
  if (xEmu === undefined || yEmu === undefined || cxEmu === undefined || cyEmu === undefined) return null
  return { xEmu, yEmu, cxEmu, cyEmu }
}

/** `<a:xfrm><a:off x y/><a:ext cx cy/></a:xfrm>` directo de un `p:spPr`/`p:grpSpPr`, o null si no lo trae. */
export function readXfrm(spPr: Element | null): XfrmEmu | null {
  return readXfrmDirect(directChild(spPr, 'a:xfrm'))
}

/** Relaciones `rId -> ruta relativa al propio part` de un `<Relationships>` (`_rels/*.rels`). */
export function parseRels(xml: string): Map<string, string> {
  const doc = parseXml(xml)
  const map = new Map<string, string>()
  for (const r of Array.from(doc.getElementsByTagName('Relationship'))) {
    const id = r.getAttribute('Id')
    const target = r.getAttribute('Target')
    if (id && target) map.set(id, target)
  }
  return map
}

/** Resuelve una ruta relativa (como las de un .rels, relativas a la carpeta del part que las tiene) a una ruta absoluta del paquete. */
export function resolveRelPath(basePartPath: string, relativeTarget: string): string {
  if (relativeTarget.startsWith('/')) return relativeTarget.slice(1)
  const baseDir = basePartPath.split('/').slice(0, -1)
  const parts = [...baseDir, ...relativeTarget.split('/')]
  const out: string[] = []
  for (const p of parts) {
    if (p === '.' || p === '') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}
