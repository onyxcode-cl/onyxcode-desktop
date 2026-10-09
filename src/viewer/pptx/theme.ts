/**
 * Resuelve colores de OOXML a css (Fase 4 del plan del visor): un `<a:solidFill>` casi nunca trae el
 * color directo (`a:srgbClr`), lo normal es una referencia al esquema del tema (`a:schemeClr`), que
 * además pasa por el `<p:clrMap>` del maestro (bg1/tx1/bg2/tx2 son alias, no nombres del tema).
 */
import { attrNum, directChild, directChildren } from './ooxml'

export type ColorScheme = Record<string, string>

const SCHEME_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']

/** `theme1.xml` → mapa de los 12 nombres del esquema a su color css (`#rrggbb`). */
export function parseColorScheme(themeXml: Document): ColorScheme {
  const clrScheme = themeXml.getElementsByTagName('a:clrScheme')[0] ?? null
  const scheme: ColorScheme = {}
  for (const slot of SCHEME_SLOTS) {
    const el = directChild(clrScheme, `a:${slot}`)
    const srgb = el ? directChild(el, 'a:srgbClr') : null
    const sys = el ? directChild(el, 'a:sysClr') : null
    const val = srgb?.getAttribute('val') ?? sys?.getAttribute('lastClr')
    if (val) scheme[slot] = `#${val}`
  }
  return scheme
}

/** `<p:clrMap bg1="lt1" tx1="dk1" .../>` del maestro: alias → nombre real del esquema. */
export function parseColorMap(masterDoc: Document): Record<string, string> {
  const map = masterDoc.getElementsByTagName('p:clrMap')[0]
  const out: Record<string, string> = {}
  if (!map) return out
  for (const alias of ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
    const real = map.getAttribute(alias)
    if (real) out[alias] = real
  }
  return out
}

/** Nombre tal como aparece en `a:schemeClr val="…"` (puede ser un alias de `clrMap` o un nombre directo del tema). */
export function resolveSchemeColor(name: string, scheme: ColorScheme, colorMap: Record<string, string>): string | undefined {
  const real = colorMap[name] ?? name
  return scheme[real]
}

/** `<a:alpha val="NNNNN"/>` (milésimas de porcentaje: 100000 = 100% opaco) dentro de un color — si no
 * está, el color es opaco. `pptxgenjs` lo usa para `transparency` (`addShape({fill:{transparency}})`):
 * sin leerlo, un relleno pensado como un tinte sutil (8% opaco) se pintaba 100% opaco, como un bloque
 * sólido — eso es lo que hacía ver "feas" a las tarjetas/círculos de textura nuevos del visor. */
function alphaOf(colorEl: Element | null): number {
  const alpha = directChild(colorEl, 'a:alpha')
  const val = attrNum(alpha, 'val')
  return val === undefined ? 1 : val / 100_000
}

function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, alpha).toFixed(3)})`
}

/** `<a:srgbClr>`/`<a:schemeClr>` hijo DIRECTO de `container` (ya sea un `<a:solidFill>` o, para el
 * fondo de diapositiva, un `<p:bgRef>` — ese trae el color directo, sin envolverlo en `a:solidFill`),
 * resuelto a css con su transparencia si trae `a:alpha`. */
function colorChildOf(container: Element | null, scheme: ColorScheme, colorMap: Record<string, string>): string | undefined {
  const srgb = directChild(container, 'a:srgbClr')
  if (srgb) return withAlpha(`#${srgb.getAttribute('val')}`, alphaOf(srgb))
  const schemeClr = directChild(container, 'a:schemeClr')
  if (schemeClr) {
    const hex = resolveSchemeColor(schemeClr.getAttribute('val') ?? '', scheme, colorMap)
    return hex ? withAlpha(hex, alphaOf(schemeClr)) : undefined
  }
  return undefined
}

/** El primer `<a:solidFill>` hijo directo de `el`, resuelto a css (con su transparencia si trae `a:alpha`), o undefined si no hay o es otro tipo de relleno. */
export function solidFillOf(el: Element | null, scheme: ColorScheme, colorMap: Record<string, string>): string | undefined {
  return colorChildOf(directChild(el, 'a:solidFill'), scheme, colorMap)
}

/** true si el elemento (o su `a:ln`) trae `<a:noFill/>` explícito. */
export function hasNoFill(el: Element | null): boolean {
  return directChildren(el, 'a:noFill').length > 0
}

/** Color del CONTORNO (`<a:ln><a:solidFill>…`) — sin esto, una forma sin relleno pero con borde (p.ej.
 * el círculo "insignia" solo-contorno del layout "stat" de PowerPoint) queda totalmente invisible. */
export function strokeOf(spPr: Element | null, scheme: ColorScheme, colorMap: Record<string, string>): string | undefined {
  return solidFillOf(directChild(spPr, 'a:ln'), scheme, colorMap)
}

/**
 * Fondo (`<p:bg>`) de UN `<p:cSld>` (diapositiva, layout o maestro) — nunca la herencia completa, eso
 * lo resuelve `backgroundOf` en `model.ts`, que prueba diapositiva→layout→maestro en ese orden (según
 * ECMA-376 §19.3.1.1: si la diapositiva no trae `<p:bg>` propio, hereda del layout; si tampoco, del
 * maestro). Dos formas: `<p:bgPr><a:solidFill>…` (lo que escribe `pptxgenjs` cuando el slide fija
 * `background` directo) o `<p:bgRef idx="…">` (una referencia al `bgFillStyleLst` del tema — el color
 * que trae el propio `bgRef` es el que se usa de verdad incluso sin resolver `idx` contra el tema).
 */
export function bgOf(cSld: Element | null, scheme: ColorScheme, colorMap: Record<string, string>): string | undefined {
  const bg = directChild(cSld, 'p:bg')
  if (!bg) return undefined
  const bgPr = directChild(bg, 'p:bgPr')
  if (bgPr) return solidFillOf(bgPr, scheme, colorMap)
  const bgRef = directChild(bg, 'p:bgRef')
  return bgRef ? colorChildOf(bgRef, scheme, colorMap) : undefined
}
