import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { Markdown, markdownComponents, markdownRemarkPlugins, splitMarkdownBlocks } from './Markdown'

/** Referencia: el análisis ENTERO de siempre (lo que hacía `Markdown` antes de partir en bloques). */
function full(text: string): string {
  return renderToStaticMarkup(
    <div className="markdown  ">
      <ReactMarkdown remarkPlugins={markdownRemarkPlugins} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
/** Los saltos de línea entre elementos no cambian lo que se ve. */
const norm = (html: string): string => html.replace(/>\s*\n\s*</g, '><')

const CASES: Record<string, string> = {
  párrafos: 'Uno.\n\nDos con **negrita**.\n\nTres.',
  encabezados: '# Título\n\nTexto.\n\n## Sub\n\nMás texto.',
  'lista suelta': '- a\n\n- b\n\n- c\n\nFin.',
  'lista numerada suelta': '1. uno\n\n2. dos\n\n3. tres',
  'lista con párrafo sangrado': '- a\n\n  continuación de a\n\n- b\n\nFin',
  'código con líneas en blanco': 'Antes\n\n```ts\nconst a = 1\n\n\nconst b = 2\n```\n\nDespués',
  'valla de tildes': 'x\n\n~~~\nlínea\n\nlínea\n~~~\n\ny',
  'valla sin cerrar (streaming)': 'x\n\n```py\nprint(1)\n\nprint(2)',
  'código sangrado': 'Texto\n\n    uno\n\n    dos\n\nFin',
  tabla: '| a | b |\n|---|---|\n| 1 | 2 |\n\nDespués de la tabla.',
  cita: '> una cita\n> sigue\n\nSuelto\n\n> otra cita',
  'cita con blanco': '> a\n>\n> b\n\nc',
  'regla horizontal': 'a\n\n---\n\nb',
  'saltos y enlaces': 'Ver [docs](https://x.y) y <https://z.w>.\n\nFin con `código`.',
  'líneas en blanco de más': 'a\n\n\n\nb\n\n\n',
  tareas: '- [x] hecho\n- [ ] pendiente\n\nTexto',
  'lista anidada': '- a\n  - b\n\n  - c\n\n- d'
}

// Casos que dependen del documento entero: se analizan enteros (plan B), el resultado es el de siempre.
const PLAN_B: Record<string, string> = {
  referencia: 'Mira [la guía][g].\n\nOtro párrafo.\n\n[g]: https://example.com',
  'nota al pie': 'Texto[^1].\n\nOtro.\n\n[^1]: la nota',
  html: '<div>\n\nhola\n\n</div>\n\nTexto'
}

describe('Markdown por bloques (F8-B65): equivalencia con el análisis completo', () => {
  for (const [name, text] of Object.entries(CASES)) {
    it(name, () => {
      expect(norm(renderToStaticMarkup(<Markdown text={text} highlight={false} />))).toBe(norm(full(text)))
      // y cada prefijo del texto (así se ve durante el streaming)
      for (let n = 1; n < text.length; n += 3) {
        const p = text.slice(0, n)
        expect(norm(renderToStaticMarkup(<Markdown text={p} highlight={false} />)), `prefijo ${n}`).toBe(norm(full(p)))
      }
    })
  }

  for (const [name, text] of Object.entries(PLAN_B)) {
    it(`plan B: ${name} se analiza entero`, () => {
      expect(splitMarkdownBlocks(text)).toBeNull()
      expect(renderToStaticMarkup(<Markdown text={text} highlight={false} />)).toBe(full(text))
    })
  }

  it('con resaltado (mensaje terminado) no se parte: un único análisis', () => {
    const text = 'Uno.\n\n```ts\nconst x = 1\n```\n\nDos.'
    const html = renderToStaticMarkup(<Markdown text={text} />)
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('<p>Uno.</p>')
  })

  it('parte de verdad: los bloques cerrados son estables al crecer el texto', () => {
    const a = splitMarkdownBlocks('Uno.\n\nDos.\n\nTre')!
    const b = splitMarkdownBlocks('Uno.\n\nDos.\n\nTres y más')!
    expect(a.slice(0, 2)).toEqual(b.slice(0, 2))
    expect(a).toHaveLength(3)
  })

  it('no corta dentro de una valla ni ante una lista o sangría', () => {
    expect(splitMarkdownBlocks('```\na\n\nb\n```')).toBeNull()
    expect(splitMarkdownBlocks('- a\n\n- b')).toBeNull()
    expect(splitMarkdownBlocks('- a\n\n  b')).toBeNull()
  })
})
