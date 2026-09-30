import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import { ProviderKeyForm } from './ProviderKeyForm'

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
