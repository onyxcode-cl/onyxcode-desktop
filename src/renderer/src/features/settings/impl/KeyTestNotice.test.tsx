import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { KeyTestStatus } from '@shared/key-test'
import { KeyTestView } from './KeyTestNotice'
import type { KeyTestEntry } from './useKeyTest'

const render = (entry: KeyTestEntry | undefined): string =>
  renderToStaticMarkup(createElement(KeyTestView, { entry, providerName: 'OpenAI' }))
const done = (status: KeyTestStatus, httpStatus: number | null = null, latencyMs: number | null = null): KeyTestEntry => ({
  phase: 'done',
  result: { providerID: 'openai', status, httpStatus, latencyMs, checkedAt: 1 }
})

describe('KeyTestNotice', () => {
  it('sin prueba no muestra nada', () => {
    expect(render(undefined)).toBe('')
    expect(render(undefined)).toBe('')
  })

  it('probando: aviso con animación y nombre del proveedor', () => {
    const html = render({ phase: 'testing' })
    expect(html).toContain('data-key-test="testing"')
    expect(html).toContain('Probando la clave de OpenAI')
  })

  it('ok: «Funcionando · N ms» con el estado en un atributo', () => {
    const html = render(done('ok', 200, 340))
    expect(html).toContain('data-key-test="ok"')
    expect(html).toContain('Funciona · 340 ms')
  })

  it('inválida, límite y proveedor caído muestran títulos distintos y la explicación', () => {
    expect(render(done('invalid', 401, 10))).toContain('Clave no válida')
    expect(render(done('rate-limited', 429, 10))).toContain('Límite de uso alcanzado')
    const down = render(done('provider-down', 503, 10))
    expect(down).toContain('El proveedor tiene problemas')
    expect(down).toContain('HTTP 503')
  })

  it('un fallo del IPC (p. ej. BUSY) se muestra como texto', () => {
    expect(render({ phase: 'error', message: 'Espera unos segundos antes de volver a probar este proveedor.' })).toContain(
      'Espera unos segundos'
    )
  })

  it('«action» se pinta junto al resultado', () => {
    const html = renderToStaticMarkup(
      createElement(KeyTestView, {
        entry: done('invalid', 401, 10),
        providerName: 'OpenAI',
        action: createElement('button', null, 'Cambiar clave')
      })
    )
    expect(html).toContain('Cambiar clave')
  })
})
