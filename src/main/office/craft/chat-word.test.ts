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
    ['bloque desconocido', { blocks: [{ type: 'image', path: 'x.png' }] }],
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
