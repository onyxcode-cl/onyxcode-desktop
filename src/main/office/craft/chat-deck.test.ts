import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPptxSpec, type PptxSpec } from '@shared/chat-doc-spec'
import { chatCoverSize, chatDeckCommands, deckToPdf, renderChatDeck } from './chat-deck'

const FULL: PptxSpec = {
  theme: 'warm',
  footer: 'Pie',
  slides: [
    { title: 'Portada', bullets: ['Sub', 'Nota'], eyebrow: 'Etiqueta' },
    { title: 'Sección', eyebrow: '01' },
    { title: 'Viñetas', bullets: ['a', 'b', 'c'] },
    { title: '80%', layout: 'stat', bullets: ['explica', 'extra 1', 'extra 2'] },
    { title: 'Pasos', layout: 'steps', bullets: ['uno', 'dos', 'tres'] },
    {
      title: 'Dos',
      layout: 'two-col',
      columns: [
        { heading: 'A', bullets: ['x'] },
        { heading: 'B', bullets: ['y'] }
      ]
    },
    { title: 'Dos sin columnas', layout: 'two-col', bullets: ['x', 'y', 'z'] },
    { title: 'Tarjetas', layout: 'cards', bullets: ['t1', 't2', 't3', 't4', 't5'] },
    { title: 'Gráfico', layout: 'chart', chart: { type: 'bar', categories: ['a', 'b'], values: [1, 2] } },
    { title: 'Torta', layout: 'chart', chart: { type: 'pie', categories: ['a', 'b'], values: [1, 2] } },
    {
      title: 'KPIs',
      layout: 'kpis',
      kpis: [
        { label: 'L1', value: '1', delta: '+2%' },
        { label: 'L2', value: '2', delta: '-1%' }
      ]
    },
    { title: 'Cierre', layout: 'closing', bullets: ['Gracias'] }
  ]
}

