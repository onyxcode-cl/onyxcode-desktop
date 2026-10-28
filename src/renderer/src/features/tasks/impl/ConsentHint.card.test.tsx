/** Tarjeta de consentimiento de Control del PC (Windows) dentro del chat: solo con el rechazo en la conversación y sin consentimiento. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WIN_CONSENT_MISSING_MARK } from '@shared/unified-bridge'
import { assistantMessage, toolPart } from '../../../../../test/fixtures/events'
import type { MessageEntry } from '../../../stores/sessions'

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('./store', () => ({
  useTasks: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(mock.state) : mock.state), {
    getState: () => mock.state,
    setState: () => undefined,
    subscribe: () => () => undefined
  }),
  refreshComputerStatus: () => Promise.resolve()
}))
// La tarjeta real (casilla, armado, `computer:winConsent`) ya tiene sus pruebas: aquí solo importa que se monte.
vi.mock('./ComputerConsentWin', () => ({ ComputerConsentWin: () => createElement('div', { 'data-testid': 'consent-card' }) }))

import { WinConsentHintCard } from './ConsentHint'

const rejected: MessageEntry[] = [
  {
    info: assistantMessage('m1', 's'),
    parts: [
      toolPart('p1', 'm1', 's', 'computer_request_access', { status: 'error', error: `${WIN_CONSENT_MISSING_MARK}: actívalo en Ajustes` })
    ]
  }
]
const unrelated: MessageEntry[] = [
  {
    info: assistantMessage('m2', 's'),
    parts: [toolPart('p2', 'm2', 's', 'bash', { status: 'error', error: 'rm: Operation not permitted' })]
  }
]
const html = (entries: MessageEntry[]): string => renderToStaticMarkup(createElement(WinConsentHintCard, { entries }))

describe('WinConsentHintCard', () => {
  beforeEach(() => {
    mock.state = { computerStatus: { win: { consent: false } } }
  })
  it('sin rechazo de consentimiento en la conversación no pinta nada', () => {
    expect(html([])).toBe('')
    expect(html(unrelated)).toBe('')
  })
  it('con el rechazo y sin consentimiento: explica y monta la tarjeta de consentimiento', () => {
    const out = html(rejected)
    expect(out).toContain('activar Control del PC una vez')
    expect(out).toContain('data-testid="consent-card"')
  })
  it('con el consentimiento ya dado: avisa que vuelva a pedirlo, sin tarjeta', () => {
    mock.state = { computerStatus: { win: { consent: true } } }
    const out = html(rejected)
    expect(out).toContain('Control del PC activado')
    expect(out).not.toContain('consent-card')
  })
})
