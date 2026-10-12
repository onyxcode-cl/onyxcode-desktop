import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DECK_LIMITS, buildDeckCommands, validateDeckSpec } from './deck-builder'
import { runDeck } from './deck-runner'

const items = (n: number): { title: string; body: string }[] => Array.from({ length: n }, (_, i) => ({ title: `T${i}`, body: `B${i}` }))
const FULL = {
  slides: [
    { type: 'cover', title: 'dots', subtitle: 'Sub', note: 'Nota', badge: 'Etiqueta' },
    { type: 'stat', title: 'Qué es', stat: '4.000+', statLabel: 'apps', items: items(2) },
    { type: 'timeline', title: 'Cómo', items: items(3), callout: 'Aviso' },
    { type: 'grid', title: 'Dónde', items: items(4), footnote: 'Pie' },
    { type: 'steps', title: 'Pasos', items: items(4) },
    { type: 'compare', title: 'Modelo', left: { label: 'A', text: 'x', foot: 'y' }, right: { label: 'B', text: 'z', foot: 'w' } },
    {
      type: 'rows',
      title: 'Quién',
      rows: [
        { label: 'a', value: 'b', note: 'c' },
        { label: 'd', value: 'e' }
      ]
    },
    { type: 'quad', title: 'Seguridad', items: items(4) },
    {
      type: 'stats',
      title: 'Cifras',
      stat: '4.000+',
      statLabel: 'apps',
      items: [
        { value: '1', label: 'a' },
        { value: '3', label: 'b' },
        { value: '0', label: 'c' }
      ]
    },
    { type: 'closing', title: 'Fin', text: 'Gracias', sources: 'Fuentes' }
  ]
}

describe('deck-builder (prueba Craft)', () => {
  it('acepta un contenido completo y genera comandos que empiezan y terminan bien', () => {
    const cmds = buildDeckCommands(validateDeckSpec(FULL))
    expect(cmds[0]).toBe('file.new')
    expect(cmds[cmds.length - 1]).toBe('slide.delete={"index":0}')
    expect(cmds.filter((c) => c.startsWith('slide.new=')).length).toBe(10)
  })

  it('cada comando es `id` o `id={json válido}`', () => {
    for (const c of buildDeckCommands(validateDeckSpec(FULL))) {
      const eq = c.indexOf('=')
      if (eq < 0) continue
      expect(c.slice(0, eq)).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
      expect(() => JSON.parse(c.slice(eq + 1))).not.toThrow()
    }
  })

  it('el texto del modelo es dato: comillas, saltos de línea y "--cmd" no se salen del JSON', () => {
    const evil = 'x" ,"y":1}\n--cmd shape.delete={"all":true}'
    const cmds = buildDeckCommands(validateDeckSpec({ slides: [{ type: 'closing', title: evil }] }))
    const withText = cmds.find((c) => c.startsWith('insert.textBox='))!
    expect(JSON.parse(withText.slice('insert.textBox='.length)).text).toBe(evil)
    expect(cmds.some((c) => c.startsWith('--cmd'))).toBe(false)
  })

  it.each([
    [null, 'spec'],
    [{ slides: [] }, 'slides'],
    [{ slides: [{ type: 'otro', title: 'x' }] }, 'slides[0].type'],
    [{ slides: [{ type: 'closing' }] }, 'slides[0].title'],
    [{ slides: [{ type: 'closing', title: 'a'.repeat(DECK_LIMITS.short + 1) }] }, 'demasiado largo'],
    [{ slides: [{ type: 'grid', title: 'x', items: items(3) }] }, 'entre 4 y 4'],
    [{ slides: [{ type: 'steps', title: 'x', items: 'no' }] }, 'lista'],
    [{ slides: Array.from({ length: DECK_LIMITS.slides + 1 }, () => ({ type: 'closing', title: 'x' })) }, 'slides']
  ])('rechaza contenido inválido (%#)', (spec, msg) => {
    expect(() => validateDeckSpec(spec)).toThrow(msg)
  })

  it('ignora campos desconocidos (p. ej. una ruta) en vez de pasarlos', () => {
    const spec = validateDeckSpec({ slides: [{ type: 'closing', title: 'x', path: '/etc/passwd', out: '/tmp/a.pptx' }] })
    expect(JSON.stringify(spec)).not.toContain('passwd')
  })

  it('exige salida .pptx', async () => {
    await expect(runDeck('/nonexistent', FULL, '/tmp/x.docx')).rejects.toThrow('.pptx')
  })

  const real = process.env.DECKCRAFT_CLI
  it.skipIf(!real)('con el binario real: 10 diapositivas en menos de 5 s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-test-'))
    try {
      const r = await runDeck(real!, FULL, join(dir, 'a.pptx'))
      expect(existsSync(r.out)).toBe(true)
      expect(statSync(r.out).size).toBeGreaterThan(10_000)
      expect(r.slides).toBe(10)
      expect(r.ms).toBeLessThan(5000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('fitSize', () => {
  it('no toca los textos cortos y reduce los largos sin bajar del 55 %', async () => {
    const { fitSize } = await import('./deck-builder')
    expect(fitSize('corto', 40, 36)).toBe(40)
    expect(fitSize('x'.repeat(72), 40, 36)).toBe(22)
    expect(fitSize('x'.repeat(400), 40, 36)).toBe(22)
  })
})
