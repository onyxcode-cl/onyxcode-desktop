import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { INITIAL_ACCOUNT_STATE, type AccountState } from '@shared/account'
import { accountStatusLabel, AccountSectionView } from './AccountSection'

const state: AccountState = { ...INITIAL_ACCOUNT_STATE, required: true, status: 'signed-in', email: 'ana@ejemplo.cl', provider: 'google' }
const html = (s: Partial<AccountState> = {}, o: Partial<Parameters<typeof AccountSectionView>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(AccountSectionView, {
      state: { ...state, ...s },
      busy: null,
      notice: null,
      error: null,
      onSignOut: vi.fn(),
      onExport: vi.fn(),
      onDelete: vi.fn(),
      ...o
    })
  )

describe('Ajustes › Cuenta', () => {
  it('muestra correo, proveedor y las tres acciones', () => {
    const h = html()
    expect(h).toContain('ana@ejemplo.cl')
    expect(h).toContain('Google')
    expect(h).toContain('Cerrar sesión')
    expect(h).toContain('Descargar mis datos')
    expect(h).toContain('Borrar mi cuenta')
    expect(h).toContain('Sesión iniciada')
  })

  it('proveedor correo', () => {
    expect(html({ provider: 'email' })).toContain('Correo con código')
  })

  it('aclara que borrar la cuenta no toca las claves de IA', () => {
    expect(html()).toContain('No toca las claves de IA ni las conversaciones de este Mac')
  })

  it('ocupado: todos los botones quedan deshabilitados', () => {
    const h = html({}, { busy: 'export' })
    expect(h.match(/disabled=""/g)?.length).toBe(3)
  })

  it('error y aviso', () => {
    expect(html({}, { error: 'No se pudo borrar la cuenta.' })).toContain('No se pudo borrar la cuenta.')
    expect(html({}, { notice: 'Tus datos se guardaron' })).toContain('role="status"')
  })

  it('en gracia avisa de hasta cuándo funciona sin conexión', () => {
    const l = accountStatusLabel({ status: 'grace', graceEndsAt: Date.UTC(2026, 10, 15, 12) })
    expect(l.tone).toBe('warn')
    expect(l.text).toContain('Sin conexión con el servidor')
    expect(l.text).toMatch(/15 de noviembre de 2026/)
  })

  it('sin sesión', () => {
    expect(accountStatusLabel({ status: 'signed-out', graceEndsAt: null })).toEqual({ tone: 'error', text: 'Sin sesión' })
  })
})
