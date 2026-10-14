import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import { OauthAutoPanel, OauthFailure, parseDeviceCode, ProviderKeyForm, sanitizeAuthMessage } from './ProviderKeyForm'

const providers = [{ id: 'p1', name: 'Proveedor Uno', env: [] as string[] }]
const auth: Record<string, ProviderAuthMethod[]> = {
  p1: [
    { type: 'oauth', label: 'Cuenta de prueba' },
    { type: 'api', label: 'API key' }
  ]
}
const noop = async (): Promise<void> => undefined
const render = (props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(ProviderKeyForm, { providers, auth, busy: false, onSetKey: noop, ...props }))

describe('ProviderKeyForm', () => {
  it('envuelve la clave en un <form> con «Guardar» de tipo submit', () => {
    const html = render({ fixedProviderId: 'p1' })
    expect(html).toContain('<form')
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>.*Guardar/)
  })

  it('muestra un botón por método OAuth con la etiqueta recibida', () => {
    const html = render({
      fixedProviderId: 'p1',
      onOauthStart: async () => ({ url: 'http://x', method: 'auto', instructions: '' }),
      onOauthFinish: noop
    })
    expect(html).toContain('Iniciar sesión · Cuenta de prueba')
  })

  it('sin callbacks OAuth no ofrece inicio de sesión', () => {
    expect(render({ fixedProviderId: 'p1' })).not.toContain('Iniciar sesión')
  })

  it('title={null} oculta el encabezado y el predeterminado lo muestra', () => {
    expect(render({ fixedProviderId: 'p1', title: null })).not.toContain('Clave de Proveedor Uno')
    expect(render({ fixedProviderId: 'p1' })).toContain('Clave de Proveedor Uno')
  })
})

describe('login automático (ChatGPT sin navegador)', () => {
  const noopFn = (): void => undefined
  it('muestra el código del motor, el texto guía, «Copiar código» y la espera', () => {
    const html = renderToStaticMarkup(
      createElement(OauthAutoPanel, { instructions: 'Enter code: ABCD-12345', onCancel: noopFn, onOtherMethod: noopFn })
    )
    expect(html).toContain('ABCD-12345')
    expect(html).toContain('Escribe este código en la página que se abrió')
    expect(html).toContain('Copiar código')
    expect(html).toContain('Esperando que termines el login en el navegador')
    expect(html).toContain('Probar otro método')
  })
  it('sin instrucciones solo muestra la espera y sin otro método no lo ofrece', () => {
    const html = renderToStaticMarkup(createElement(OauthAutoPanel, { instructions: '', onCancel: noopFn }))
    expect(html).not.toContain('Copiar código')
    expect(html).not.toContain('Probar otro método')
    expect(html).toContain('Cancelar')
  })
  it('el fallo muestra el motivo, «Reintentar» y la sugerencia del método con código', () => {
    const html = renderToStaticMarkup(createElement(OauthFailure, { reason: 'Caducó', onRetry: noopFn }))
    expect(html).toContain('Caducó')
    expect(html).toContain('Reintentar')
    expect(html).toContain('prueba el método sin navegador (con código)')
  })
  it('extrae el código y depura lo que no debe anotarse', () => {
    expect(parseDeviceCode('Enter code: ABCD-12345')).toBe('ABCD-12345')
    expect(parseDeviceCode('nada')).toBeNull()
    const clean = sanitizeAuthMessage(
      'callback http://localhost:1455/auth/callback?code=SECRETCODE123&state=abc Bearer sk-abcdefghijklmnopqrstuvwxyz0123'
    )
    expect(clean).not.toContain('SECRETCODE123')
    expect(clean).not.toContain('sk-abcdefghijkl')
  })
})