describe('chatDeckCommands (prueba Craft)', () => {
  it('el contenido de ejemplo es un PptxSpec válido', () => expect(isPptxSpec(FULL)).toBe(true))

  it('empieza y termina bien y crea una diapositiva por entrada', () => {
    const cmds = chatDeckCommands(FULL)
    expect(cmds[0]).toBe('file.new')
    expect(cmds[cmds.length - 1]).toBe('slide.delete={"index":0}')
    expect(cmds.filter((c) => c.startsWith('slide.new=')).length).toBe(FULL.slides.length)
  })

  it('cada comando es `id` o `id={json válido}`', () => {
    for (const c of chatDeckCommands(FULL)) {
      const eq = c.indexOf('=')
      if (eq < 0) continue
      expect(c.slice(0, eq)).toMatch(/^[a-z]+\.[a-zA-Z0-9]+$/)
      expect(() => JSON.parse(c.slice(eq + 1))).not.toThrow()
    }
  })

  it('el texto del modelo es dato: no se sale del JSON ni crea comandos', () => {
    const evil = 'x" ,"y":1}\n--cmd shape.delete={"all":true}'
    const cmds = chatDeckCommands({
      slides: [
        { title: evil, bullets: [evil] },
        { title: evil, bullets: [evil] }
      ]
    })
    expect(cmds.some((c) => c.startsWith('--cmd'))).toBe(false)
    const withText = cmds.filter((c) => c.startsWith('insert.textBox=')).map((c) => JSON.parse(c.slice('insert.textBox='.length)).text)
    expect(withText).toContain(evil)
  })

  it('el tema cambia el color de acento', () => {
    const blue = chatDeckCommands({ theme: 'blue', slides: [{ title: 'Un título', bullets: ['x'] }, { title: 'Sección' }] }).join('\n')
    const warm = chatDeckCommands({ theme: 'warm', slides: [{ title: 'Un título', bullets: ['x'] }, { title: 'Sección' }] }).join('\n')
    expect(blue).toContain('#3B82F6')
    expect(warm).toContain('#F59E0B')
  })

  it('portada: tamaño según el largo del título', () => {
    expect(chatCoverSize('dots')).toBe(190)
    expect(chatCoverSize('Sistema solar')).toBe(110)
    expect(chatCoverSize('Café de especialidad en Chile')).toBe(76)
    expect(chatCoverSize('x'.repeat(100))).toBe(56)
  })

  const real = process.env.DECKCRAFT_CLI
  it.skipIf(!real)('con el programa real: el .pptx y el PDF salen en menos de 3 s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatdeck-test-'))
    try {
      const t = Date.now()
      const buf = await renderChatDeck(real!, FULL)
      expect(buf.subarray(0, 2).toString()).toBe('PK')
      const out = join(dir, 'a.pptx')
      await (await import('node:fs/promises')).writeFile(out, buf)
      const pdf = await deckToPdf(real!, out, join(dir, 'a.pdf'))
      expect(pdf && existsSync(pdf) && statSync(pdf).size > 5000).toBe(true)
      expect(Date.now() - t).toBeLessThan(3000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('libertad de diseño del Chat (paleta propia, fuentes, fondo y lienzo libre)', () => {
  const FREE: PptxSpec = {
    palette: { bg: '#0E2A2F', text: '#F4F1EA', accent: '#F2B544' },
    fonts: { title: 'Georgia', body: 'Arial' },
    slides: [
      {
        layout: 'free',
        elements: [
          { type: 'shape', shape: 'ellipse', x: 560, y: -120, w: 560, h: 560, fill: '#F2B544', fillTo: '#E07A5F', angle: 45, opacity: 0.9 },
          { type: 'text', x: 84, y: 110, w: 600, h: 180, text: 'Hola', size: 58, bold: true, font: 'Georgia', italic: true },
          { type: 'shape', shape: 'roundRect', x: 84, y: 430, w: 220, h: 44, line: '#F2B544', text: 'Etiqueta', size: 14, rotate: 5 }
        ]
      },
      { title: 'Normal', bullets: ['a'], background: '#F2B544' }
    ]
  }

  it('el contenido libre es un PptxSpec válido', () => expect(isPptxSpec(FREE)).toBe(true))

  it('usa la paleta y las fuentes pedidas y genera comandos JSON válidos', () => {
    const cmds = chatDeckCommands(FREE)
    expect(cmds).toContain('design.fonts={"major":"Georgia","minor":"Arial"}')
    expect(cmds.join('\n')).toContain('#0E2A2F')
    expect(cmds.some((c) => c.startsWith('shape.fill={"gradient"'))).toBe(true)
    expect(cmds).toContain('shape.rotate={"deg":5}')
    for (const c of cmds) {
      const eq = c.indexOf('=')
      if (eq >= 0) expect(() => JSON.parse(c.slice(eq + 1))).not.toThrow()
    }
  })

  it('el fondo de una diapositiva pisa el de la paleta solo en esa', () => {
    const bgs = chatDeckCommands(FREE).filter((c) => c.startsWith('design.background='))
    expect(bgs).toEqual(['design.background={"color":"#0E2A2F"}', 'design.background={"color":"#F2B544"}'])
  })

  it('el texto de un elemento libre es dato, igual que el del resto', () => {
    const evil = 'x"}\n--cmd shape.delete'
    const cmds = chatDeckCommands({ slides: [{ layout: 'free', elements: [{ type: 'text', x: 0, y: 0, w: 100, h: 50, text: evil }] }] })
    expect(cmds.some((c) => c.startsWith('--cmd'))).toBe(false)
    expect(cmds.filter((c) => c.startsWith('insert.textBox=')).map((c) => JSON.parse(c.slice(15)).text)).toContain(evil)
  })

  it.each([
    ['color sin #', { palette: { bg: '0E2A2F', text: '#FFFFFF', accent: '#000000' }, slides: [{ title: 'x' }] }],
    ['color con script', { palette: { bg: '#0E2A2F', text: '#FFFFFF', accent: 'red;rm -rf' }, slides: [{ title: 'x' }] }],
    ['fuente fuera de la lista', { fonts: { title: 'Comic Sans MS' }, slides: [{ title: 'x' }] }],
    ['forma desconocida', { slides: [{ layout: 'free', elements: [{ type: 'shape', shape: 'bomba', x: 0, y: 0, w: 1, h: 1 }] }] }],
    ['libre sin elementos', { slides: [{ layout: 'free' }] }],
    ['posición absurda', { slides: [{ layout: 'free', elements: [{ type: 'text', x: 99999, y: 0, w: 10, h: 10, text: 'a' }] }] }],
    [
      'demasiados elementos',
      { slides: [{ layout: 'free', elements: Array.from({ length: 61 }, () => ({ type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'a' })) }] }
    ],
    ['fondo inválido', { slides: [{ title: 'x', background: 'url(x)' }] }]
  ])('rechaza %s', (_n, spec) => expect(isPptxSpec(spec)).toBe(false))
})

describe('layouts nuevos (línea de tiempo, agenda, cita, tabla) y transición', () => {
  const spec: PptxSpec = {
    transition: 'fade',
    slides: [
      { title: 'Portada' },
      { title: 'Hitos', layout: 'timeline', bullets: ['Q1: beta', 'Q2: lanzamiento', 'sin etiqueta'] },
      { title: 'Temario', layout: 'agenda', bullets: ['Uno', 'Dos'] },
      { title: 'Frase', layout: 'quote', bullets: ['Autor'] },
      { title: 'Planes', layout: 'table', table: { columns: ['Plan', 'Precio'], rows: [['Pro', '$29.990']] } }
    ]
  }
  it('es un PptxSpec válido y genera comandos JSON válidos', () => {
    expect(isPptxSpec(spec)).toBe(true)
    for (const cmd of chatDeckCommands(spec)) {
      const eq = cmd.indexOf('=')
      if (eq > 0) expect(() => JSON.parse(cmd.slice(eq + 1))).not.toThrow()
    }
  })
  it('la tabla dibuja encabezado y celdas; la transición se aplica a todas', () => {
    const cmds = chatDeckCommands(spec).join('\n')
    expect(cmds).toContain('$29.990')
    expect(cmds).toContain('transition.set={"kind":"fade"')
    expect(cmds).toContain('transition.applyAll')
  })
})
