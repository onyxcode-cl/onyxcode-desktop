import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessageList } from './ChatMessageList'
import { allEntries, assistantFull, userWithFile } from '../../../../test/fixtures/entries'
import { stripDesk } from '../../../../test/strip-desk'

describe('ChatMessageList (render estático)', () => {
  it('conversación completa: usuario con archivo, reasoning, tools, error y abortado', () => {
    expect(stripDesk(renderToStaticMarkup(<ChatMessageList entries={allEntries} busy={false} />))).toMatchSnapshot()
  })
  it('ocupado con la última respuesta en curso', () => {
    expect(stripDesk(renderToStaticMarkup(<ChatMessageList entries={[userWithFile, assistantFull]} busy={true} />))).toMatchSnapshot()
  })
  it('con error de sesión y botón de reintentar', () => {
    const html = renderToStaticMarkup(
      <ChatMessageList entries={[userWithFile, assistantFull]} busy={false} error="Falló la conexión" onRetry={() => undefined} />
    )
    expect(html).toContain('Falló la conexión')
    expect(stripDesk(html)).toMatchSnapshot()
  })
})
