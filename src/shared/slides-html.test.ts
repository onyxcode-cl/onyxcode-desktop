import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error jsdom is a test-only dependency without bundled declarations.
import { JSDOM } from 'jsdom'
let dom: { window: { document: Document; eval: (script: string) => unknown } }
let document: Document
import { hasHtmlSlides, VALIDATE_SLIDES_SCRIPT } from './slides-html'

function validate(): number {
  return dom.window.eval(VALIDATE_SLIDES_SCRIPT) as number
}
beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { runScripts: 'outside-only' })
  document = dom.window.document
  document.head.innerHTML = '<style>body{margin:0}.slide{width:960px;height:540px;box-sizing:border-box;margin:0;break-after:page}</style>'
  document.body.innerHTML = '<section class="slide"></section><section class="slide"></section>'
})
describe('contrato común de presentación HTML', () => {
  it('reconoce clases múltiples y usa la cantidad exacta de láminas', () => {
    expect(hasHtmlSlides('<section class="cover slide dark">')).toBe(true)
    expect(hasHtmlSlides('<div class="slideshow">')).toBe(false)
    expect(hasHtmlSlides('<div class="slide-title">')).toBe(false)
    expect(hasHtmlSlides('<script>const x = `<div class="slide">`</script>')).toBe(false)
    expect(hasHtmlSlides('<section title=">" class="slide">')).toBe(true)
    expect(hasHtmlSlides('<textarea><section class="slide"></textarea>')).toBe(false)
    expect(hasHtmlSlides('<title><section class="slide"></title>')).toBe(false)
    expect(hasHtmlSlides('<section title="class=\'slide\'">')).toBe(false)
    expect(hasHtmlSlides('<section class="card" class="slide">')).toBe(false)
    expect(hasHtmlSlides('<section class="sl&#105;de">')).toBe(true)
    expect(hasHtmlSlides('<section class="slide&Tab;cover">')).toBe(true)
    expect(hasHtmlSlides('<section class="slide&#160;cover">')).toBe(false)
    expect(validate()).toBe(2)
  })
  it('no convierte un documento ordinario ni trunca láminas adicionales', () => {
    document.body.innerHTML = '<p>Sin láminas</p>'
    expect(validate).toThrow('falta al menos un elemento .slide')
    document.body.innerHTML = '<section class="slide"></section>'.repeat(41)
    expect(validate).toThrow('máximo de 40')
  })
  it.each([
    ['width:1000px', '960×540 CSS'],
    ['box-sizing:content-box', 'box-sizing: border-box'],
    ['margin:12px', 'márgenes cero'],
    ['break-after:auto', 'break-after: page']
  ])('explica el incumplimiento %s', (style, error) => {
    document.querySelector('.slide')!.setAttribute('style', style)
    expect(validate).toThrow(error)
  })
  it('rechaza láminas anidadas', () => {
    document.querySelector('.slide')!.innerHTML = '<section class="slide"></section>'
    expect(validate).toThrow('no se permiten láminas anidadas')
  })
})
