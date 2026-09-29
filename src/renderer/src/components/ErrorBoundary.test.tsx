import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary, formatErrorDetail } from './ErrorBoundary'

// renderToStaticMarkup no ejecuta getDerivedStateFromError como el cliente: el fallback no es testeable sin DOM
// (checklist manual: throw temporal en ChatView). Aquí se cubren el formato del detalle y el camino sin error.
describe('ErrorBoundary', () => {
  it('sin error renderiza los hijos tal cual', () => {
    const html = renderToStaticMarkup(createElement(ErrorBoundary, null, createElement('p', null, 'hola')))
    expect(html).toContain('<p>hola</p>')
  })

  it('formatErrorDetail incluye nombre, mensaje, pila y pila de componentes', () => {
    const e = new TypeError('boom')
    const out = formatErrorDetail(e, '\n    at ChatView')
    expect(out).toContain('TypeError: boom')
    expect(out).toContain('Pila de componentes:\n    at ChatView')
  })

  it('formatErrorDetail acepta valores que no son Error', () => {
    expect(formatErrorDetail('texto')).toContain('Error: texto')
  })
})
