/**
 * Prueba de extremo a extremo de la Fase 2 (pedida por el plan maestro): un docx normal y uno
 * hostil pasados por el renderizador REAL de `docx-preview`, no solo por `sanitizeDocxDom` con DOM
 * armado a mano (eso ya lo cubre `sanitize.test.ts`). Corre bajo jsdom, no happy-dom: se probó que
 * `docx-preview` no produce ningún hijo dentro de `<article>` bajo happy-dom (ni con un .docx real
 * de Word, no solo con el generado por la skill) — es una limitación de esa implementación de DOM,
 * no del código del visor. jsdom sí renderiza el cuerpo real.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderAsync } from 'docx-preview'
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sanitizeDocxDom } from './sanitize'

const fixture = (name: string): Buffer => readFileSync(fileURLToPath(new URL(`../__fixtures__/${name}`, import.meta.url)))

let restoreGlobals: () => void

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const saved = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement }
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    DOMParser: dom.window.DOMParser,
    Image: dom.window.Image
  })
  restoreGlobals = () => Object.assign(globalThis, saved)
})
afterAll(() => restoreGlobals())

function freshContainer(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return container
}

describe('docx-preview + sanitizeDocxDom con archivos .docx reales', () => {
  it('un docx normal (de la skill `docx`) renderiza contenido real', async () => {
    const container = freshContainer()
    await renderAsync(fixture('sample.docx'), container, container, { useBase64URL: true, inWrapper: true, className: 'docx' })
    const article = container.querySelector('article')
    expect(article).not.toBeNull()
    expect(article!.children.length).toBeGreaterThan(0)
    expect(container.textContent).toContain('Informe de ventas')
  })

  it('un docx hostil (hipervínculo externo javascript:) llega vivo al DOM antes de sanear', async () => {
    const container = freshContainer()
    await renderAsync(fixture('hostile.docx'), container, container, { useBase64URL: true, inWrapper: true, className: 'docx' })
    expect(container.innerHTML).toContain('javascript:')
    expect(container.querySelector('a')!.getAttribute('href')).toContain('javascript:')
  })

  it('el mismo docx hostil, después de sanitizeDocxDom, no deja ningún rastro de red ni de javascript:', async () => {
    const container = freshContainer()
    await renderAsync(fixture('hostile.docx'), container, container, { useBase64URL: true, inWrapper: true, className: 'docx' })
    sanitizeDocxDom(container as unknown as ParentNode & Element)
    expect(container.innerHTML).not.toContain('javascript:')
    expect(container.innerHTML).not.toContain('evil.example')
    for (const a of container.querySelectorAll('a')) expect(a.hasAttribute('href')).toBe(false)
    // el texto del enlace sigue visible: sanitizeDocxDom quita la navegación, no el contenido.
    expect(container.textContent).toContain('clic aqui')
  })
})
