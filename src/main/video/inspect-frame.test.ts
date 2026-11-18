import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { qualityComposition } from './fixtures/quality'

// Executes the exact browser function shipped with the worker, without a separate copy of its algorithm.
const source = readFileSync(join(__dirname, '../../../resources/video/inspect-frame.mjs'), 'utf8').replace(/export function /g, 'function ')
const { inspectFrame, colorVariation, needsSmallerFrames } = new Function(
  source + ';return {inspectFrame,colorVariation,needsSmallerFrames}'
)() as {
  inspectFrame: (size: { width: number; height: number }) => { issues: string[]; visibleText: number; coverage: number }
  needsSmallerFrames: (sizes: number[]) => boolean
  colorVariation: (rgb: Uint8Array) => number
}
beforeEach(() => {
  const dom = new Window()
  vi.stubGlobal('document', dom.document)
  vi.stubGlobal('Element', dom.Element)
  vi.stubGlobal('DOMRect', dom.DOMRect)
  vi.stubGlobal('getComputedStyle', dom.getComputedStyle.bind(dom))
})
function scene(kind: Parameters<typeof qualityComposition>[0]) {
  document.write(qualityComposition(kind).replace(/<script[\s\S]*?<\/script>/g, ''))
  const rect = (el: Element): DOMRect => {
    const style = (el as HTMLElement).style
    const parent = el.parentElement?.closest('section')
    const x = parseFloat(style.left) || 0,
      y = parseFloat(style.top) || 0
    return new DOMRect(x + (parent ? 90 : 0), y + (parent ? 220 : 0), parseFloat(style.width) || 1080, parseFloat(style.height) || 1920)
  }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rect(this)
  })
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let node: Node
    return {
      selectNodeContents: (n: Node) => {
        node = n
      },
      getClientRects: () => [rect(node.parentElement!)]
    } as unknown as Range
  })
  document.elementsFromPoint = (x, y) =>
    [...document.querySelectorAll('*')].reverse().filter((e) => {
      const r = rect(e)
      return r.left <= x && r.right >= x && r.top <= y && r.bottom >= y
    })
  return () => inspectFrame({ width: 1080, height: 1920 })
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('revisión automática de composiciones', () => {
  it('una composición limpia no genera avisos', () => expect(scene('clean')().issues).toEqual([]))
  it('avisa de texto fuera del lienzo y de su caja', () => {
    const review = scene('overflow')
    const el = document.querySelector('p')!
    Object.defineProperties(el, { clientWidth: { value: 100 }, scrollWidth: { value: 900 } })
    expect(review().issues.join(' ')).toContain('se sale de su caja')
    expect(review().issues.join(' ')).toContain('área segura')
  })
  it('detecta textos tapándose y un adorno encima con pointer-events:none', () => {
    const review = scene('overlap')()
    expect(review.issues.join(' ')).toContain('"HORARIO" queda tapado')
    expect(document.querySelector('div div')?.getAttribute('style')).toContain('pointer-events: none')
  })
  it('detecta también un adorno dentro del elemento que contiene el texto', () => {
    const review = scene('overlap')
    const [label, second] = document.querySelectorAll('p')
    second.remove()
    label.appendChild(document.querySelector('div div')!)
    expect(review().issues.join(' ')).toContain('"HORARIO" queda tapado')
  })
  it('detecta contenido en una franja angosta', () => {
    const review = scene('narrow')()
    expect(review.coverage).toBeLessThan(0.1)
    expect(review.issues.join(' ')).toContain('espacio vacío')
  })
  it('un vacío entre escenas carece de texto y tiene poca variación; una imagen contrastada no es vacía', () => {
    const review = scene('gap')
    ;(document.querySelector('section') as HTMLElement).style.opacity = '0'
    expect(review().visibleText).toBe(0)
    expect(colorVariation(new Uint8Array(768).fill(42))).toBe(0)
    expect(colorVariation(new Uint8Array(768).map((_, i) => (i % 2 ? 255 : 0)))).toBeGreaterThan(100)
  })
})

it('prefiere mitad para tres cuadros normales y reduce seis cuadros ruidosos o uno que supera el límite individual', () => {
  expect(needsSmallerFrames([300000, 240000, 200000])).toBe(false)
  expect(needsSmallerFrames(Array(6).fill(600000))).toBe(true)
  expect(needsSmallerFrames([2100000])).toBe(true)
})
