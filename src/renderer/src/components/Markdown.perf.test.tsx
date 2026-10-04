import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { markdownComponents, markdownRemarkPlugins, splitMarkdownBlocks } from './Markdown'

/**
 * Proxy del coste por fotograma del streaming (F8-B65): antes cada delta analizaba el texto ENTERO; ahora solo el último
 * bloque (los anteriores están memoizados y no se vuelven a analizar). Se mide el análisis, no React.
 */
const para = (i: number): string => `Párrafo ${i} con **negrita**, \`código\` y un [enlace](https://x.y/${i}) para rellenar algo de texto.`
const text = Array.from({ length: 60 }, (_, i) => para(i)).join('\n\n')

const parse = (s: string): string =>
  renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={markdownRemarkPlugins} components={markdownComponents}>
      {s}
    </ReactMarkdown>
  )

describe('Markdown por bloques: coste por delta', () => {
  it(`texto de ${text.length} caracteres: analizar solo el último bloque es >= 5 veces más barato`, () => {
    const blocks = splitMarkdownBlocks(text)!
    expect(blocks.length).toBeGreaterThan(50)
    const last = blocks[blocks.length - 1]
    parse(text) // calentamiento
    const N = 15
    let t0 = performance.now()
    for (let i = 0; i < N; i++) parse(text)
    const fullMs = performance.now() - t0
    t0 = performance.now()
    for (let i = 0; i < N; i++) parse(last)
    const blockMs = performance.now() - t0
    console.info(
      `[perf] completo ${(fullMs / N).toFixed(2)} ms · último bloque ${(blockMs / N).toFixed(2)} ms · x${(fullMs / blockMs).toFixed(0)}`
    )
    expect(fullMs / blockMs).toBeGreaterThan(5)
  })
})
