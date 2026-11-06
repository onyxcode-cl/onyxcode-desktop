// @vitest-environment jsdom
/** Tarjetas de traducción dentro de la conversación: progreso, resultado con botones, versión limpia y error. */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '../../../../test/dom-render'

const call = vi.fn(async () => ({ saved: true, opened: true }))
vi.mock('../../lib/api', () => ({ call: (...a: unknown[]) => (call as (...x: unknown[]) => unknown)(...a) }))
vi.mock('../../lib/announce', () => ({ announce: vi.fn() }))
vi.mock('../../stores/server', () => ({ useServer: { getState: () => ({ connection: { chatDirectory: '/x' } }) } }))
vi.mock('../code/impl/pr/pr-ai', () => ({ askModel: vi.fn() }))
vi.mock('./model-info', () => ({ chatModelSeesImages: () => false }))

import { TranslateJobs } from './TranslateJobs'
import { useTranslateJobs, type TranslateJob } from './jobs'

const preset = { name: 'poliza.pdf', base64: 'AAAA', target: 'es' as const }
const report = { translated: 71, untranslated: 0, shrunk: 3, overflow: [], linksDropped: 0 }
const done = (clean: boolean): TranslateJob => ({
  id: 'j1',
  preset,
  state: {
    kind: 'done',
    saved: false,
    outcome: {
      jobId: 'aaaaaaaaaaaaaaaa',
      outName: 'poliza (es).pdf',
      report,
      pages: 5,
      pagesWithoutText: [],
      failedSegments: 0,
      ...(clean ? { cleanOutName: 'poliza (es, limpio).pdf' } : {})
    }
  }
})

let m: Mounted | null = null
beforeEach(() => call.mockClear())
afterEach(() => {
  m?.unmount()
  m = null
  useTranslateJobs.setState({ jobs: [] })
})

describe('TranslateJobs', () => {
  it('sin trabajos no pinta nada', () => {
    m = mount(createElement(TranslateJobs))
    expect(m.q('[data-testid="translate-jobs"]')).toBeNull()
  })

  it('en curso muestra el avance y «Cancelar»', () => {
    useTranslateJobs.setState({
      jobs: [{ id: 'j1', preset, state: { kind: 'running', progress: { phase: 'translating', done: 2, total: 6 } } }]
    })
    m = mount(createElement(TranslateJobs))
    const card = m.q('[data-testid="translate-job"]')!
    expect(card.getAttribute('data-state')).toBe('running')
    expect(card.textContent).toContain('poliza.pdf')
    expect(card.textContent).toContain('lote 3 de 6')
    expect(card.textContent).toContain('Cancelar')
  })

  it('terminado muestra Abrir y Guardar, y la versión limpia solo si existe', () => {
    useTranslateJobs.setState({ jobs: [done(true)] })
    m = mount(createElement(TranslateJobs))
    const card = m.q('[data-testid="translate-job"]')!
    expect(card.textContent).toContain('71 textos traducidos en 5 páginas')
    expect(card.textContent).toContain('poliza (es, limpio).pdf')
    const buttons = [...card.querySelectorAll('button')]
    const open = buttons.find((b) => b.textContent === 'Abrir')!
    click(open)
    expect(call).toHaveBeenCalledWith('translate:pdfOpen', { jobId: 'aaaaaaaaaaaaaaaa' })
    click(buttons.find((b) => b.textContent === 'Abrir versión limpia')!)
    expect(call).toHaveBeenCalledWith('translate:pdfOpen', { jobId: 'aaaaaaaaaaaaaaaa', clean: true })
  })

  it('sin versión limpia no hay botones de versión limpia; quitar la tarjeta la saca', () => {
    useTranslateJobs.setState({ jobs: [done(false)] })
    m = mount(createElement(TranslateJobs))
    const card = m.q('[data-testid="translate-job"]')!
    expect(card.textContent).not.toContain('versión limpia')
    click(card.querySelector('button[aria-label="Quitar"]')!)
    expect(useTranslateJobs.getState().jobs).toHaveLength(0)
  })

  it('un error muestra el motivo y «Reintentar» (salvo si se canceló)', () => {
    useTranslateJobs.setState({ jobs: [{ id: 'j1', preset, state: { kind: 'error', reason: 'encrypted' } }] })
    m = mount(createElement(TranslateJobs))
    const card = m.q('[data-testid="translate-job"]')!
    expect(card.textContent).toContain('contraseña')
    expect(card.textContent).toContain('Reintentar')
  })
})
