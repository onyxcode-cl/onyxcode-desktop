import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { preloadHighlight, useHighlightPlugins } from './shims/highlight-lazy'

const TS = '```ts\nconst x: number = 1\n```'

function View({ enabled }: { enabled: boolean }): React.JSX.Element {
  const hl = useHighlightPlugins(enabled)
  return <ReactMarkdown rehypePlugins={hl ?? []}>{TS}</ReactMarkdown>
}

describe('resaltado perezoso de la PWA (P1-3)', () => {
  it('antes de cargar no colorea; tras preloadHighlight() sí; apagado nunca', async () => {
    expect(renderToStaticMarkup(<View enabled />)).not.toContain('hljs')
    await preloadHighlight()
    expect(renderToStaticMarkup(<View enabled />)).toContain('hljs-keyword')
    expect(renderToStaticMarkup(<View enabled={false} />)).not.toContain('hljs')
  })
})
