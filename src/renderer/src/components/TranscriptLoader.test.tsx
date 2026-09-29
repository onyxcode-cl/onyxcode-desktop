import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TranscriptLoader } from './TranscriptLoader'

describe('TranscriptLoader', () => {
  it('no renderiza nada si la sesión no se está recargando (estado inicial)', () => {
    expect(renderToStaticMarkup(<TranscriptLoader sessionId="a" />)).toBe('')
    expect(renderToStaticMarkup(<TranscriptLoader sessionId={null} />)).toBe('')
  })
})
