// @vitest-environment jsdom
/** H4: una tarjeta de inicio rellena la caja con un texto editable, el cursor queda al final y NO se envía. */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { es } from '@shared/i18n/es'
import { en } from '@shared/i18n/en'
import { mount, typeInto, type Mounted } from '../../../../test/dom-render'
import { ChatComposer } from './ChatComposer'

const KEYS = ['write', 'brainstorm', 'explain', 'plan', 'translate'] as const

let m: Mounted | null = null
let n = 0 // cada prueba usa su propia conversación: los borradores viven fuera del componente
beforeEach(() => {
  n++
  vi.unstubAllGlobals() // jsdom real en vez del window de setup.ts
  delete (window as unknown as { api?: unknown }).api
  // El cursor se coloca en un requestAnimationFrame.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.unstubAllGlobals()
})

const composer = (extra: Record<string, unknown> = {}): ReturnType<typeof createElement> =>
  createElement(ChatComposer, { onSend: vi.fn(), busy: false, autoFocusKey: `s${n}`, ...extra })

describe('tarjetas de inicio del Chat', () => {
  for (const [lang, dict] of [
    ['es', es],
    ['en', en]
  ] as const) {
    for (const k of KEYS) {
      it(`${lang}/${k}: rellena la caja, deja el cursor al final y no envía`, () => {
        const text = (dict as unknown as Record<string, string>)[`chat.suggest.${k}.prompt`]
        expect(text.trim().length).toBeGreaterThan(8) // un arranque útil, no una palabra suelta
        const onSend = vi.fn()
        m = mount(composer({ onSend }))
        const box = m.q<HTMLTextAreaElement>('textarea')!
        expect(box.value).toBe('')
        m.rerender(composer({ onSend, insert: { text, key: 1 } }))
        expect(box.value).toBe(text)
        expect(box.selectionStart).toBe(text.length)
        expect(box.selectionEnd).toBe(text.length)
        expect(document.activeElement).toBe(box)
        expect(onSend).not.toHaveBeenCalled()
        // sigue siendo editable: se escribe a continuación y no se envía solo
        typeInto(box, `${text}mi tema`)
        expect(box.value).toBe(`${text}mi tema`)
        expect(onSend).not.toHaveBeenCalled()
      })
    }
  }

  it('pulsar otra tarjeta reemplaza el texto anterior (llave nueva)', () => {
    m = mount(composer({ insert: { text: 'uno', key: 1 } }))
    m.rerender(composer({ insert: { text: 'dos', key: 2 } }))
    expect(m.q<HTMLTextAreaElement>('textarea')!.value).toBe('dos')
  })
})
