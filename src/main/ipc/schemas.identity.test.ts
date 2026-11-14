import { expect, it } from 'vitest'
import { isDocumentIdentity, type DocumentIdentity } from '@shared/chat-doc-spec'
import { IPC_SCHEMAS } from './schemas'

const identity: DocumentIdentity = {
  concept: 'Fauna',
  palette: { bg: '#FFFFFF', text: '#101010', accent: '#287456', panel: '#EEEEEE' },
  fonts: { title: 'Arial Black', body: 'Verdana' },
  titles: 'editorial',
  cards: 'rounded',
  background: 'split',
  rhythm: 'dynamic',
  photos: 'wide',
  cover: 'band',
  headers: 'accent'
}

it('acepta la forma de identidad del aviso de Mac sin exigir campos opcionales nuevos', () => {
  const req = {
    kind: 'pptx',
    title: 'Ejemplo',
    sessionId: 'test-session',
    lang: 'es',
    theme: 'light',
    data: {
      slides: [{ title: 'Ejemplo' }],
      identity: {
        concept: 'Ejemplo de prueba',
        palette: { bg: '#FFFFFF', text: '#1F2A24', accent: '#2E7D4F', muted: '#5B6B62', panel: '#EAF4EE' },
        fonts: { title: 'Georgia', body: 'Arial' },
        titles: 'editorial',
        cards: 'rounded',
        background: 'panel',
        rhythm: 'balanced'
      }
    }
  }
  expect(IPC_SCHEMAS['extras:chatDoc:open']!(req)).toEqual(req)
})

it.each(['pptx', 'docx'] as const)('%s conserva la identidad visual al abrir, descargar y abrir fuera', (kind) => {
  const data = kind === 'pptx' ? { slides: [{ title: 'Fauna' }], identity } : { blocks: [{ type: 'paragraph', text: 'Fauna' }], identity }
  expect(isDocumentIdentity(identity)).toBe(true)
  for (const channel of ['extras:chatDoc:open', 'extras:chatDoc:openExternal', 'extras:downloadChatDoc']) {
    const req = {
      kind,
      title: 'Fauna',
      data,
      ...(channel === 'extras:chatDoc:open' ? { sessionId: 's1', lang: 'es', theme: 'light' } : {})
    }
    expect(IPC_SCHEMAS[channel]!(req)).toEqual(req)
    for (const invalid of [
      { ...identity, command: 'run' },
      { ...identity, fonts: { title: 'Arial', path: '/font' } },
      { ...identity, palette: { ...identity.palette, url: 'https://example.test' } },
      { ...identity, concept: ' ' },
      { ...identity, concept: 'x'.repeat(501) },
      { ...identity, titles: 'invalid' }
    ]) {
      expect(isDocumentIdentity(invalid)).toBe(false)
      expect(() => IPC_SCHEMAS[channel]!({ ...req, data: { ...data, identity: invalid } })).toThrow(/data.identity/)
    }
  }
})
