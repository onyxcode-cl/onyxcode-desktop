// @vitest-environment jsdom
/** Botón y panel de «Instrucciones de esta conversación»: abrir, guardar, indicador discreto, borrar, tope y aviso honesto. */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CONVERSATION_INSTRUCTIONS } from '@shared/personal-context'
import { click, mount, pressKey, typeInto, type Mounted } from '../../../../test/dom-render'
import { ConversationInstructionsButton } from './ConversationInstructionsButton'
import { getConversationInstructions, resetConversationInstructionsCache } from './conversation-instructions'

let m: Mounted | null = null
const btn = (id: string): ReturnType<Mounted['q']> => m!.q(`[data-testid="${id}"]`)
const view = (sessionId: string | null): ReturnType<typeof createElement> => createElement(ConversationInstructionsButton, { sessionId })

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals() // jsdom real en vez del window de setup.ts
  delete (window as unknown as { api?: unknown }).api
  resetConversationInstructionsCache()
})
afterEach(() => {
  m?.unmount()
  m = null
})

describe('ConversationInstructionsButton', () => {
  it('sin conversación abierta no se pinta', () => {
    m = mount(view(null))
    expect(m.host.innerHTML).toBe('')
  })

  it('abre un diálogo con el aviso honesto y el tope', () => {
    m = mount(view('s1'))
    expect(btn('conv-instr-dot')).toBeNull()
    click(btn('conv-instr-button'))
    const dialog = m.q('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('Instrucciones de esta conversación')
    expect(dialog.textContent).toContain('viajan al modelo conectado')
    expect(dialog.textContent).toContain('No cambian las reglas de seguridad ni los permisos')
    expect((btn('conv-instr-text') as HTMLTextAreaElement).maxLength).toBe(MAX_CONVERSATION_INSTRUCTIONS)
    expect(dialog.textContent).toContain(`0 de ${MAX_CONVERSATION_INSTRUCTIONS} caracteres`)
    expect(document.activeElement).toBe(btn('conv-instr-text'))
  })

  it('guardar deja el texto en esa sesión y enciende el indicador; borrar lo apaga', () => {
    m = mount(view('s1'))
    click(btn('conv-instr-button'))
    typeInto(btn('conv-instr-text') as HTMLTextAreaElement, 'responde en inglés')
    click(btn('conv-instr-save'))
    expect(m.q('[role="dialog"]')).toBeNull()
    expect(getConversationInstructions('s1')).toBe('responde en inglés')
    expect(getConversationInstructions('s2')).toBe('')
    expect(btn('conv-instr-dot')).not.toBeNull()
    expect(`${btn('conv-instr-button')!.getAttribute('aria-label')}${(btn('conv-instr-button') as HTMLElement).title}`).toContain('activas')

    click(btn('conv-instr-button'))
    expect((btn('conv-instr-text') as HTMLTextAreaElement).value).toBe('responde en inglés')
    click(btn('conv-instr-clear'))
    expect(getConversationInstructions('s1')).toBe('')
    expect(btn('conv-instr-dot')).toBeNull()
  })

  it('cerrar con Esc descarta lo escrito sin guardar', () => {
    m = mount(view('s1'))
    click(btn('conv-instr-button'))
    typeInto(btn('conv-instr-text') as HTMLTextAreaElement, 'no guardar')
    pressKey(document, 'Escape')
    expect(m.q('[role="dialog"]')).toBeNull()
    expect(getConversationInstructions('s1')).toBe('')
  })

  it('cada conversación tiene las suyas', () => {
    m = mount(view('s1'))
    click(btn('conv-instr-button'))
    typeInto(btn('conv-instr-text') as HTMLTextAreaElement, 'solo s1')
    click(btn('conv-instr-save'))
    m.rerender(view('s2'))
    expect(btn('conv-instr-dot')).toBeNull()
    m.rerender(view('s1'))
    expect(btn('conv-instr-dot')).not.toBeNull()
  })
})
