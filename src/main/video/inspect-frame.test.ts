import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { qualityComposition } from './fixtures/quality'

// Executes the exact browser function shipped with the worker, without a separate copy of its algorithm.
const source = readFileSync(join(__dirname, '../../../resources/video/inspect-frame.mjs'), 'utf8').replace(/export function /g, 'function ')
const { inspectFrame, colorVariation, needsSmallerFrames, measureMotion, transitionSamples } = new Function(
  source + ';return {inspectFrame,colorVariation,needsSmallerFrames,measureMotion,transitionSamples}'
)() as {
  measureMotion: (
    bytes: Uint8Array,
    duration: number
  ) => { porcentajeQuieto: number; tramos: { inicio: number; fin: number }[]; aviso: string | null }
  transitionSamples: () => number[]
  inspectFrame: (size: { width: number; height: number }) => { issues: string[]; visibleText: number; coverage: number }
  needsSmallerFrames: (sizes: number[]) => boolean
  colorVariation: (rgb: Uint8Array) => number
}
beforeEach(() => {
  const dom = new Window()
  vi.stubGlobal('document', dom.document)
  vi.stubGlobal('window', dom)
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
  it('detecta texto recortado por un contenedor durante una transición', () => {
    const review = scene('clean')
    const section = document.querySelector('section') as HTMLElement
    section.style.overflowX = 'hidden'
    section.style.overflowY = 'hidden'
    section.style.height = '40px'
    expect(review().issues.join(' ')).toContain('queda recortado por su contenedor')
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

it('mide tiempo quieto, ignora pausas breves y avisa con sus tramos', () => {
  const frames = (values: number[]) => Uint8Array.from(values.flatMap((v) => Array(4096).fill(v)))
  expect(measureMotion(frames(Array(17).fill(42)), 4)).toMatchObject({ porcentajeQuieto: 100, tramos: [{ inicio: 0, fin: 4 }] })
  expect(measureMotion(frames(Array(17).fill(42)), 4).aviso).toContain('movimiento continuo')
  expect(measureMotion(frames(Array.from({ length: 17 }, (_, i) => (i % 2 ? 255 : 0))), 4).aviso).toBeNull()
  expect(measureMotion(frames([0, 0, 0, 255, 255, 255, 0, 0, 0]), 2).porcentajeQuieto).toBe(0)
  // A single long hold warns even below the percentage threshold.
  const values = Array.from({ length: 41 }, (_, i) => (i < 13 ? 0 : i % 2 ? 255 : 0))
  expect(measureMotion(frames(values), 10).aviso).toContain('0–3 s')
})
it('muestrea .clip, solapamientos y la mitad de tweens cortos', () => {
  document.write('<div class="clip" data-start="0" data-duration="4.4"></div><div class="clip" data-start="3.8" data-duration="4.2"></div>')
  Object.assign(window, {
    __timelines: { main: { globalTime: () => 0.04, getChildren: () => [{ duration: () => 0.6, globalTime: (t: number) => 3.84 + t }] } }
  })
  const times = transitionSamples()
  expect(times.some((t) => Math.abs(t - 4.1) < 0.001)).toBe(true)
  expect(times).toContain(2.2)
})

it('avisa desde 2 s quietos fuera del cierre; permite los últimos 1,5 s y las pausas de las referencias', () => {
  const frames = (duration: number, start: number, end: number) =>
    Uint8Array.from(
      Array.from({ length: duration * 4 + 1 }, (_, i) => Array(4096).fill(i >= start * 4 && i <= end * 4 ? 42 : i % 2 ? 255 : 0)).flat()
    )
  expect(measureMotion(frames(15, 6, 8), 15).aviso).not.toBeNull()
  expect(measureMotion(frames(15, 12.75, 15), 15).aviso).toBeNull()
  expect(measureMotion(frames(15, 6, 7.75), 15).aviso).toBeNull()
})
it('muestrea cada décima antes y después de TODOS los cortes, aun con muchas escenas', () => {
  document.write(Array.from({ length: 12 }, (_, i) => `<div class="clip" data-start="${i * 5}" data-duration="5"></div>`).join(''))
  const times = transitionSamples()
  for (const boundary of [5, 30, 55]) for (let i = -5; i <= 5; i++) expect(times).toContain(boundary + i / 10)
})
it('detecta una tarjeta vacía aunque su fondo tenga mucho contraste', () => {
  const review = scene('clean')
  for (const p of document.querySelectorAll('p')) (p as HTMLElement).style.opacity = '0'
  expect(review().issues.join(' ')).toContain('tarjeta sin contenido visible')
})
