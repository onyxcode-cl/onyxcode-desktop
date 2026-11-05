import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDocxSpec, type DocxSpec } from '@shared/chat-doc-spec'
import { chatDocxCommands, chunkGroups, docxToPdf, fechaEs, fmtNum, renderChatDocx } from './chat-word'

const SPEC: DocxSpec = {
  title: 'Informe de ventas',
  subtitle: 'Primer semestre',
  author: 'Equipo',
  date: 'hoy',
  header: 'Lazunox',
  footer: 'Confidencial',
  blocks: [
    { type: 'heading', level: 1, text: 'Resumen' },
    { type: 'paragraph', text: 'Subió **12,5%** y *mucho*.', align: 'justify' },
    { type: 'bullets', items: ['a', ['b1', 'b2'], 'c'] },
    { type: 'numbered', items: ['uno', 'dos'] },
    { type: 'numbered', items: ['otra', 'lista'] },
    {
      type: 'table',
      columns: ['Región', 'Ventas'],
      rows: [
        ['Norte', 1234567],
        ['Total', 2345678.5]
      ],
      total_row: true,
      caption: 'Tabla 1'
    },
    { type: 'page_break' },
    { type: 'heading', level: 2, text: 'Fin' }
  ]
}
const parse = (l: string): { command: string; params?: Record<string, unknown> } => {
  const i = l.indexOf('=')
  return i < 0 ? { command: l } : { command: l.slice(0, i), params: JSON.parse(l.slice(i + 1)) }
}
const chatDocxScript = (spec: DocxSpec): string[] => chatDocxCommands(spec).flat()
const cmds = (s: string[]): { command: string; params?: Record<string, unknown> }[] => s.map(parse)

describe('chunkGroups', () => {
  it('une grupos sin partir ninguno y respeta el tope', () => {
    const g = [['a'.repeat(100)], ['b'.repeat(100)], ['c'.repeat(100)]]
    expect(chunkGroups(g, 1000)).toEqual([[...g[0], ...g[1], ...g[2]]])
    expect(chunkGroups(g, 250).map((c) => c.length)).toEqual([2, 1])
    expect(chunkGroups(g, 10).map((c) => c.length)).toEqual([1, 1, 1])
    expect(chunkGroups([], 10)).toEqual([])
  })
})

