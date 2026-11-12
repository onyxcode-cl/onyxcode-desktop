// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, mount, typeInto, type Mounted } from '../../../../test/dom-render'
import { useLang } from '../../lib/i18n'
const h = vi.hoisted(() => ({ available: vi.fn(), prepare: vi.fn(), remote: false }))
vi.mock('./office-overdrive', async (orig) => ({
  ...(await orig<typeof import('./office-overdrive')>()),
  chatOfficeAvailable: h.available
}))
vi.mock('../tasks/impl/chat-office', () => ({ prepareOfficeTask: h.prepare }))
vi.mock('../../lib/platform', async (orig) => ({
  ...(await orig<typeof import('../../lib/platform')>()),
  isRemoteSurface: () => h.remote
}))
import { ChatComposer } from './ChatComposer'
import type { ChatAttachment } from '../../lib/attachments'
const word: ChatAttachment = {
  id: 'w',
  name: 'informe.docx',
  mime: 'text/plain',
  url: 'data:text/plain;base64,dGV4dG8=',
  originalDocx: 'UEsDBA=='
}
let view: Mounted | null = null,
  n = 0
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
beforeEach(() => {
  n++
  h.remote = false
  h.available.mockReset().mockResolvedValue(true)
  h.prepare.mockReset().mockResolvedValue(undefined)
  useLang.setState({ lang: 'es' })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0))
})
afterEach(() => {
  view?.unmount()
  view = null
  useLang.setState({ lang: 'es' })
  vi.unstubAllGlobals()
})
async function setup(text = 'cambia el título', attachments = [word]): Promise<ReturnType<typeof vi.fn>> {
  const send = vi.fn()
  view = mount(
    createElement(ChatComposer, {
      onSend: send,
      busy: false,
      showAttach: true,
      autoFocusKey: `office${n}`,
      insert: { text, key: 1, attachments }
    })
  )
  await flush()
  return send
}
describe('Hacer esto en Overdrive', () => {
  it('ofrece antes de enviar el pedido exacto de la prueba a mano: «cámbiame la fecha al 30 de noviembre»', async () => {
    await setup('cámbiame la fecha al 30 de noviembre', [{ ...word, name: 'contrato.docx' }])
    expect(view!.q('[data-testid="office-overdrive-yes"]')?.textContent).toBe('Hacer esto en Overdrive')
  })
  it.each([
    ['docx', 'originalDocx'],
    ['xlsx', 'originalXlsx'],
    ['pptx', 'originalPptx']
  ])('%s: ofrece, copia original y pedido al borrador sin enviar', async (ext, key) => {
    const f = { id: ext, name: `a.${ext}`, mime: 'text/plain', url: word.url, [key]: 'UEsDBA==' }
    const send = await setup('cambia el título', [f])
    const button = view!.q<HTMLButtonElement>('[data-testid="office-overdrive-yes"]')!
    expect(button.textContent).toBe('Hacer esto en Overdrive')
    click(button)
    await flush()
    expect(h.prepare).toHaveBeenCalledExactlyOnceWith('cambia el título', [{ name: `a.${ext}`, base64: 'UEsDBA==' }])
    expect(send).not.toHaveBeenCalled()
    expect(view!.q<HTMLTextAreaElement>('textarea')!.value).toBe('cambia el título')
    expect(view!.host.textContent).toContain(`a.${ext}`)
  })
  it('traduce el botón al inglés', async () => {
    useLang.setState({ lang: 'en' })
    await setup('replace the title')
    expect(view!.q('[data-testid="office-overdrive-yes"]')!.textContent).toBe('Do this in Overdrive')
  })
  it.each(['resume el contenido', 'lee este documento', 'traduce al inglés'])('«%s» conserva su flujo', async (text) => {
    await setup(text)
    expect(view!.q('[data-testid="office-overdrive-offer"]')).toBeNull()
  })
  it('no ofrece con disponibilidad efectiva apagada o en celular', async () => {
    h.available.mockResolvedValueOnce(false)
    await setup()
    expect(view!.q('[data-testid="office-overdrive-offer"]')).toBeNull()
    view!.unmount()
    view = null
    n++
    h.remote = true
    await setup()
    expect(view!.q('[data-testid="office-overdrive-offer"]')).toBeNull()
  })
  it('errores de copia/conexión conservan pedido y adjunto, y permiten reintentar sin un éxito falso', async () => {
    const send = await setup()
    h.prepare.mockRejectedValueOnce(new Error('copia o conexión fallida'))
    click(view!.q<HTMLButtonElement>('[data-testid="office-overdrive-yes"]')!)
    await flush()
    expect(view!.host.textContent).toContain('copia o conexión fallida')
    expect(view!.q<HTMLTextAreaElement>('textarea')!.value).toBe('cambia el título')
    expect(view!.host.textContent).toContain('informe.docx')
    expect(send).not.toHaveBeenCalled()
    click(view!.q<HTMLButtonElement>('[data-testid="office-overdrive-yes"]')!)
    await flush()
    expect(h.prepare).toHaveBeenCalledTimes(2)
  })
  it('un doble clic prepara una sola tarea; cambiar a una lectura retira la oferta', async () => {
    let finish!: () => void
    h.prepare.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    await setup()
    const button = view!.q<HTMLButtonElement>('[data-testid="office-overdrive-yes"]')!
    click(button)
    click(button)
    await flush()
    expect(h.prepare).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    finish()
    await flush()
    typeInto(view!.q<HTMLTextAreaElement>('textarea')!, 'resume el contenido')
    await flush()
    expect(view!.q('[data-testid="office-overdrive-offer"]')).toBeNull()
  })
})
