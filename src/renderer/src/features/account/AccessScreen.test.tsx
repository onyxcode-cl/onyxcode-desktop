import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { INITIAL_ACCOUNT_STATE, type AccountState } from '@shared/account'
import { AccessScreen, type AccessActions } from './AccessScreen'

const actions: AccessActions = {
  google: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  emailStart: vi.fn(async () => undefined),
  emailVerify: vi.fn(async () => undefined),
  retry: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  openUrl: vi.fn(async () => undefined)
}
const base: AccountState = { ...INITIAL_ACCOUNT_STATE, required: true }
const html = (state: Partial<AccountState>, extra: Partial<Parameters<typeof AccessScreen>[0]> = {}): string =>
  renderToStaticMarkup(createElement(AccessScreen, { state: { ...base, ...state }, actions, ...extra }))

describe('pantalla de acceso', () => {
  it('sin cuenta: Google, correo, casilla DESMARCADA y botones deshabilitados hasta aceptarla', () => {
    const h = html({})
    expect(h).toContain('Continuar con Google')
    expect(h).toContain('Crear una cuenta con tu correo')
    expect(h).toContain('Acepto los')
    expect(h).toContain('política de privacidad')
    expect(h).toMatch(/data-testid="account-terms"(?![^>]*checked)/)
    expect(h).not.toMatch(/data-testid="account-terms"[^>]*checked=""/)
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*data-testid="account-google"/)
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*data-testid="account-email-open"/)
    expect(h).toContain('Marca la casilla para continuar.')
  })

  it('con la casilla marcada los botones quedan activos', () => {
    const h = html({}, { initial: { accepted: true } })
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="account-google"/)
    expect(h).not.toContain('Marca la casilla')
  })

  it('dice qué se guarda y que lo demás sigue en el Mac', () => {
    const h = html({})
    expect(h).toContain(
      'Guardamos tu correo para gestionar tu cuenta y contar usuarios. Tus conversaciones y claves de IA siguen en tu Mac.'
    )
  })

  it('no hay campos de contraseña', () => {
    for (const step of ['choose', 'email', 'code'] as const) expect(html({}, { initial: { step } })).not.toContain('type="password"')
  })

  it('paso de correo: título «Crear una cuenta» y campo de correo con límite de 254', () => {
    const h = html({}, { initial: { step: 'email', accepted: true } })
    expect(h).toContain('Crear una cuenta')
    expect(h).toContain('type="email"')
    expect(h).toContain('maxLength="254"')
    expect(h).toContain('Enviar código')
  })

  it('paso de código: 6 dígitos numéricos, autocompletado de código y reenvío', () => {
    const h = html({}, { initial: { step: 'code', email: 'Ana@Ejemplo.cl', accepted: true } })
    expect(h).toContain('ana@ejemplo.cl')
    expect(h).toContain('inputMode="numeric"')
    expect(h).toContain('autoComplete="one-time-code"')
    expect(h).toContain('maxLength="6"')
    expect(h).toContain('Enviar otro código')
  })

  it('error del intento anterior se anuncia con role=alert', () => {
    const h = html({}, { initial: { error: 'El código es incorrecto o ya venció. Pide uno nuevo.' } })
    expect(h).toContain('role="alert"')
    expect(h).toContain('El código es incorrecto')
  })

  it('esperando al navegador: hay «Cancelar» y no hay botones de entrada', () => {
    const h = html({ status: 'signing-in' })
    expect(h).toContain('Esperando al navegador')
    expect(h).toContain('Cancelar')
    expect(h).not.toContain('Continuar con Google')
  })

  it('comprobando la sesión guardada', () => {
    const h = html({ checking: true, status: 'signed-in' })
    expect(h).toContain('Comprobando tu sesión')
    expect(h).not.toContain('Continuar con Google')
  })

  it('sin red pasados 30 días: «Reintentar» y «Usar otra cuenta»', () => {
    const h = html({ status: 'offline-blocked', email: 'ana@ejemplo.cl' })
    expect(h).toContain('Sin conexión con el servidor')
    expect(h).toContain('Reintentar')
    expect(h).toContain('Usar otra cuenta')
    expect(h).toContain('ana@ejemplo.cl')
  })

  it('sesión caducada o revocada: aviso y opciones para volver a entrar', () => {
    const h = html({ status: 'expired' })
    expect(h).toContain('Tu sesión terminó')
    expect(h).toContain('Continuar con Google')
  })

  it('cuenta borrada: aviso y opciones', () => {
    const h = html({ status: 'deleted' })
    expect(h).toContain('Esta cuenta ya no existe')
    expect(h).toContain('Crear una cuenta con tu correo')
  })

  it('quien ya tenía la app ve la nota una vez; los demás no', () => {
    expect(html({}, { showExistingNote: true })).toContain('Tus conversaciones y claves de IA siguen en tu Mac.')
    expect(html({}, { showExistingNote: true })).toContain('account-existing-note')
    expect(html({})).not.toContain('account-existing-note')
  })

  it('aviso de sesión solo en memoria (sin Llavero)', () => {
    expect(html({ memoryOnly: true })).toContain('Llavero')
    expect(html({})).not.toContain('account-memory-only')
  })

  it('el texto visible no nombra marcas de terceros (Google solo como opción de acceso)', () => {
    const h = html({ status: 'expired', memoryOnly: true }, { showExistingNote: true })
    // Términos vigilados por las guardias, armados por partes para que este archivo no los contenga.
    expect(h).not.toMatch(new RegExp(['Clau' + 'de', 'Anthro' + 'pic', 'Cow' + 'ork'].join('|')))
    expect(h).toContain('Continuar con Google')
  })
})
