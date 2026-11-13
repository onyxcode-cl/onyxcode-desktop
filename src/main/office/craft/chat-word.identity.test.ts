import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { DocxSpec } from '@shared/chat-doc-spec'
import { chatDocxCommands, renderChatDocx } from './chat-word'
import { docxContrastProblems } from '../../documents/review-checks'

const specimen: DocxSpec = {
  title: 'Museo del mar',
  cover: true,
  header: 'Cuaderno de conservación',
  page_numbers: false,
  identity: {
    concept: 'Editorial marina',
    palette: { bg: '#FFFFFF', text: '#24333A', accent: '#155B52' },
    fonts: { title: 'Georgia', body: 'Tahoma' },
    titles: 'editorial',
    cover: 'band',
    headers: 'accent'
  },
  blocks: [
    { type: 'heading', level: 1, text: 'Conservación' },
    { type: 'paragraph', text: 'Seguimiento de la biodiversidad costera.' },
    {
      type: 'table',
      columns: ['Zona', 'Estaciones'],
      rows: [
        ['Costa', 12],
        ['Estuario', 8]
      ]
    }
  ]
}

describe('Word aplica la identidad', () => {
  it('usa fuentes, colores, encabezado y portada solicitados en los comandos reales', () => {
    const commands = chatDocxCommands(specimen).flat()
    expect(commands).toContain('design.themeFonts={"heading":"Georgia","body":"Tahoma"}')
    expect(commands).toContain('format.font={"name":"Georgia"}')
    expect(commands).toContain('format.font={"name":"Tahoma"}')
    expect(commands).toContain('format.color={"color":"155B52"}')
    expect(commands).toContain('table.shading={"color":"155B52"}')
    expect(commands).toContain('para.shading={"color":"155B52"}')
    const paragraph = chatDocxCommands(specimen).find((g) => g.includes('text.insert={"text":"Seguimiento de la biodiversidad costera."}'))!
    expect(paragraph).toContain('format.color={"color":"24333A"}')
    expect(paragraph).toContain('format.font={"name":"Tahoma"}')
  })
  it('tres portadas cambian alineación y espaciado, y el cuerpo no hereda la banda', () => {
    const commands = (cover: 'left' | 'center' | 'band'): string[] =>
      chatDocxCommands({ ...specimen, identity: { ...specimen.identity, cover } }).flat()
    expect(commands('left')).not.toEqual(commands('center'))
    expect(commands('center')).not.toEqual(commands('band'))
    const band = commands('band')
    expect(band.lastIndexOf('para.shading={"color":null}')).toBeGreaterThan(band.indexOf('para.shading={"color":"155B52"}'))
  })
  it.skipIf(!process.env.WORDCRAFT_CLI)(
    'WordCraft escribe la identidad y el contenido en DOCX real',
    async () => {
      const zip = await JSZip.loadAsync(await renderChatDocx(process.env.WORDCRAFT_CLI!, specimen))
      const document = await zip.file('word/document.xml')!.async('string')
      expect(document).toContain('w:ascii="Georgia"')
      expect(document).toContain('w:ascii="Tahoma"')
      expect(document).toContain('w:val="155B52"')
      expect(document).toContain('w:fill="155B52"')
      expect(document).toContain('Seguimiento de la biodiversidad costera.')
      expect(docxContrastProblems(document)).toEqual([])
      const headerNames = Object.keys(zip.files).filter((name) => /^word\/header\d+\.xml$/.test(name))
      const headers = (await Promise.all(headerNames.map((name) => zip.file(name)!.async('string')))).join('')
      expect(headers).toContain('Cuaderno de conservación')
      expect(headers).toContain('w:val="155B52"')
    },
    60_000
  )
})
