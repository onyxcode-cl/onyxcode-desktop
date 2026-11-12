// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '../../../../test/dom-render'
import { assistantMessage, makeSession, textPart, userMessage } from '../../../../test/fixtures/events'
import type { FilePartInput, Part } from '@opencode-ai/sdk/v2/client'
import type { OpencodeClient } from '../../lib/opencode'
import { clearDrafts, clearSessionDrafts, draftAttachmentBytes } from '../../stores/drafts'
import { useServer } from '../../stores/server'
import { useSessions, type MessageEntry } from '../../stores/sessions'
import { useChat } from './store'
import { useLang } from '../../lib/i18n'
import * as aiGate from '../../lib/ai-gate'
const h = vi.hoisted(() => ({ available: vi.fn(), prepare: vi.fn(), read: vi.fn() }))
vi.mock('../../lib/attachments', async (orig) => ({
  ...(await orig<typeof import('../../lib/attachments')>()),
  toChatAttachment: h.read
}))
vi.mock('./office-overdrive', async (orig) => ({
  ...(await orig<typeof import('./office-overdrive')>()),
  chatOfficeAvailable: h.available
}))
vi.mock('../tasks/impl/chat-office', () => ({ prepareOfficeTask: h.prepare }))
vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
import { sendChatMessage, userMessageContent } from './actions'
import { ChatMessageList } from './ChatMessageList'
import { chatSendFiles, sentOfficeAttachments } from './office-overdrive'

const SID = 'ses_office'
const REQUEST = 'cámbiame la fecha al 30 de noviembre'
// Sin «Overdrive», marca ni señal especial: la interfaz solo depende del adjunto de la persona.
const REPLY = 'No puedo editar el contrato original desde el Chat. Puedo darte el texto corregido.'
const URL = 'data:text/plain;base64,Y29udHJhdG8='
let view: Mounted | null = null
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  clearDrafts()
  useLang.setState({ lang: 'es' })
  h.available.mockReset().mockResolvedValue(true)
  h.prepare.mockReset().mockResolvedValue(undefined)
  h.read.mockReset().mockResolvedValue({ id: 'r', name: 'contrato.docx', mime: 'text/plain', url: URL, originalDocx: 'UEsDBA==' })
  vi.spyOn(aiGate, 'currentAiGate').mockReturnValue({
    effective: { providerID: 'opencode-go', modelID: 'claude-haiku-5-5' },
    gate: { blocked: false }
  } as never)
  useChat.getState().setActive(SID)
  useSessions.setState({ messages: {}, sessions: { [SID]: makeSession(SID, '/chat') } })
})
afterEach(() => {
  view?.unmount()
  view = null
  clearDrafts()
  vi.restoreAllMocks()
  delete (window as unknown as { api?: unknown }).api
})

async function sent(ext = 'docx', original = 'originalDocx', response = REPLY): Promise<{ user: MessageEntry; assistant: MessageEntry }> {
  const promptAsync = vi.fn(async (body: { parts: FilePartInput[] }) => ({ data: undefined, body }))
  useServer.setState({
    client: { session: { promptAsync } } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://fake', authorization: 'test', chatDirectory: '/chat' } as never
  })
  expect(
    await sendChatMessage(
      REQUEST,
      chatSendFiles([{ id: 'attached', mime: 'text/plain', name: `contrato.${ext}`, url: URL, [original]: 'UEsDBA==' }])
    )
  ).toBe(true)
  const body = promptAsync.mock.calls[0][0]
  // Emula las partes que devuelve el motor: el original NO forma parte del mensaje de la IA.
  expect(JSON.stringify(body)).not.toContain('UEsDBA==')
  const user: MessageEntry = {
    info: userMessage('msg_user', SID),
    parts: body.parts.map((p, i) => ({ ...p, id: p.id ?? `prt_${i}`, sessionID: SID, messageID: 'msg_user' }) as Part)
  }
  user.parts.push(textPart('prt_extracted', user.info.id, SID, 'Texto extraído del contrato', { synthetic: true }))
  const assistant: MessageEntry = {
    info: assistantMessage('msg_reply', SID, { parentID: user.info.id, modelID: 'claude-haiku-5-5' }),
    parts: [textPart('prt_reply', 'msg_reply', SID, response)]
  }
  return { user, assistant }
}

