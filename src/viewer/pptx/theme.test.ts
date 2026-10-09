import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseXml } from './ooxml'
import { bgOf, hasNoFill, parseColorMap, parseColorScheme, resolveSchemeColor, solidFillOf, strokeOf } from './theme'

let restoreGlobals: () => void
beforeAll(() => {
  const dom = new JSDOM()
  const saved = { DOMParser: globalThis.DOMParser }
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser
  restoreGlobals = () => Object.assign(globalThis, saved)
})
afterAll(() => restoreGlobals())

const THEME_XML = `<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Oficina">
  <a:dk1><a:sysClr val="windowText" lastClr="222222"/></a:dk1>
  <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
  <a:dk2><a:srgbClr val="1F3864"/></a:dk2>
  <a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
  <a:accent1><a:srgbClr val="2F5496"/></a:accent1>
  <a:accent2><a:srgbClr val="C55A11"/></a:accent2>
  <a:accent3><a:srgbClr val="548235"/></a:accent3>
  <a:accent4><a:srgbClr val="BF9000"/></a:accent4>
  <a:accent5><a:srgbClr val="7030A0"/></a:accent5>
  <a:accent6><a:srgbClr val="0E7C86"/></a:accent6>
  <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
  <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme></a:themeElements></a:theme>`

describe('parseColorScheme', () => {
  it('lee los 12 nombres del esquema; sysClr usa lastClr', () => {
    const scheme = parseColorScheme(parseXml(THEME_XML))
    expect(scheme.dk1).toBe('#222222')
    expect(scheme.accent1).toBe('#2F5496')
    expect(scheme.hlink).toBe('#0563C1')
  })
})

describe('parseColorMap', () => {
  it('lee los alias del clrMap del maestro', () => {
    const doc = parseXml('<p:sldMaster xmlns:p="p"><p:clrMap bg1="lt1" tx1="dk1" accent1="accent1"/></p:sldMaster>')
    expect(parseColorMap(doc)).toEqual({ bg1: 'lt1', tx1: 'dk1', accent1: 'accent1' })
  })
  it('sin p:clrMap: objeto vacío, no lanza', () => {
    expect(parseColorMap(parseXml('<p:sldMaster xmlns:p="p"/>'))).toEqual({})
  })
})

describe('resolveSchemeColor', () => {
  let scheme: ReturnType<typeof parseColorScheme>
  beforeAll(() => {
    scheme = parseColorScheme(parseXml(THEME_XML))
  })
  const colorMap = { bg1: 'lt1', tx1: 'dk1' }
  it('un alias del clrMap (bg1) resuelve al color real del tema (lt1)', () => {
    expect(resolveSchemeColor('bg1', scheme, colorMap)).toBe('#FFFFFF')
  })
  it('un nombre directo del tema (accent2) no necesita el clrMap', () => {
    expect(resolveSchemeColor('accent2', scheme, colorMap)).toBe('#C55A11')
  })
  it('un nombre que no existe en ningún lado: undefined', () => {
    expect(resolveSchemeColor('noexiste', scheme, colorMap)).toBeUndefined()
  })
})

describe('solidFillOf', () => {
  let scheme: ReturnType<typeof parseColorScheme>
  beforeAll(() => {
    scheme = parseColorScheme(parseXml(THEME_XML))
  })
  const colorMap = {}

  it('a:srgbClr directo', () => {
    const el = parseXml('<a:rPr xmlns:a="a"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr>').documentElement
    expect(solidFillOf(el, scheme, colorMap)).toBe('#FF0000')
  })
  it('a:schemeClr, resuelto contra el tema', () => {
    const el = parseXml('<a:rPr xmlns:a="a"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:rPr>').documentElement
    expect(solidFillOf(el, scheme, colorMap)).toBe('#548235')
  })
  it('sin a:solidFill (o relleno de otro tipo, como un degradado): undefined, no lanza', () => {
    expect(solidFillOf(parseXml('<a:rPr xmlns:a="a"/>').documentElement, scheme, colorMap)).toBeUndefined()
    expect(solidFillOf(null, scheme, colorMap)).toBeUndefined()
  })

  it('con a:alpha: rgba() con la transparencia real, no el color sólido — bug real: un tinte del 8% opaco (pptxgenjs `transparency:92`) se pintaba 100% opaco, como un bloque sólido', () => {
    const el = parseXml(
      '<a:spPr xmlns:a="a"><a:solidFill><a:srgbClr val="1E2761"><a:alpha val="8000"/></a:srgbClr></a:solidFill></a:spPr>'
    ).documentElement
    expect(solidFillOf(el, scheme, colorMap)).toBe('rgba(30, 39, 97, 0.080)')
  })

  it('sin a:alpha: color sólido tal cual, no rgba (no cambia el caso de siempre)', () => {
    const el = parseXml('<a:spPr xmlns:a="a"><a:solidFill><a:srgbClr val="1E2761"/></a:solidFill></a:spPr>').documentElement
    expect(solidFillOf(el, scheme, colorMap)).toBe('#1E2761')
  })
})

describe('strokeOf', () => {
  it('color del contorno (a:ln > a:solidFill) — sin esto, una forma solo-contorno (fill:none) queda invisible', () => {
    const el = parseXml(
      '<p:spPr xmlns:p="p" xmlns:a="a"><a:ln><a:solidFill><a:srgbClr val="1E2761"/></a:solidFill></a:ln></p:spPr>'
    ).documentElement
    expect(strokeOf(el, {}, {})).toBe('#1E2761')
  })
  it('sin a:ln, o sin relleno en el contorno: undefined', () => {
    expect(strokeOf(parseXml('<p:spPr xmlns:p="p"/>').documentElement, {}, {})).toBeUndefined()
  })
})

describe('hasNoFill', () => {
  it('detecta un a:noFill directo', () => {
    expect(hasNoFill(parseXml('<a:ln xmlns:a="a"><a:noFill/></a:ln>').documentElement)).toBe(true)
    expect(hasNoFill(parseXml('<a:ln xmlns:a="a"/>').documentElement)).toBe(false)
  })
})

describe('bgOf', () => {
  it('<p:bgPr><a:solidFill> — lo que escribe pptxgenjs cuando el slide fija `background` directo (bug real que esto arregla: nunca se leía, así que el fondo a toda página de portada/sección/cifra/cierre nunca se pintaba)', () => {
    const cSld = parseXml(
      '<p:cSld xmlns:p="p" xmlns:a="a"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="1E2761"/></a:solidFill></p:bgPr></p:bg></p:cSld>'
    ).documentElement
    expect(bgOf(cSld, {}, {})).toBe('#1E2761')
  })

  it('<p:bgRef idx="…"> con el color directo (lo que escribe pptxgenjs en el maestro cuando no hay fondo propio) — el color sale de lo que trae el propio bgRef, sin resolver `idx` contra el tema', () => {
    const cSld = parseXml(
      '<p:cSld xmlns:p="p" xmlns:a="a"><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg></p:cSld>'
    ).documentElement
    expect(bgOf(cSld, { lt1: '#FFFFFF' }, { bg1: 'lt1' })).toBe('#FFFFFF')
  })

  it('sin <p:bg>, o null: undefined, no lanza (la herencia diapositiva→layout→maestro la resuelve `parseDeck`, no esta función)', () => {
    expect(bgOf(parseXml('<p:cSld xmlns:p="p"/>').documentElement, {}, {})).toBeUndefined()
    expect(bgOf(null, {}, {})).toBeUndefined()
  })
})
