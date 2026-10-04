/** Compositor de Chat en el celular (superficie `remote`) frente a escritorio. Render estático con la plataforma simulada. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatComposer } from './ChatComposer'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const html = (): string =>
  renderToStaticMarkup(
    <ChatComposer onSend={() => undefined} busy={false} showAttach footer={<span data-testid="pie">modelo</span>} autoFocusKey="s1" />
  )

describe('ChatComposer', () => {
  it('celular: píldora de 24 px, botones de 36 px, sin tope fijo de 280 px y pie en una segunda fila', () => {
    surface('remote')
    const h = html()
    expect(h).toContain('rounded-[24px]')
    expect(h).toContain('h-9 w-9')
    expect(h).not.toContain('max-h-[280px]')
    expect(h).not.toContain('focus-within:shadow')
    expect(h).toContain('border-t border-border')
    expect(h).toContain('data-testid="pie"')
  })
  it('escritorio: mismo marcado de siempre', () => {
    surface('darwin')
    const h = html()
    expect(h).toContain('rounded-[20px]')
    expect(h).toContain('max-h-[280px]')
    expect(h).toContain('h-8 w-8')
    expect(h).not.toContain('h-9 w-9')
    expect(h).not.toContain('rounded-[24px]')
    expect(h).not.toContain('border-t border-border')
  })
})
