import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NO_AI_ERROR } from '@shared/ai-errors'
import { ErrorNotice } from './ErrorNotice'

const CAPTURE =
  'ProviderModelNotFoundError: Model not found: opencode-go/x. Did you mean: x?\n    at <anonymous> (/$bunfs/root/chunk.js:1:1)'

describe('ErrorNotice', () => {
  it('model-not-found: mensaje claro, botón de conectar y detalle plegado', () => {
    const html = renderToStaticMarkup(createElement(ErrorNotice, { error: { name: 'UnknownError', data: { message: CAPTURE } } }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('El modelo elegido no está disponible')
    expect(html).toContain('Conectar una IA')
    expect(html).toContain('Ver detalle')
    expect(html).toContain('<details')
  })

  it('error propio de una línea: sin detalle ni botón', () => {
    const html = renderToStaticMarkup(createElement(ErrorNotice, { error: 'Se cayó' }))
    expect(html).toContain('Se cayó')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('Conectar una IA')
  })

  it('sin IA: título propio y botón', () => {
    const html = renderToStaticMarkup(createElement(ErrorNotice, { error: NO_AI_ERROR, variant: 'chat' }))
    expect(html).toContain('Aún no conectaste ninguna IA')
    expect(html).toContain('Conectar una IA')
  })
})
