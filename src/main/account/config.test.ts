import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAllowedAccountBase, isSafeBrowserUrl } from '@shared/account-url'
import { resolveAccountConfig } from './config'
import { isAccountAllowed, setAccountAccessCheck } from './access'

describe('resolveAccountConfig', () => {
  it('ACCOUNT_API nulo y sin variable: apagada (no se exige login)', () => {
    expect(resolveAccountConfig({ isPackaged: false, env: {}, api: null })).toEqual({
      enabled: false,
      baseUrl: null,
      allowLocalHttp: false
    })
    expect(resolveAccountConfig({ isPackaged: true, env: {}, api: null }).enabled).toBe(false)
  })

  it('empaquetada: ignora ONYXCODE_ACCOUNT_URL (no se puede encender ni redirigir con una variable)', () => {
    const env = { ONYXCODE_ACCOUNT_URL: 'http://127.0.0.1:9' }
    expect(resolveAccountConfig({ isPackaged: true, env, api: null }).enabled).toBe(false)
    expect(resolveAccountConfig({ isPackaged: true, env, api: 'https://cuentas.ejemplo.cl' })).toEqual({
      enabled: true,
      baseUrl: 'https://cuentas.ejemplo.cl',
      allowLocalHttp: false
    })
  })

  it('sin empaquetar: respeta la variable (http solo a 127.0.0.1)', () => {
    const c = resolveAccountConfig({ isPackaged: false, env: { ONYXCODE_ACCOUNT_URL: 'http://127.0.0.1:4321/' }, api: null })
    expect(c).toEqual({ enabled: true, baseUrl: 'http://127.0.0.1:4321', allowLocalHttp: true })
  })

  it('dirección inválida con cuenta activa: falla cerrado (activa, sin servidor)', () => {
    for (const api of ['http://cuentas.ejemplo.cl', 'cuentas', 'https://u:p@x.cl', 'https://x.cl/ruta', 'http://127.0.0.1:1']) {
      expect(resolveAccountConfig({ isPackaged: true, env: {}, api })).toEqual({ enabled: true, baseUrl: null, allowLocalHttp: false })
    }
  })

  it('variable vacía se ignora', () => {
    expect(resolveAccountConfig({ isPackaged: false, env: { ONYXCODE_ACCOUNT_URL: '' }, api: null }).enabled).toBe(false)
  })
})

describe('ONYXCODE_ACCOUNT_DISABLED (solo pruebas)', () => {
  const API = 'https://cuentas.ejemplo.cl'
  const off = { enabled: false, baseUrl: null, allowLocalHttp: false }
  it('empaquetada: se ignora siempre (la cuenta sigue activa con ACCOUNT_API)', () => {
    const env = { ONYXCODE_ACCOUNT_DISABLED: '1' }
    expect(resolveAccountConfig({ isPackaged: true, env, api: API })).toEqual({ enabled: true, baseUrl: API, allowLocalHttp: false })
    const both = { ONYXCODE_ACCOUNT_DISABLED: '1', ONYXCODE_ACCOUNT_URL: 'http://127.0.0.1:9' }
    expect(resolveAccountConfig({ isPackaged: true, env: both, api: API })).toEqual({ enabled: true, baseUrl: API, allowLocalHttp: false })
  })
  it('sin empaquetar: =1 apaga la cuenta aunque ACCOUNT_API esté definido', () => {
    expect(resolveAccountConfig({ isPackaged: false, env: { ONYXCODE_ACCOUNT_DISABLED: '1' }, api: API })).toEqual(off)
  })
  it('sin empaquetar: otros valores no apagan', () => {
    for (const v of ['0', 'true', '', ' 1'])
      expect(resolveAccountConfig({ isPackaged: false, env: { ONYXCODE_ACCOUNT_DISABLED: v }, api: API }).enabled).toBe(true)
  })
  it('precedencia: ONYXCODE_ACCOUNT_URL gana sobre DISABLED (los specs de cuenta usan su servidor falso)', () => {
    const env = { ONYXCODE_ACCOUNT_DISABLED: '1', ONYXCODE_ACCOUNT_URL: 'http://127.0.0.1:4321' }
    expect(resolveAccountConfig({ isPackaged: false, env, api: API })).toEqual({
      enabled: true,
      baseUrl: 'http://127.0.0.1:4321',
      allowLocalHttp: true
    })
  })
  it('guardia estática: solo config.ts la lee y lo hace bajo !isPackaged', () => {
    const root = resolve(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const f = join(d, n)
        if (statSync(f).isDirectory()) walk(f)
        else if (/\.(ts|tsx)$/.test(n) && !n.endsWith('.test.ts') && readFileSync(f, 'utf8').includes('ONYXCODE_ACCOUNT_DISABLED'))
          hits.push(f)
      }
    }
    walk(root)
    expect(hits.map((h) => h.slice(root.length).replace(/\\/g, '/'))).toEqual(['/main/account/config.ts'])
    expect(readFileSync(hits[0], 'utf8')).toMatch(/const disabled = !i\.isPackaged && i\.env\.ONYXCODE_ACCOUNT_DISABLED === '1'/)
  })
})

describe('isAllowedAccountBase / isSafeBrowserUrl', () => {
  it('base', () => {
    expect(isAllowedAccountBase('https://a.example.com/', false)).toBe('https://a.example.com')
    expect(isAllowedAccountBase('http://127.0.0.1:80', false)).toBeNull()
    expect(isAllowedAccountBase('http://127.0.0.1:80', true)).toBe('http://127.0.0.1:80')
    expect(isAllowedAccountBase('http://localhost:80', true)).toBeNull()
    expect(isAllowedAccountBase('https://a.example.com?x=1', false)).toBeNull()
  })
  it('url del navegador', () => {
    expect(isSafeBrowserUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1', false)).toBe(true)
    expect(isSafeBrowserUrl('http://accounts.google.com/', false)).toBe(false)
    expect(isSafeBrowserUrl('javascript:alert(1)', true)).toBe(false)
    expect(isSafeBrowserUrl('file:///etc/passwd', true)).toBe(false)
    expect(isSafeBrowserUrl('http://127.0.0.1:5/x', false)).toBe(false)
    expect(isSafeBrowserUrl('http://127.0.0.1:5/x', true)).toBe(true)
    expect(isSafeBrowserUrl('https://u:p@a.com/', false)).toBe(false)
    expect(isSafeBrowserUrl(42, false)).toBe(false)
    expect(isSafeBrowserUrl('', false)).toBe(false)
  })
})

describe('access', () => {
  it('por defecto permite todo; con comprobación, la sigue; si falla, cierra', () => {
    expect(isAccountAllowed()).toBe(true)
    setAccountAccessCheck(() => false)
    expect(isAccountAllowed()).toBe(false)
    setAccountAccessCheck(() => {
      throw new Error('x')
    })
    expect(isAccountAllowed()).toBe(false)
    setAccountAccessCheck(null)
    expect(isAccountAllowed()).toBe(true)
  })
})
