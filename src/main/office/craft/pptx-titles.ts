/**
 * DeckCraft arma cada diapositiva con cajas de texto sueltas sobre el layout «Blank»: ninguna es un marcador de título, así que en PowerPoint
 * no hay esquema, la navegación no muestra títulos y los lectores de pantalla no anuncian nada. Aquí, sobre el .pptx ya generado, el texto
 * que hace de título pasa a ser su marcador de título (`<p:ph type="title"/>`) SIN tocar su posición, tamaño ni color: el aspecto no cambia.
 * Mismo criterio que `resources/opencode/skills/_shared/verificar_office.py` (`--arreglar`): el texto más grande de la zona alta
 * (35 % superior, letra de 24 pt o más) y, si no hay, el más grande de la diapositiva.
 * Nunca rompe la entrega: ante cualquier problema devuelve el archivo tal cual.
 */
import JSZip from 'jszip'

const SP = /<p:sp>[\s\S]*?<\/p:sp>/g
const DEFAULT_HEIGHT = 6858000
const PLAIN_LST =
  '<a:lvl1pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:defRPr><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>'

interface Cand {
  start: number
  end: number
  size: number
  top: number
  xml: string
}

function textOf(sp: string): string {
  return [...sp.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
    .map((m) => m[1])
    .join('')
    .trim()
}

function maxSize(sp: string): number {
  const sizes = [...sp.matchAll(/<a:rPr[^>]*\ssz="(\d+)"/g)].map((m) => Number(m[1]) / 100)
  return sizes.length ? Math.max(...sizes) : 0
}

/** Devuelve el XML de la diapositiva con su título convertido en marcador, o `null` si ya lo tiene o no hay candidato. */
export function withTitlePlaceholder(xml: string, slideHeight: number): string | null {
  if (/<p:ph[^>]*\stype="(title|ctrTitle)"/.test(xml)) return null
  const cands: Cand[] = []
  for (const m of xml.matchAll(SP)) {
    const sp = m[0]
    if (/<p:ph[\s/>]/.test(sp) || !textOf(sp)) continue
    const off = /<a:off x="-?\d+" y="(-?\d+)"/.exec(sp)
    cands.push({ start: m.index, end: m.index + sp.length, size: maxSize(sp), top: off ? Number(off[1]) : 0, xml: sp })
  }
  if (!cands.length) return null
  // Una etiqueta numérica («01» de una sección) es más grande que el título pero no lo es: se descarta si hay un texto con letras de tamaño
  // de título (28 pt o más) en la diapositiva. Una cifra como foco («865», «+27%») sin otro título sigue siendo el título.
  const altas = cands.filter((c) => c.top < slideHeight * 0.35 && c.size >= 24)
  let pool = altas.length ? altas : cands
  const etiqueta = (c: Cand): boolean => /^\d{1,3}$/.test(textOf(c.xml))
  if (pool.every(etiqueta)) {
    const titulos = cands.filter((c) => !etiqueta(c) && c.size >= 28)
    if (titulos.length) pool = titulos
  } else pool = pool.filter((c) => !etiqueta(c))
  const best = pool.reduce((a, b) => (b.size > a.size || (b.size === a.size && b.top < a.top) ? b : a))
  let sp = best.xml
  if (!/<p:nvPr\/>/.test(sp)) return null
  sp = sp.replace(/<p:nvPr\/>/, '<p:nvPr><p:ph type="title"/></p:nvPr>')
  sp = sp.replace(/<p:cNvSpPr[^>]*\/>/, '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>')
  // Un marcador hereda el estilo de título del patrón (fuente «mayor», interlineado, anclaje): se fija lo que tenía como caja de texto para
  // que el aspecto sea el mismo.
  sp = sp.replace(/<a:lstStyle\/>/, `<a:lstStyle>${PLAIN_LST}</a:lstStyle>`)
  sp = sp.replace(/<a:bodyPr(?![^>]*\sanchor=)/, '<a:bodyPr anchor="t"')
  return xml.slice(0, best.start) + sp + xml.slice(best.end)
}

export async function ensureTitlePlaceholders(pptx: Buffer): Promise<Buffer> {
  // Lo que no es un zip (un programa que falló o uno de pruebas) no se toca ni se comenta: no hay nada que marcar.
  if (pptx.length < 4 || pptx[0] !== 0x50 || pptx[1] !== 0x4b) return pptx
  try {
    const zip = await JSZip.loadAsync(pptx)
    const pres = await zip.file('ppt/presentation.xml')?.async('string')
    const height = Number(/<p:sldSz[^>]*\scy="(\d+)"/.exec(pres ?? '')?.[1]) || DEFAULT_HEIGHT
    let changed = 0
    for (const name of Object.keys(zip.files)) {
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue
      const xml = await zip.file(name)!.async('string')
      const next = withTitlePlaceholder(xml, height)
      if (next) {
        zip.file(name, next)
        changed++
      }
    }
    if (!changed) return pptx
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  } catch (e) {
    console.warn('[craft] no se pudieron marcar los títulos del pptx:', e instanceof Error ? e.message : e)
    return pptx
  }
}
