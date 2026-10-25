// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCompaction } from '@shared/compaction'
import { click, mount, type Mounted } from '../../../../test/dom-render'
import { CompactionCard } from './CompactionCard'

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
/** Monta (o vuelve a montar) la tarjeta y devuelve el contenedor. */
const render = (el: React.ReactElement): HTMLDivElement => {
  m?.unmount()
  m = mount(el)
  return m.host
}

const full = parseCompaction({
  lazunox: {
    parcial: false,
    mensajes: 48,
    tokensAntes: 152000,
    tokensDespues: 21000,
    reinyectado: ['plan:5', 'habilidades:2', 'instrucciones:1', 'ayudantes:1']
  }
})

describe('CompactionCard', () => {
  let host: HTMLDivElement
  it('con cifras del motor: mensajes, contexto con «≈», liberados y lo que se mantuvo', () => {
    host = render(createElement(CompactionCard, { meta: full }))
    const text = host.textContent ?? ''
    expect(text).toContain('Se resumieron 48 mensajes')
    expect(text).toContain('≈152.000')
    expect(text).toContain('≈21.000')
    expect(text).toContain('≈131.000 liberados')
    expect(text).toContain('Se mantuvieron: plan (5), 2 habilidades, 1 instrucción de carpeta, 1 ayudante activo')
    // sin resumen no hay botón
    expect(host.querySelector('button')).toBeNull()
  })

  it('motor sin métricas: solo dice que se resumió la conversación', () => {
    host = render(createElement(CompactionCard, { meta: parseCompaction({ type: 'compaction', auto: false }) }))
    expect(host.textContent).toContain('Se resumió la conversación')
    expect(host.textContent).not.toContain('≈')
    expect(host.textContent).not.toContain('Se mantuvieron')
  })

  it('compactación parcial y automática lo dicen', () => {
    host = render(createElement(CompactionCard, { meta: parseCompaction({ lazunox: { auto: true, parcial: true, mensajes: 1 } }) }))
    expect(host.textContent).toContain('Se resumió 1 mensaje anterior; lo posterior se mantuvo tal cual')
    expect(host.textContent).toContain('Compactación automática')
    host = render(createElement(CompactionCard, { meta: parseCompaction({ lazunox: { parcial: true } }) }))
    expect(host.textContent).toContain('hasta aquí')
  })

  it('en curso: aviso de estado y nada más', () => {
    host = render(createElement(CompactionCard, { meta: full, running: true }, 'resumen'))
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Resumiendo la conversación…')
    expect(host.textContent).not.toContain('≈')
    expect(host.querySelector('button')).toBeNull()
  })

  it('«Ver resumen» abre y cierra el resumen con aria-expanded', () => {
    host = render(createElement(CompactionCard, { meta: full }, createElement('p', { id: 'sum' }, 'El resumen completo')))
    expect(host.querySelector('#sum')).toBeNull()
    const btn = host.querySelector('button')!
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.textContent).toContain('Ver resumen')
    click(btn)
    expect(host.querySelector('#sum')?.textContent).toBe('El resumen completo')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.textContent).toContain('Ocultar resumen')
    click(btn)
    expect(host.querySelector('#sum')).toBeNull()
  })

  it('si la estimación supera a lo medido, no inventa tokens liberados', () => {
    host = render(createElement(CompactionCard, { meta: parseCompaction({ lazunox: { tokensAntes: 100, tokensDespues: 300 } }) }))
    expect(host.textContent).not.toContain('liberados')
  })

  it('el texto con cifras también es accesible (sr-only) y el decorativo va oculto', () => {
    host = render(createElement(CompactionCard, { meta: full }))
    expect(host.querySelector('.sr-only')?.textContent).toContain('liberados')
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