describe('acción Office junto a la respuesta del turno enviado', () => {
  it.each(['darwin', 'win32'])(
    'regresión manual exacta en %s: contrato.docx + respuesta sin marca → botón y borrador',
    async (platform) => {
      Object.assign(window, { api: { platform } })
      const { user, assistant } = await sent()
      // Ya no hay adjuntos en el compositor: solo las partes del historial y el original local del envío.
      view = mount(<ChatMessageList entries={[user, assistant]} busy={false} />)
      await flush()
      const row = view.q('[data-message-id="msg_reply"]')!
      expect(row.textContent).toContain(REPLY)
      const button = row.querySelector('[data-testid="sent-office-overdrive-yes"]')!
      expect(button.textContent).toBe('Hacer esto en Overdrive')
      expect(view.q('[data-message-id="msg_user"] [data-testid="sent-office-overdrive-yes"]')).toBeNull()
      click(button)
      click(button)
      await flush()
      expect(h.prepare).toHaveBeenCalledExactlyOnceWith(REQUEST, [{ name: 'contrato.docx', base64: 'UEsDBA==' }])
      expect(userMessageContent(user).files[0].originalDocx).toBe('UEsDBA==') // editar/reintentar conserva el original
      expect(sentOfficeAttachments(user)).toHaveLength(1)
      // Desmontar/cambiar de conversación no lo pierde ni lo atribuye al turno siguiente sin adjunto.
      view.unmount()
      const nextUser = { info: userMessage('msg_user2', SID), parts: [textPart('prt_u2', 'msg_user2', SID, 'gracias')] }
      const nextAssistant = { info: assistantMessage('msg_reply2', SID), parts: [textPart('prt_a2', 'msg_reply2', SID, 'de nada')] }
      view = mount(<ChatMessageList entries={[user, assistant, nextUser, nextAssistant]} busy={false} />)
      await flush()
      expect(view.qa('[data-testid="sent-office-overdrive-yes"]')).toHaveLength(1)
      expect(view.q('[data-message-id="msg_reply2"] [data-testid="sent-office-overdrive-yes"]')).toBeNull()
    }
  )
  it.each([
    ['xlsx', 'originalXlsx'],
    ['pptx', 'originalPptx']
  ])('%s también aparece aunque la respuesta solo diga «Listo»', async (ext, key) => {
    const { user, assistant } = await sent(ext, key, 'Listo')
    view = mount(<ChatMessageList entries={[user, assistant]} busy={false} />)
    await flush()
    expect(view.q('[data-testid="sent-office-overdrive-yes"]')).not.toBeNull()
    click(view.q('[data-testid="sent-office-overdrive-yes"]'))
    await flush()
    expect(h.prepare).toHaveBeenCalledWith(REQUEST, [{ name: `contrato.${ext}`, base64: 'UEsDBA==' }])
  })
  it('se ofrece con un pedido de lectura, sin detectar intención ni buscar texto en la respuesta', async () => {
    const { user, assistant } = await sent()
    user.parts = [textPart('prt_read', user.info.id, SID, 'resume el contenido'), ...user.parts.filter((p) => p.type === 'file')]
    view = mount(<ChatMessageList entries={[user, assistant]} busy={false} />)
    await flush()
    expect(view.q('[data-testid="sent-office-overdrive-yes"]')).not.toBeNull()
  })
  it('durante la respuesta no permite preparar; al terminar mantiene la oferta y su traducción al inglés', async () => {
    const { user, assistant } = await sent()
    useLang.setState({ lang: 'en' })
    view = mount(<ChatMessageList entries={[user, assistant]} busy />)
    await flush()
    expect(view.q<HTMLButtonElement>('[data-testid="sent-office-overdrive-yes"]')?.disabled).toBe(true)
    view.rerender(<ChatMessageList entries={[user, assistant]} busy={false} />)
    await flush()
    expect(view.q<HTMLButtonElement>('[data-testid="sent-office-overdrive-yes"]')?.disabled).toBe(false)
    expect(view.q('[data-testid="sent-office-overdrive-yes"]')?.textContent).toBe('Do this in Overdrive')
  })
  it.each(['rejected', 'offline'])('un envío %s libera los originales de ese intento', async (mode) => {
    const promptAsync = vi.fn(async () => {
      if (mode === 'offline') throw new Error('offline')
      return { error: 'rejected' }
    })
    useServer.setState({
      client: { session: { promptAsync } } as unknown as OpencodeClient,
      connection: { baseUrl: 'http://fake', authorization: 'test', chatDirectory: '/chat' } as never
    })
    const result = sendChatMessage(REQUEST, [{ mime: 'text/plain', filename: 'contrato.docx', url: URL, originalDocx: 'UEsDBA==' }])
    if (mode === 'offline') await expect(result).rejects.toThrow('offline')
    else expect(await result).toBe(false)
    expect(draftAttachmentBytes()).toBe(0)
    expect(useSessions.getState().status[SID]).toBe('idle')
  })
  it('disponibilidad apagada: no ofrece; un fallo al preparar conserva pedido y original para reintentar', async () => {
    const { user, assistant } = await sent()
    h.available.mockResolvedValueOnce(false)
    view = mount(<ChatMessageList entries={[user, assistant]} busy={false} />)
    await flush()
    expect(view.q('[data-testid="sent-office-overdrive-yes"]')).toBeNull()
    view.unmount()
    view = mount(<ChatMessageList entries={[user, assistant]} busy={false} />)
    await flush()
    h.prepare.mockRejectedValueOnce(new Error('copia fallida'))
    click(view.q('[data-testid="sent-office-overdrive-yes"]'))
    await flush()
    expect(view.q('[role="alert"]')?.textContent).toBe('copia fallida')
    click(view.q('[data-testid="sent-office-overdrive-yes"]'))
    await flush()
    expect(h.prepare).toHaveBeenCalledTimes(2)
    expect(sentOfficeAttachments(user)).toHaveLength(1)
  })
  it('sin original local ofrece el botón y pide seleccionar el archivo; nunca hereda otro con el mismo nombre', async () => {
    const { user, assistant } = await sent()
    const changed = { ...user, parts: user.parts.map((p) => (p.type === 'file' ? { ...p, id: 'prt_other' } : p)) }
    view = mount(<ChatMessageList entries={[changed, assistant]} busy={false} />)
    await flush()
    expect(view.q('[data-testid="sent-office-overdrive-yes"]')).not.toBeNull()
    expect(view.host.textContent).toContain('Selecciona de nuevo los originales')
    const input = view.q<HTMLInputElement>('[data-testid="sent-office-original-input"]')!
    const pick = vi.spyOn(input, 'click').mockImplementation(() => undefined)
    click(view.q('[data-testid="sent-office-overdrive-yes"]'))
    await flush()
    expect(pick).toHaveBeenCalledOnce()
    expect(h.prepare).not.toHaveBeenCalled()
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['zip'], 'equivocado.docx')] })
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(h.prepare).not.toHaveBeenCalled()
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['zip'], 'contrato.docx')] })
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(h.prepare).toHaveBeenCalledExactlyOnceWith(REQUEST, [{ name: 'contrato.docx', base64: 'UEsDBA==' }])
    clearSessionDrafts(SID)
    expect(sentOfficeAttachments(user)).toEqual([])
  })
  it('sin adjunto Office no ofrece aunque el asistente mencione Overdrive', async () => {
    const { user, assistant } = await sent()
    user.parts = user.parts.filter((p) => p.type !== 'file')
    assistant.parts = [textPart('prt_reply', 'msg_reply', SID, 'Hazlo en Overdrive')]
    view = mount(<ChatMessageList entries={[user, assistant]} busy={false} />)
    await flush()
    expect(view.q('[data-testid="sent-office-overdrive-yes"]')).toBeNull()
  })
  it('un lote mixto ofrece los Office indicados, conserva los demás adjuntos y agrupa una sola oferta por turno', async () => {
    const { user, assistant } = await sent()
    user.parts.push({
      type: 'file',
      id: 'prt_pdf',
      sessionID: SID,
      messageID: user.info.id,
      filename: 'nota.pdf',
      mime: 'application/pdf',
      url: 'data:application/pdf;base64,JVBERg=='
    })
    const final = { info: assistantMessage('msg_reply2', SID), parts: [textPart('prt_a2', 'msg_reply2', SID, 'Respuesta final')] }
    view = mount(<ChatMessageList entries={[user, assistant, final]} busy={false} />)
    await flush()
    expect(view.qa('[data-testid="sent-office-overdrive-yes"]')).toHaveLength(1)
    click(view.q('[data-testid="sent-office-overdrive-yes"]'))
    await flush()
    expect(h.prepare).toHaveBeenCalledWith(REQUEST, [{ name: 'contrato.docx', base64: 'UEsDBA==' }])
    expect(userMessageContent(user).files).toHaveLength(2)
  })
})
