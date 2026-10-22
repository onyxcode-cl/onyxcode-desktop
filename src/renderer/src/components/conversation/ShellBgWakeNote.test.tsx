// @vitest-environment jsdom
/** Aviso automático de `bgshell`: una línea compacta con el detalle plegable, en Chat (y la misma pieza en Code y Tareas). */
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SHELL_BG_WAKE_HEAD } from '@shared/shell-bg-wake-marker'
import { click, mount, type Mounted } from '../../../../test/dom-render'
import { assistantMessage, textPart, userMessage } from '../../../../test/fixtures/events'
import { ChatMessageList } from '../../features/chat/ChatMessageList'
import { ShellBgWakeNote } from './ShellBgWakeNote'

const FULL = `${SHELL_BG_WAKE_HEAD} 6 trabajos en segundo plano terminaron:\nResumen\n\`\`\`\nbg_job001 («cmd 1» (código 0, 8 ms): salida 1\n\`\`\``
const S = 'ses_1'
const wakeEntry = {
  info: userMessage('msg_w', S),
  parts: [textPart('prt_w', 'msg_w', S, FULL, { metadata: { lazunox: 'shell-bg-wake', jobs: 6, event: 'exit' } })]
}
const normal = { info: userMessage('msg_n', S), parts: [textPart('prt_n', 'msg_n', S, 'Hola')] }
const reply = { info: assistantMessage('msg_a', S), parts: [textPart('prt_a', 'msg_a', S, 'Listo')] }

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

describe('ShellBgWakeNote', () => {
  it('Chat: el aviso se ve como una línea «Terminaron 6 trabajos…», no como una burbuja de la persona, y no vuelca el texto', () => {
    const html = renderToStaticMarkup(createElement(ChatMessageList, { entries: [wakeEntry, reply], busy: false }))
    expect(html).toContain('Terminaron 6 trabajos en segundo plano')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('user-bubble')
    expect(html).not.toContain('bg_job001')
    expect(html).toContain('Listo')
  })

  it('un mensaje normal de la persona sigue siendo su burbuja', () => {
    const html = renderToStaticMarkup(createElement(ChatMessageList, { entries: [normal, reply], busy: false }))
    expect(html).toContain('Hola')
    expect(html).not.toContain('shell-bg-wake-note')
  })

  it('el detalle se abre y se cierra con el botón (accesible por teclado) y muestra el texto completo', () => {
    m = mount(createElement(ShellBgWakeNote, { info: { count: 1, kind: 'exit', text: FULL } }))
    const btn = m.q<HTMLButtonElement>('[data-testid="shell-bg-wake-note"] button')!
    expect(btn.textContent).toContain('Terminó 1 trabajo en segundo plano')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(m.host.textContent).not.toContain('bg_job001')
    click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(m.host.textContent).toContain('bg_job001')
    expect(m.host.textContent).toContain('Aviso automático')
    click(btn)
    expect(m.host.textContent).not.toContain('bg_job001')
  })

  it('el título distingue fin, atasco y mezcla', () => {
    const html = (kind: 'exit' | 'possibly-stuck' | 'batch'): string =>
      renderToStaticMarkup(createElement(ShellBgWakeNote, { info: { count: 2, kind, text: FULL } }))
    expect(html('exit')).toContain('Terminaron 2 trabajos')
    expect(html('possibly-stuck')).toContain('2 trabajos en segundo plano sin actividad')
    expect(html('batch')).toContain('Aviso de 2 trabajos')
  })
})
