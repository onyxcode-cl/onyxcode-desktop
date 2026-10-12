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
