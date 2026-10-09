import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attrNum, directChild, directChildren, emuToPercent, parseRels, parseXml, readXfrm, readXfrmDirect, resolveRelPath } from './ooxml'

let restoreGlobals: () => void
beforeAll(() => {
  const dom = new JSDOM()
  const saved = { DOMParser: globalThis.DOMParser }
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser
  restoreGlobals = () => Object.assign(globalThis, saved)
})
afterAll(() => restoreGlobals())

describe('emuToPercent', () => {
  it('convierte EMU a porcentaje del total de la diapositiva', () => {
    expect(emuToPercent(1_000_000, 10_000_000)).toBe(10)
    expect(emuToPercent(0, 10_000_000)).toBe(0)
  })
  it('con total 0 (diapositiva sin tamaño conocido): 0, no Infinity ni NaN', () => {
    expect(emuToPercent(500, 0)).toBe(0)
  })
})

describe('readXfrm', () => {
  it('lee x/y/cx/cy directos de un p:spPr', () => {
    const spPr = parseXml(
      '<p:spPr xmlns:p="p" xmlns:a="a"><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr>'
    ).documentElement
    expect(readXfrm(spPr)).toEqual({ xEmu: 100, yEmu: 200, cxEmu: 300, cyEmu: 400 })
  })
  it('sin a:xfrm, o con a:off/a:ext incompletos: null, no lanza', () => {
    expect(readXfrm(parseXml('<p:spPr xmlns:p="p"/>').documentElement)).toBeNull()
    const incompleto = parseXml('<p:spPr xmlns:p="p" xmlns:a="a"><a:xfrm><a:off x="1" y="1"/></a:xfrm></p:spPr>').documentElement
    expect(readXfrm(incompleto)).toBeNull()
    expect(readXfrm(null)).toBeNull()
  })
})

describe('readXfrmDirect', () => {
  it('lee x/y/cx/cy de un elemento que YA es el contenedor de transformación (el `p:xfrm` de un graphicFrame, no envuelto en otro a:xfrm) — bug real: una tabla/gráfico sin esto cae siempre en la cajita de respaldo, ignorando su posición/tamaño de verdad', () => {
    const xfrm = parseXml('<p:xfrm xmlns:p="p" xmlns:a="a"><a:off x="111" y="222"/><a:ext cx="333" cy="444"/></p:xfrm>').documentElement
    expect(readXfrmDirect(xfrm)).toEqual({ xEmu: 111, yEmu: 222, cxEmu: 333, cyEmu: 444 })
  })
  it('sin a:off/a:ext, o null: null, no lanza', () => {
    expect(readXfrmDirect(parseXml('<p:xfrm xmlns:p="p"/>').documentElement)).toBeNull()
    expect(readXfrmDirect(null)).toBeNull()
  })
})

describe('parseRels', () => {
  it('mapea Id -> Target', () => {
    const xml = `<Relationships xmlns="x"><Relationship Id="rId1" Type="t" Target="slides/slide1.xml"/>
      <Relationship Id="rId2" Type="t" Target="../media/image1.png"/></Relationships>`
    const rels = parseRels(xml)
    expect(rels.get('rId1')).toBe('slides/slide1.xml')
    expect(rels.get('rId2')).toBe('../media/image1.png')
  })
})

describe('resolveRelPath', () => {
  it('resuelve relativo a la carpeta del part que tiene el .rels', () => {
    expect(resolveRelPath('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png')
    expect(resolveRelPath('ppt/presentation.xml', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml')
  })
  it('una ruta que empieza con "/" es absoluta al paquete, no relativa', () => {
    expect(resolveRelPath('ppt/slides/slide1.xml', '/ppt/media/image1.png')).toBe('ppt/media/image1.png')
  })
  it('".." no puede sacar la ruta fuera de lo razonable (se descarta silenciosamente si no hay nada que subir)', () => {
    expect(resolveRelPath('a.xml', '../../fuera.xml')).toBe('fuera.xml')
  })
})

describe('directChild / directChildren / attrNum', () => {
  it('directChildren NO baja a los nietos (un hijo anidado del mismo nombre no cuenta dos veces)', () => {
    const el = parseXml('<a xmlns="x"><b id="1"><b id="nieto"/></b><b id="2"/></a>').documentElement
    expect(directChildren(el, 'b').map((c) => c.getAttribute('id'))).toEqual(['1', '2'])
    expect(directChild(el, 'b')?.getAttribute('id')).toBe('1')
  })
  it('attrNum da undefined con el elemento nulo, el atributo ausente o un valor no numérico', () => {
    const el = parseXml('<a x="10" y="abc"/>').documentElement
    expect(attrNum(el, 'x')).toBe(10)
    expect(attrNum(el, 'y')).toBeUndefined()
    expect(attrNum(el, 'z')).toBeUndefined()
    expect(attrNum(null, 'x')).toBeUndefined()
  })
})
