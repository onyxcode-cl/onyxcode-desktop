// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { ToolRow } from './ToolCard'
import { applyLangPref } from '../../../lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  applyLangPref('es')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  applyLangPref('es')
})

const part = (error: string): ToolPart =>
  ({
    id: 'p1',
    type: 'tool',
    tool: 'task',
    callID: 'c1',
    state: { status: 'error', input: { subagent_type: 'general', description: 'x', prompt: 'p' }, error, time: { start: 1, end: 2 } }
  }) as unknown as ToolPart

function open(error: string): string {
  act(() => root.render(createElement(ToolRow, { part: part(error), root: null })))
  act(() => host.querySelector<HTMLButtonElement>('button')!.click())
  return host.textContent ?? ''
}

describe('ayudante bloqueado: motivo en la tarjeta', () => {
  it('explica en llano y deja el texto técnico debajo', () => {
    const txt = open(
      'Lanzamiento de subagente bloqueado por Lazunox: el subagente "general" tendria mas libertad que quien lo lanza (build): bash.'
    )
    expect(txt).toContain('No se lanzó este ayudante')
    expect(txt).toContain('conversación nueva')
    expect(txt).toContain('tendria mas libertad')
  })
  it('Solo explorar (regla de la sesión)', () => {
    expect(open('The user has specified a rule which prevents you from using this specific tool call.')).toContain(
      'Este modo no permite lanzar ayudantes'
    )
  })
  it('un error cualquiera no lleva la explicación', () => {
    expect(open('boom')).not.toContain('ayudante')
  })
  it('en inglés', () => {
    applyLangPref('en')
    expect(open('Lanzamiento de subagente bloqueado por Lazunox: no se pudo leer la lista de agentes.')).toContain(
      'could not confirm the helper was safe'
    )
  })
})
