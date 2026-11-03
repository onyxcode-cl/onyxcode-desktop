import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { ensureTitlePlaceholders, withTitlePlaceholder } from './pptx-titles'

const H = 6858000
const box = (id: number, name: string, y: number, sz: number, text: string): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="762000" y="${y}"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>` +
  `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="${sz}" b="1"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
const slide = (...shapes: string[]): string => `<p:sld><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`

describe('marcador de título del pptx', () => {
  it('el texto grande de la zona alta pasa a ser el título; el resto no cambia', () => {
    const xml = slide(
      box(2, 'TextBox 2', 787400, 4000, 'Puntos'),
      box(3, 'TextBox 3', 2000000, 2200, 'uno'),
      box(4, 'TextBox 8', 6350000, 1300, '02')
    )
    const out = withTitlePlaceholder(xml, H)!
    expect(out).toContain('<p:ph type="title"/>')
    expect(out.match(/<p:ph /g)).toHaveLength(1)
    expect(out.indexOf('<p:ph type="title"/>')).toBeLessThan(out.indexOf('uno'))
    // sin tocar posición, tamaño ni texto
    expect(out).toContain('y="787400"')
    expect(out).toContain('sz="4000"')
    expect(out).not.toContain('txBox="1"/><p:nvPr><p:ph')
  })

  it('tarjetas de KPI: el título es el de arriba, no la cifra grande de abajo', () => {
    const xml = slide(box(2, 'a', 787400, 4000, 'KPIs'), box(3, 'b', 2946400, 5400, '1'))
    const out = withTitlePlaceholder(xml, H)!
    expect(out.indexOf('<p:ph type="title"/>')).toBeLessThan(out.indexOf('>1<'))
  })

  it('portada o cifra gigante: gana la letra más grande de la parte alta', () => {
    const xml = slide(box(2, 'a', 1854200, 18800, 'Portada'), box(3, 'b', 4876800, 2800, 'sub'))
    const out = withTitlePlaceholder(xml, H)!
    expect(out.indexOf('<p:ph type="title"/>')).toBeLessThan(out.indexOf('sub'))
  })

  it('separador de sección: el título es el texto, no el «01»', () => {
    const xml = slide(box(2, 'n', 1500000, 8000, '01'), box(3, 't', 4000000, 4000, 'Seccion'))
    const out = withTitlePlaceholder(xml, H)!
    expect(out.indexOf('<p:ph type="title"/>')).toBeGreaterThan(out.indexOf('>01<'))
    expect(out.indexOf('<p:ph type="title"/>')).toBeLessThan(out.indexOf('Seccion'))
  })

  it('fija fuente, interlineado y anclaje para que el aspecto no cambie al heredar el patrón', () => {
    const out = withTitlePlaceholder(
      slide(box(2, 'a', 787400, 4000, 'Hola')).replace('<a:bodyPr/>', '<a:bodyPr wrap="square"/><a:lstStyle/>'),
      H
    )!
    expect(out).toContain('typeface="+mn-lt"')
    expect(out).toContain('<a:spcPct val="100000"/>')
    expect(out).toContain('anchor="t"')
  })

  it('una cifra como foco sin otro título sigue siendo el título', () => {
    const out = withTitlePlaceholder(slide(box(2, 'a', 1651000, 15000, '865'), box(3, 'b', 4191000, 2400, 'crecimiento')), H)!
    expect(out.indexOf('<p:ph type="title"/>')).toBeLessThan(out.indexOf('>865<'))
  })

  it('no toca una diapositiva que ya tiene título ni una sin texto', () => {
    const conTitulo = slide(
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr></p:sp>',
      box(3, 'b', 0, 2000, 'x')
    )
    expect(withTitlePlaceholder(conTitulo, H)).toBeNull()
    expect(withTitlePlaceholder(slide('<p:sp><p:nvSpPr><p:cNvPr id="2" name="O"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr></p:sp>'), H)).toBeNull()
  })

  it('sobre un .pptx completo: marca cada diapositiva y deja el archivo válido; un archivo roto vuelve igual', async () => {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', `<p:presentation><p:sldSz cx="12192000" cy="${H}"/></p:presentation>`)
    zip.file('ppt/slides/slide1.xml', slide(box(2, 'a', 787400, 4000, 'Uno')))
    zip.file('ppt/slides/slide2.xml', slide(box(2, 'a', 787400, 4000, 'Dos')))
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const out = await JSZip.loadAsync(await ensureTitlePlaceholders(buf))
    for (const n of [1, 2]) expect(await out.file(`ppt/slides/slide${n}.xml`)!.async('string')).toContain('<p:ph type="title"/>')
    const roto = Buffer.from('no es un zip')
    expect(await ensureTitlePlaceholders(roto)).toBe(roto)
    const corrupto = Buffer.concat([Buffer.from('PK'), Buffer.from('basura')])
    expect(await ensureTitlePlaceholders(corrupto)).toBe(corrupto)
  })
})
