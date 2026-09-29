import { describe, expect, it } from 'vitest'
import { checkUrl, schemeOf, siteOf, subframeUrlAllowed } from './sites'

describe('schemeOf', () => {
  it('devuelve el esquema en minúsculas y con los dos puntos', () => {
    expect(schemeOf('mailto:alguien@ejemplo.com')).toBe('mailto:')
    expect(schemeOf('TEL:+56912345678')).toBe('tel:')
    expect(schemeOf('https://ejemplo.com/a')).toBe('https:')
    expect(schemeOf('  javascript:alert(1)')).toBe('javascript:')
  })
  it('sin esquema devuelve null', () => {
    expect(schemeOf('ejemplo.com')).toBeNull()
    expect(schemeOf('')).toBeNull()
    expect(schemeOf('/ruta:con-dos-puntos')).toBeNull()
  })
})

describe('subframeUrlAllowed', () => {
  it.each(['http://a.com', 'https://a.com/x', 'about:blank', 'about:srcdoc', 'data:text/html,hola', 'blob:https://a.com/uuid'])(
    'permite %s',
    (u) => expect(subframeUrlAllowed(u)).toBe(true)
  )
  it.each(['mailto:a@b.com', 'tel:+123', 'file:///etc/hosts', 'chrome://settings', 'javascript:alert(1)', 'sms:1', 'ejemplo.com', ''])(
    'bloquea %s',
    (u) => expect(subframeUrlAllowed(u)).toBe(false)
  )
})

describe('checkUrl (primer nivel)', () => {
  it('solo http(s) y about:blank', () => {
    expect(checkUrl('https://a.com')).toBe(true)
    expect(checkUrl('about:blank')).toBe(true)
    expect(checkUrl('mailto:a@b.com')).toBe(false)
    expect(checkUrl('tel:+123')).toBe(false)
    expect(checkUrl('data:text/html,x')).toBe(false)
  })
})

describe('siteOf', () => {
  it('agrupa por eTLD+1 heurístico', () => {
    expect(siteOf('www.bbc.co.uk')).toBe('bbc.co.uk')
    expect(siteOf('mail.google.com')).toBe('google.com')
    expect(siteOf('ejemplo.com')).toBe('ejemplo.com')
    expect(siteOf('localhost')).toBe('localhost')
  })
  it('una IP literal es su propio sitio (no comparte los dos últimos octetos)', () => {
    expect(siteOf('93.184.216.34')).toBe('93.184.216.34')
    expect(siteOf('1.2.216.34')).toBe('1.2.216.34')
    expect(siteOf('93.184.216.34')).not.toBe(siteOf('1.2.216.34'))
    expect(siteOf('127.0.0.1')).toBe('127.0.0.1')
  })
  it('IPv6 se devuelve tal cual (con o sin corchetes)', () => {
    expect(siteOf('[::1]')).toBe('[::1]')
    expect(siteOf('::1')).toBe('::1')
    expect(siteOf('[2001:db8::1]')).toBe('[2001:db8::1]')
  })
})
