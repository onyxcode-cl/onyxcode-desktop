// @ts-expect-error jsdom is a test-only dependency without bundled declarations.
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { presentationScript } from './presentation-script'

describe('presentation controls', () => {
  it('navigates one slide at a time, stops existing handlers, clamps limits and fits after resize', () => {
    const dom: { window: Window & typeof globalThis } = new JSDOM(
      '<body><section class="slide" data-lzx-export-display="flex" data-lzx-export-scale="0.5"></section><section class="slide"></section><section class="slide"></section></body>',
      { runScripts: 'outside-only' }
    )
    try {
      const { window } = dom
      let deckClicks = 0
      window.document.addEventListener('click', () => {
        deckClicks++
      })
      window.eval(presentationScript({ counter: 'Lámina {current} de {total}', controls: 'Esc para salir' }))
      const counter = window.document.querySelector('[data-lzx-slide-counter]')!
      const key = (key: string): void => {
        window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      }
      expect(counter.textContent).toBe('1 / 3')
      key('ArrowRight')
      expect(counter.textContent).toBe('2 / 3')
      key(' ')
      key('ArrowRight')
      expect(counter.textContent).toBe('3 / 3')
      key('Home')
      key('ArrowLeft')
      expect(counter.textContent).toBe('1 / 3')
      window.document.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      expect(counter.textContent).toBe('2 / 3')
      expect(counter.getAttribute('aria-label')).toBe('Lámina 2 de 3')
      expect(deckClicks).toBe(0)
      const slides = [...window.document.querySelectorAll<HTMLElement>('.slide')]
      expect(slides.map((slide) => slide.style.display)).toEqual(['none', 'block', 'none'])
      Object.defineProperty(window, 'innerWidth', { value: 1920 })
      Object.defineProperty(window, 'innerHeight', { value: 1112 })
      window.dispatchEvent(new window.Event('resize'))
      expect(slides[0].style.transform).toBe('scale(1)')
      expect(slides[1].style.transform).toBe('scale(2)')
      expect(slides[1].style.left).toBe('0px')
      expect(slides[1].style.top).toBe('0px')
    } finally {
      dom.window.close()
    }
  })
})