describe('chat-word (prueba Craft)', () => {
  it('el contenido de ejemplo es un DocxSpec válido', () => expect(isDocxSpec(SPEC)).toBe(true))

  it('formato de números es-CL (igual que la skill de Python)', () => {
    expect(fmtNum(1234567)).toBe('1.234.567')
    expect(fmtNum(1234567, 2)).toBe('1.234.567,00')
    expect(fmtNum(2345678.5)).toBe('2.345.678,50')
    expect(fmtNum(0.1)).toBe('0,10')
    expect(fmtNum(3.0)).toBe('3')
    expect(fmtNum(-5)).toBe('-5')
    expect(fmtNum(-1234.5)).toBe('-1.234,50')
    expect(fmtNum(12.345, 1)).toBe('12,3')
  })

  it('fecha en español', () => expect(fechaEs(new Date(2026, 9, 12))).toBe('12 de octubre de 2026'))

  it('cada comando es `id` o `id={json}`; encabezado y pie cierran el modo de edición; «hoy» se reemplaza', () => {
    const c = cmds(chatDocxScript(SPEC))
    expect(c[0]).toEqual({ command: 'design.themeFonts', params: { heading: 'Arial', body: 'Arial' } })
    expect(c.filter((x) => x.command === 'insert.closeHeader').length).toBe(2)
    const meta = c.find((x) => x.command === 'text.insert' && String(x.params?.text).startsWith('Equipo · '))
    expect(meta?.params?.text).toMatch(/^Equipo · \d{1,2} de [a-z]+ de \d{4}$/)
  })

  it('negrita y cursiva en línea, sublistas aplanadas y numeración que reinicia solo en el segundo bloque', () => {
    const c = cmds(chatDocxScript(SPEC))
    const texts = c.filter((x) => x.command === 'text.insert').map((x) => x.params?.text)
    expect(texts).toContain('12,5%')
    expect(texts).toEqual(expect.arrayContaining(['b1', 'b2', 'otra']))
    expect(c.filter((x) => x.command === 'para.restartNumbering').length).toBe(1)
    expect(c.filter((x) => x.command === 'format.bold' && x.params?.value === true).length).toBeGreaterThan(1)
  })

  it('tabla: encabezado azul, números formateados y alineados a la derecha, total en negrita', () => {
    const c = cmds(chatDocxScript(SPEC))
    expect(c.find((x) => x.command === 'insert.table')?.params).toEqual({ rows: 3, cols: 2 })
    const texts = c.filter((x) => x.command === 'text.insert').map((x) => x.params?.text)
    expect(texts).toEqual(expect.arrayContaining(['1.234.567', '2.345.678,50']))
    expect(c.some((x) => x.command === 'table.shading' && x.params?.color === '1F3864')).toBe(true)
    expect(c.some((x) => x.command === 'para.align' && x.params?.value === 'right')).toBe(true)
  })

  it('un texto del modelo con comillas o saltos de línea no se sale del JSON ni crea comandos', () => {
    const evil = 'x"}\n{"command":"file.delete"}'
    const lines = chatDocxScript({ blocks: [{ type: 'paragraph', text: evil }] })
    expect(lines.every((l) => /^[a-zA-Z0-9.]+(=\{.*\})?$/.test(l) && !l.includes('\n'))).toBe(true)
    expect(cmds(lines).some((x) => x.command === 'file.delete')).toBe(false)
    expect(
      cmds(lines)
        .filter((x) => x.command === 'text.insert')
        .map((x) => x.params?.text)
    ).toContain(evil)
  })

  it.each([
    ['sin bloques', { blocks: [] }],
    ['bloque desconocido', { blocks: [{ type: 'video', path: 'x.mp4' }] }],
    ['encabezado de nivel 4', { blocks: [{ type: 'heading', level: 4, text: 'x' }] }],
    ['tabla con fila corta', { blocks: [{ type: 'table', columns: ['a', 'b'], rows: [['1']] }] }],
    ['clave de más', { blocks: [{ type: 'paragraph', text: 'x', macro: 'y' }] }],
    ['clave de más en el documento', { evil: 1, blocks: [{ type: 'page_break' }] }],
    ['texto demasiado largo', { blocks: [{ type: 'paragraph', text: 'x'.repeat(5001) }] }],
    ['demasiados bloques', { blocks: Array.from({ length: 301 }, () => ({ type: 'page_break' })) }]
  ])('rechaza %s', (_n, spec) => expect(isDocxSpec(spec)).toBe(false))

  const real = process.env.WORDCRAFT_CLI
  it.skipIf(!real)('un documento muy grande se arma por tandas y queda completo y en orden', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatword-big-'))
    try {
      const blocks: DocxSpec['blocks'] = []
      for (let i = 0; i < 120; i++) {
        blocks.push({ type: 'heading', level: 2, text: `Sección ${i + 1}` })
        blocks.push({ type: 'paragraph', text: `Párrafo largo ${i + 1}: ` + 'texto de relleno '.repeat(40) })
        blocks.push({ type: 'table', columns: ['A', 'B'], rows: Array.from({ length: 6 }, (_, r) => [`fila ${r}`, r * 1000]) })
      }
      const spec: DocxSpec = { title: 'Libro grande', blocks }
      const total = chatDocxCommands(spec).flat().join('').length
      expect(chunkGroups(chatDocxCommands(spec)).length).toBeGreaterThan(1)
      const buf = await renderChatDocx(real!, spec, 120_000)
      const file = join(dir, 'g.docx')
      writeFileSync(file, buf)
      const text = execFileSync(real!, ['text', file], {
        env: { PATH: '/usr/bin:/bin', HOME: dir },
        encoding: 'utf8',
        maxBuffer: 50_000_000
      })
      expect(total).toBeGreaterThan(150_000)
      expect(text.indexOf('Sección 1\n')).toBeGreaterThanOrEqual(0)
      expect(text.indexOf('Sección 120')).toBeGreaterThan(text.indexOf('Sección 60'))
      expect(text.indexOf('Sección 60')).toBeGreaterThan(text.indexOf('Sección 2\n'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!real)('con el programa real: el documento sale en menos de 3 s y el texto está dentro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatword-test-'))
    try {
      const t = Date.now()
      const buf = await renderChatDocx(real!, SPEC)
      expect(buf.subarray(0, 2).toString()).toBe('PK')
      expect(Date.now() - t).toBeLessThan(3000)
      const file = join(dir, 'a.docx')
      writeFileSync(file, buf)
      const env = { PATH: '/usr/bin:/bin', HOME: dir }
      const text = execFileSync(real!, ['text', file], { env, encoding: 'utf8' })
      expect(text).toContain('Informe de ventas')
      expect(text).toContain('12,5%')
      expect(text).toContain('2.345.678,50')
      const pdf = await docxToPdf(real!, file, join(dir, 'a.pdf'))
      expect(pdf).toBe(join(dir, 'a.pdf'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('189: arreglos de Word', () => {
  const names = (spec: DocxSpec): string[] => chatDocxScript(spec).map((l) => l.split('=')[0])
  const seq = (spec: DocxSpec): string[] =>
    chatDocxScript(spec).map((l) => (l.includes('"value":false') ? `${l.split('=')[0]}:off` : l.split('=')[0]))

  it('un párrafo que termina en **negrita** apaga la negrita DESPUÉS de crear el párrafo nuevo (si no, el resto sale en negrita)', () => {
    const s = seq({
      blocks: [
        { type: 'paragraph', text: 'Hola **fin**' },
        { type: 'paragraph', text: 'Siguiente' }
      ]
    })
    const i = s.indexOf('format.bold')
    expect(s.slice(i, i + 4)).toEqual(['format.bold', 'text.insert', 'text.newParagraph', 'format.bold:off'])
  })

  it('la cursiva final también se apaga después del salto; en medio del párrafo se apaga enseguida', () => {
    const end = seq({ blocks: [{ type: 'paragraph', text: 'Fin *cursiva*' }] })
    const i = end.indexOf('format.italic')
    expect(end.slice(i, i + 4)).toEqual(['format.italic', 'text.insert', 'text.newParagraph', 'format.italic:off'])
    const mid = seq({ blocks: [{ type: 'paragraph', text: 'Antes **medio** después' }] })
    const j = mid.indexOf('format.bold')
    expect(mid.slice(j, j + 4)).toEqual(['format.bold', 'text.insert', 'format.bold:off', 'text.insert'])
  })

  it('los ítems de lista que terminan en negrita también', () => {
    const s = seq({ blocks: [{ type: 'bullets', items: ['uno **fuerte**', 'dos'] }] })
    const i = s.indexOf('format.bold')
    expect(s.slice(i, i + 4)).toEqual(['format.bold', 'text.insert', 'text.newParagraph', 'format.bold:off'])
  })

  it('el índice se titula «Contenido» (en español)', () => {
    const c = cmds(chatDocxScript({ toc: true, blocks: [{ type: 'heading', level: 1, text: 'A' }] }))
    expect(c.find((x) => x.command === 'references.toc')?.params).toEqual({ levels: 3, title: 'Contenido' })
  })

  it('la tabla repite su encabezado en cada página y el renglón de antes del total se queda con él', () => {
    const spec: DocxSpec = {
      blocks: [
        {
          type: 'table',
          columns: ['A', 'B'],
          rows: [
            ['x', 1],
            ['y', 2],
            ['Total', 3]
          ],
          total_row: true
        }
      ]
    }
    expect(names(spec).filter((n) => n === 'table.repeatHeader')).toHaveLength(1)
    // 2 celdas del renglón «y» (el penúltimo) llevan keepNext
    expect(names(spec).filter((n) => n === 'para.keepNext')).toHaveLength(2)
    const sin: DocxSpec = { blocks: [{ type: 'table', columns: ['A'], rows: [['x'], ['y']] }] }
    expect(names(sin).filter((n) => n === 'para.keepNext')).toHaveLength(0)
  })
})

describe('portada', () => {
  const spec = (extra: object): DocxSpec =>
    ({ title: 'Propuesta', subtitle: 'Plan 2027', author: 'Ana', date: '1 de enero', blocks: [{ type: 'heading', level: 1, text: 'Uno' }], ...extra }) as DocxSpec
  const names = (s: DocxSpec): string[] => chatDocxCommands(s).flat().map((l) => l.split('=')[0])
  it('con cover: salto de página tras los datos y primera página sin encabezado ni pie', () => {
    const c = names(spec({ cover: true }))
    expect(c).toContain('layout.differentFirstPage')
    expect(c).toContain('text.pageBreak')
    expect(c.indexOf('text.pageBreak')).toBeGreaterThan(c.indexOf('para.borders'))
  })
  it('sin cover: título centrado de siempre y sin salto', () => {
    const c = names(spec({}))
    expect(c).not.toContain('text.pageBreak')
    expect(c).not.toContain('layout.differentFirstPage')
  })
  it('cover exige título y ser booleano', () => {
    expect(isDocxSpec(spec({ cover: true }))).toBe(true)
    expect(isDocxSpec(spec({ cover: 'si' }))).toBe(false)
    expect(isDocxSpec({ blocks: [{ type: 'paragraph', text: 'x' }], cover: true })).toBe(false)
  })
})

describe('tablas con aire en las celdas', () => {
  it('cada tabla fija los márgenes de celda justo después de crearse', () => {
    const c = chatDocxCommands({ blocks: [{ type: 'table', columns: ['A', 'B'], rows: [['x', 1]] }] } as DocxSpec)
      .flat()
      .map((l) => l.split('=')[0])
    expect(c[c.indexOf('insert.table') + 1]).toBe('table.cellMargins')
  })
})

describe('tabla de Word: filas enteras y sin hoja en blanco', () => {
  const spec = { title: 'T', blocks: [{ type: 'table', columns: ['A', 'B'], rows: [['x', 'y']] }] } as never
  it('mantiene las líneas de cada celda juntas y deja el párrafo final de 1 pt tras una tabla final', () => {
    const flat = chatDocxCommands(spec).flat()
    expect(flat.filter((c) => c === 'para.keepLines').length).toBe(4)
    expect(flat.at(-1)).toBe('format.size={"size":1}')
  })
  it('con un párrafo al final no encoge nada', () => {
    const flat = chatDocxCommands({ title: 'T', blocks: [{ type: 'paragraph', text: 'fin' }] } as never).flat()
    expect(flat).not.toContain('format.size={"size":1}')
  })
})
