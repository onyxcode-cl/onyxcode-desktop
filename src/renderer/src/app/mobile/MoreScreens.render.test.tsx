import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MoreRoot, PhoneScreen } from './MoreScreens'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length

beforeEach(() => {
  g.window = { api: { platform: 'remote' } }
})
afterEach(() => {
  delete g.window
})

describe('«Más» como listas agrupadas', () => {
  it('dos grupos con encabezado, tres filas de 56 px y el estado como dato final', () => {
    const html = renderToStaticMarkup(createElement(MoreRoot))
    expect(count(html, /data-m="list-group"/g)).toBe(2)
    expect(count(html, /<h2/g)).toBe(2)
    expect(count(html, /<button[^>]*min-h-14/g)).toBe(3)
    expect(html).toContain('Conectado') // sin enlace se considera en línea
    expect(html).toContain('bg-success')
    expect(html).toContain('divide-y')
  })
})

describe('«Este celular»', () => {
  it('estado y motor en una lista; bloquear y desvincular son filas, desvincular en tono de peligro', () => {
    const html = renderToStaticMarkup(createElement(PhoneScreen))
    expect(count(html, /data-m="list-group"/g)).toBe(3)
    expect(count(html, /<button[^>]*min-h-14/g)).toBe(2)
    expect(count(html, /<button[^>]*text-danger/g)).toBe(1)
    expect(html).toContain('role="status"')
  })
})
