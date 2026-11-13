import JSZip from 'jszip'

/** OOXML usa coma para agrupación y punto decimal; Office los localiza al idioma de quien lo abre. */
export const CHART_NUMBER_FORMAT = '#,##0.########'
export const chartNumber = (value: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 8 }).format(value)

/** DeckCraft no expone numFmt: se fija en las partes nativas, sin alterar cifras ni categorías. */
export async function formatChartNumbers(pptx: Buffer): Promise<Buffer> {
  if (pptx[0] !== 0x50 || pptx[1] !== 0x4b) return pptx
  const zip = await JSZip.loadAsync(pptx)
  let changed = false
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/charts\/chart\d+\.xml$/.test(name)) continue
    let xml = await zip.file(name)!.async('string')
    xml = xml.replace(/<c:formatCode>General<\/c:formatCode>/g, `<c:formatCode>${CHART_NUMBER_FORMAT}</c:formatCode>`)
    xml = xml.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, (axis) =>
      axis.replace(/<c:numFmt[^>]*\/>/, `<c:numFmt formatCode="${CHART_NUMBER_FORMAT}" sourceLinked="0"/>`)
    )
    xml = xml.replace(
      /<c:dLbls>([\s\S]*?)<\/c:dLbls>/g,
      (_, body: string) =>
        `<c:dLbls><c:numFmt formatCode="${CHART_NUMBER_FORMAT}" sourceLinked="0"/>${body.replace(/<c:numFmt[^>]*\/>/g, '')}</c:dLbls>`
    )
    zip.file(name, xml)
    changed = true
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : pptx
}
