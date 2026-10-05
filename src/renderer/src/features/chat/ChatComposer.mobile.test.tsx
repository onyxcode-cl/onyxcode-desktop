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

const html = (hero = false): string =>
  renderToStaticMarkup(
    <ChatComposer
      onSend={() => undefined}
      busy={false}
      showAttach
      hero={hero}
      footer={<span data-testid="pie">modelo</span>}
      autoFocusKey="s1"
    />
  )

describe('ChatComposer', () => {
  // Rediseño PWA T2: anclado radio 16 y mínimo 52; Inicio (hero) radio 20 con sombra md y el modelo en la fila de los botones.
  it('celular anclado: radio 16, mínimo 52, botones de 40, sin tope fijo de 280 px y pie en una segunda fila', () => {
    surface('remote')
    const h = html()
    expect(h).toContain('rounded-2xl')
    expect(h).toContain('min-h-[52px]')
    expect(h).toContain('h-10 w-10')
    expect(h).not.toContain('rounded-[24px]')
    expect(h).not.toContain('max-h-[280px]')
    expect(h).not.toContain('focus-within:shadow')
    expect(h).toContain('border-t border-border')
    expect(h).toContain('data-testid="pie"')
  })
  it('celular en Inicio: radio 20 con shadow-md, adjuntar de 36, enviar de 40 y el modelo en la misma fila (sin segunda fila)', () => {
    surface('remote')
    const h = html(true)
    expect(h).toContain('rounded-[20px]')
    expect(h).toContain('shadow-md')
    expect(h).toContain('h-9 w-9')
    expect(h).toContain('h-10 w-10')
    expect(h).toContain('data-m="composer-model"')
    expect(h).not.toContain('border-t border-border')
    expect(h).toContain('data-testid="pie"')
  })
  it('escritorio: mismo marcado de siempre', () => {
    surface('darwin')
    const h = html()
    expect(h).toContain('rounded-[20px]')
    expect(h).toContain('max-h-[280px]')
    expect(h).toContain('h-8 w-8')
    expect(h).not.toContain('h-9 w-9')
    expect(h).not.toContain('h-10 w-10')
    expect(h).not.toContain('data-m=')
    expect(h).not.toContain('rounded-[24px]')
    expect(h).not.toContain('border-t border-border')
  })
})
