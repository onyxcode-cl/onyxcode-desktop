import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PdfExtractResult } from '@shared/translate-pdf'

vi.mock('../../lib/api', () => ({ call: vi.fn() }))
vi.mock('../../lib/announce', () => ({ announce: vi.fn() }))
vi.mock('../../stores/server', () => ({ useServer: { getState: () => ({ connection: { chatDirectory: '/x' } }) } }))
vi.mock('../code/impl/pr/pr-ai', () => ({ askModel: vi.fn() }))
vi.mock('./model-info', () => ({ chatModelSeesImages: () => false }))

import {
  cancelTranslateJob,
  dismissTranslateJob,
  markJobSaved,
  retryTranslateJob,
  startTranslateJob,
  useTranslateJobs
} from './jobs'
import type { TranslateDeps } from './translate'

const preset = { name: 'x.pdf', base64: 'AAAA', target: 'en' as const }

function deps(over: Partial<TranslateDeps> = {}): TranslateDeps {
  const extract: PdfExtractResult = {
    ok: true,
    jobId: 'aaaaaaaaaaaaaaaa',
    pages: 1,
    segments: [{ id: 'p1-0', pagina: 1, texto: 'hola' }],
    pagesWithoutText: []
  }
  return {
    extract: vi.fn(async () => extract),
    apply: vi.fn(async () => ({
      ok: true as const,
      outName: 'x (en).pdf',
      report: { translated: 1, untranslated: 0, shrunk: 0, overflow: [], linksDropped: 0 }
    })),
    discard: vi.fn(async () => undefined),
    ask: vi.fn(async (p: string) => {
      const items = JSON.parse(p.slice(p.indexOf('Texts:') + 6)) as Record<string, string>
      return JSON.stringify({ translations: Object.fromEntries(Object.keys(items).map((k) => [k, 'hello'])), glossary: {} })
    }),
    ...over
  }
}

const state = (): ReturnType<typeof useTranslateJobs.getState>['jobs'] => useTranslateJobs.getState().jobs
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

afterEach(() => useTranslateJobs.setState({ jobs: [] }))

describe('trabajos de traducción dentro de la conversación', () => {
  it('arranca en curso y termina con el resultado; se pueden tener varios a la vez', async () => {
    const id = startTranslateJob(preset, deps(), false)
    expect(state()).toHaveLength(1)
    expect(state()[0].state.kind).toBe('running')
    const id2 = startTranslateJob({ ...preset, name: 'y.pdf' }, deps(), false)
    await settle()
    expect(new Set([id, id2]).size).toBe(2)
    expect(state().map((j) => j.state.kind)).toEqual(['done', 'done'])
    const done = state()[0].state
    expect(done.kind === 'done' && done.outcome.outName).toBe('x (en).pdf')
  })

  it('cancelar deja la tarjeta como «cancelada» y reintentar la reemplaza por una nueva', async () => {
    const slow = deps({ extract: vi.fn(() => new Promise<PdfExtractResult>(() => undefined)) })
    const ask = vi.fn(async () => '')
    const id = startTranslateJob(preset, { ...slow, ask }, false)
    cancelTranslateJob(id)
    // el motor espera a su extracción: al cancelar, la tarjeta pasa a error «aborted» en cuanto el motor lo nota
    await settle()
    expect(state()).toHaveLength(1)
    retryTranslateJob(id, deps())
    expect(state().map((j) => j.id)).not.toContain(id)
    expect(state()).toHaveLength(1)
    await settle()
    expect(state()[0].state.kind).toBe('done')
  })

  it('un fallo del servicio queda como error de la tarjeta y no lanza', async () => {
    startTranslateJob(preset, deps({ extract: vi.fn(async () => ({ ok: false as const, reason: 'encrypted' as const })) }), false)
    await settle()
    const s = state()[0].state
    expect(s).toMatchObject({ kind: 'error', reason: 'encrypted' })
  })

  it('quitar la tarjeta la borra; guardar marca el resultado como guardado', async () => {
    const id = startTranslateJob(preset, deps(), false)
    await settle()
    markJobSaved(id)
    const s = state()[0].state
    expect(s.kind === 'done' && s.saved).toBe(true)
    dismissTranslateJob(id)
    expect(state()).toHaveLength(0)
  })
})
