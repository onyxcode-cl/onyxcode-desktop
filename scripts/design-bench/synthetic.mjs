import JSZip from 'jszip'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CASES } from './cases.mjs'

const escape = (x) => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const colors = ['1F3864', '384938', '7B432A', '5E335E', '2A5858']
export function syntheticSlide(text, variant = 0) {
  const x = variant % 3 === 0 ? 480000 : variant % 3 === 1 ? 4300000 : 1200000
  return `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FAF8F2"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="${x}" y="600000"/><a:ext cx="${8000000 - x}" cy="1400000"/></a:xfrm><a:solidFill><a:srgbClr val="${colors[variant % colors.length]}"/></a:solidFill></p:spPr><p:txBody><a:p><a:r><a:rPr sz="3200"><a:latin typeface="${variant % 2 ? 'Georgia' : 'Arial'}"/></a:rPr><a:t>${escape(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
}
export async function syntheticPptx(text, variant = 0) {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
  )
  zip.file(
    'ppt/presentation.xml',
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>'
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'
  )
  zip.file('ppt/slides/slide1.xml', syntheticSlide(text, variant))
  zip.file('ppt/slides/slide2.xml', syntheticSlide(text + ' detalle', (variant + 1) % 5))
  return zip.generateAsync({ type: 'nodebuffer' })
}
export async function syntheticDocx(text, variant = 0) {
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/><w:ind w:left="${variant * 160}"/><w:spacing w:after="${variant * 80}"/></w:pPr><w:r><w:t>${escape(text)}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="${8000 - variant * 400}"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>12</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`
  )
  zip.file(
    'word/styles.xml',
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="Title"><w:rPr><w:rFonts w:ascii="${variant % 2 ? 'Georgia' : 'Arial'}"/><w:color w:val="${colors[variant % colors.length]}"/><w:sz w:val="48"/></w:rPr></w:style></w:styles>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}
export function syntheticPdfLayout(text, variant = 0) {
  return `<pdf2xml><page number="1" width="900" height="1200"><fontspec id="0" size="24" family="${variant % 2 ? 'Georgia' : 'Arial'}" color="#${colors[variant % colors.length]}"/><text left="${60 + variant * 70}" top="80" width="${650 - variant * 70}" height="50" font="0">${escape(text)}</text><text left="60" top="${200 + variant * 70}" width="700" height="70" font="0">Resumen</text></page></pdf2xml>`
}
export async function writeSynthetic(dir, variant = 'diverse') {
  await mkdir(dir, { recursive: true })
  const documents = []
  for (const [i, item] of CASES.entries()) {
    const v = variant === 'same' ? 0 : i % 5
    for (const format of ['pptx', 'docx', 'pdf-layout']) {
      const path = `${item.id}.${format === 'pdf-layout' ? 'pdf.layout.xml' : format}`
      const bytes =
        format === 'pptx'
          ? await syntheticPptx(item.title, v)
          : format === 'docx'
            ? await syntheticDocx(item.title, v)
            : syntheticPdfLayout(item.title, v)
      await writeFile(join(dir, path), bytes, { flag: 'wx' })
      documents.push({ id: `${item.id}-${format}`, topic: item.topic, format, path })
    }
  }
  const manifest = {
    synthetic: true,
    warning: 'Fixtures mínimos para probar el medidor, no archivos Office completos ni PDFs renderizados.',
    documents
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  return manifest
}
