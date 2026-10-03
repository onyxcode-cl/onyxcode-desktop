import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { capsFor } from '@shared/platform-caps'
import { PopoverPanel } from '../../components/PopoverPanel'
import { isRemote, useIsRemote } from '../../lib/platform'
import { isSubmitKey } from '../../lib/textarea'

/** En Mac y Windows (superficie no remota) la interfaz móvil no actúa: mismo marcado, mismas teclas, mismas capacidades. */
describe('fuera de la superficie remota no cambia nada', () => {
  it('no se detecta superficie remota', () => {
    expect(isRemote()).toBe(false)
    expect(useIsRemote()).toBe(false)
    expect(capsFor('darwin').terminal).toBe(true)
    expect(capsFor('win32').nativeDialogs).toBe(true)
  })

  it('PopoverPanel es el mismo div con sus clases (sin hoja)', () => {
    const html = renderToStaticMarkup(
      createElement(PopoverPanel, { open: true, onClose: () => undefined, title: 'x', className: 'absolute z-40', children: 'hola' })
    )
    expect(html).toBe('<div class="absolute z-40">hola</div>')
    expect(renderToStaticMarkup(createElement(PopoverPanel, { open: false, onClose: () => undefined, title: 'x', children: 'a' }))).toBe('')
  })

  it('Enter sigue enviando en el compositor', () => {
    const ev = { key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false } }
    expect(isSubmitKey(ev)).toBe(true)
  })
})
