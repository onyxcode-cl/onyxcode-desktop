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
    'width:1280px;height:720px',
    'width:1920px;height:1080px',
    'width:100vw;height:100vh',
    'margin:12px;break-after:auto',
    'display:none'
  ])('normaliza el deck común %s', (style) => {
    Object.defineProperty(dom.window, 'innerWidth', { value: 960 })
    Object.defineProperty(dom.window, 'innerHeight', { value: 540 })
    document.querySelector('.slide')!.setAttribute('style', style)
    expect(validate()).toBe(2)
    const slide = document.querySelector<HTMLElement>('.slide')!
    expect(slide.style.margin).toBe('0px')
    expect(slide.style.display).not.toBe('none')
    expect(Number(slide.dataset.lzxExportScale) * parseFloat(slide.style.width)).toBe(960)
  })
  it.each([
    ['width:1000px', 'proporción 16:9'],
    ['width:0;height:0', 'tamaño positivo']
  ])('explica por qué no puede exportar %s', (style, error) => {
    document.querySelector('.slide')!.setAttribute('style', style)
    expect(validate).toThrow(error)
  })
  it('admite el carrusel del café: inset:0, sin dimensiones explícitas y láminas ocultas', () => {
    document.head.innerHTML =
      '<style>*{box-sizing:border-box}.deck{position:relative;width:100vw;height:100vh}.slide{position:absolute;inset:0;display:none}.slide.active{display:flex}</style>'
    document.body.innerHTML =
      '<main class="deck"><section class="slide active"></section><section class="slide"></section></main><nav>Controles</nav>'
    for (const el of document.querySelectorAll<HTMLElement>('.slide')) {
      // jsdom no dispone de layout: Chromium da este rectángulo al resolver inset:0.
      el.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 960,
        height: 540,
        top: 0,
        left: 0,
        right: 960,
        bottom: 540,
        toJSON: () => ({})
      })
    }
    expect(validate()).toBe(2)
    expect(document.querySelector<HTMLElement>('.slide')!.dataset.lzxExportDisplay).toBe('flex')
    expect(document.querySelector<HTMLElement>('nav')!.style.display).toBe('none')
  })
  it('rechaza láminas anidadas', () => {
    document.querySelector('.slide')!.innerHTML = '<section class="slide"></section>'
    expect(validate).toThrow('no se permiten láminas anidadas')
  })
})
