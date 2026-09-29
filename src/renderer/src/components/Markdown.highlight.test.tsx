import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

const TS = 'Aquí:\n\n```ts\nconst x: number = 1\nfunction f() { return x }\n```\n'
const NO_LANG = 'Aquí:\n\n```\nconst x = 1\nfunction f() { return x }\n```\n'

describe('Markdown: resaltado de código (F7-B45)', () => {
  it('bloque con lenguaje declarado y mensaje completo: .hljs y tokens', () => {
    const html = renderToStaticMarkup(<Markdown text={TS} />)
    expect(html).toContain('hljs language-ts')
    expect(html).toContain('hljs-keyword')
  })
  it('mensaje en curso (`streaming`): sin resaltar, pero conserva el lenguaje y el cursor', () => {
    const html = renderToStaticMarkup(<Markdown text={TS} streaming />)
    expect(html).not.toContain('hljs')
    expect(html).toContain('language-ts')
    expect(html).toContain('is-streaming')
  })
  it('`highlight={false}` sin cursor (Code/Cowork): sin resaltar ni is-streaming', () => {
    const html = renderToStaticMarkup(<Markdown text={TS} highlight={false} />)
    expect(html).not.toContain('hljs')
    expect(html).not.toContain('is-streaming')
  })
  it('bloque SIN lenguaje declarado ya no se autodetecta (detect:false)', () => {
    expect(renderToStaticMarkup(<Markdown text={NO_LANG} />)).not.toContain('hljs-keyword')
  })
})
