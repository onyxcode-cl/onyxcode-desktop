// @vitest-environment jsdom
/** F8-B200: al enviar un PDF con una petición de traducir, el compositor ofrece traducirlo sin cambiar el diseño (no se envía solo). */
import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, mount, pressKey, typeInto, type Mounted } from '../../../../test/dom-render'

const openTranslatePdf = vi.fn()
vi.mock('../translate-pdf/TranslatePdfDialog', () => ({ openTranslatePdf: (...a: unknown[]) => openTranslatePdf(...a) }))
vi.mock('../translate-pdf/model-info', () => ({ chatModelInfo: () => ({ label: 'GPT-6 Luna', free: false }) }))
vi.mock('../../lib/platform', async (orig) => ({
  ...(await orig<typeof import('../../lib/platform')>()),
  platformCaps: () => ({ ...({} as Record<string, boolean>), translatePdf: true, docViewer: false, tasks: true })
}))

import { ChatComposer } from './ChatComposer'
import type { ChatAttachment } from '../../lib/attachments'

const pdf: ChatAttachment = { id: 'a1', name: 'informe.pdf', mime: 'application/pdf', url: 'data:application/pdf;base64,JVBERi0xLjQK' }
const word: ChatAttachment = { id: 'a2', name: 'nota.docx', mime: 'text/plain', url: 'data:text/plain;base64,aG9sYQ==' }

let m: Mounted | null = null
let n = 0
beforeEach(() => {
  n++
  openTranslatePdf.mockClear()
  vi.unstubAllGlobals()
  delete (window as unknown as { api?: unknown }).api
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0))
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.unstubAllGlobals()
})

function setup(text: string, attachments: ChatAttachment[]): { onSend: ReturnType<typeof vi.fn> } {
  const onSend = vi.fn()
  m = mount(createElement(ChatComposer, { onSend, busy: false, autoFocusKey: `t${n}`, insert: { text, key: 1, attachments } }))
  const box = m.q<HTMLTextAreaElement>('textarea')!
  typeInto(box, text)
  return { onSend }
}
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const send = (): void => {
  const box = m!.q<HTMLTextAreaElement>('textarea')!
  act(() => pressKey(box, 'Enter'))
}

describe('tarjeta «¿traducir este PDF sin cambiar el diseño?»', () => {
  it('con un PDF y «traduce al inglés»: no envía, muestra la tarjeta con el idioma, el PDF y el modelo', () => {
    const { onSend } = setup('traduce esto al inglés', [pdf])
    send()
    expect(onSend).not.toHaveBeenCalled()
    const card = m!.q('[data-testid="translate-offer"]')!
    expect(card.textContent).toContain('informe.pdf')
    expect(card.textContent).toContain('Inglés')
    expect(card.textContent).toContain('GPT-6 Luna')
  })

  it('«Traducir así» abre la traducción con el PDF y el idioma, y el mensaje no se envía', () => {
    const { onSend } = setup('tradúcelo al portugués', [pdf])
    send()
    click(m!.q('[data-testid="translate-offer-yes"]'))
    expect(openTranslatePdf).toHaveBeenCalledWith({ kind: 'pdf', name: 'informe.pdf', base64: 'JVBERi0xLjQK', target: 'pt' })
    expect(onSend).not.toHaveBeenCalled()
    expect(m!.q('[data-testid="translate-offer"]')).toBeNull()
  })

  it('un Word adjunto (convertido a texto para la IA) también ofrece la tarjeta y traduce los bytes ORIGINALES', () => {
    const word = { id: 'w1', name: 'acta.docx', mime: 'text/plain', url: 'data:text/plain;base64,aG9sYQ==', originalDocx: 'UEsDBAo=' }
    const { onSend } = setup('traduce al inglés', [word])
    send()
    expect(onSend).not.toHaveBeenCalled()
    click(m!.q('[data-testid="translate-offer-yes"]'))
    expect(openTranslatePdf).toHaveBeenCalledWith({ kind: 'docx', name: 'acta.docx', base64: 'UEsDBAo=', target: 'en' })
  })

  it('«Enviar como mensaje» manda el mensaje tal cual, con el PDF', async () => {
    const { onSend } = setup('traduce esto al inglés', [pdf])
    send()
    click(m!.q('[data-testid="translate-offer-no"]'))
    await flush()
    expect(onSend).toHaveBeenCalledWith('traduce esto al inglés', [pdf])
    expect(openTranslatePdf).not.toHaveBeenCalled()
  })

  it.each([
    ['resume este documento', [pdf]],
    ['traduce solo el párrafo 2', [pdf]],
    ['traduce esto al inglés', [word]],
    ['traduce esto al inglés', []],
    ['hola', [pdf]]
  ])('«%s» con %j adjuntos: se envía normal, sin tarjeta', async (text, files) => {
    const { onSend } = setup(text, files as ChatAttachment[])
    send()
    await flush()
    expect(m!.q('[data-testid="translate-offer"]')).toBeNull()
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('si la persona edita el mensaje, la tarjeta desaparece', () => {
    setup('traduce esto al inglés', [pdf])
    send()
    expect(m!.q('[data-testid="translate-offer"]')).not.toBeNull()
    typeInto(m!.q<HTMLTextAreaElement>('textarea')!, 'traduce esto al inglés, por favor')
    expect(m!.q('[data-testid="translate-offer"]')).toBeNull()
  })
})
