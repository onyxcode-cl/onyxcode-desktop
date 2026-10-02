import { describe, expect, it } from 'vitest'
import { checkUrl, hostPortOf, localSubresourceAllowed, schemeOf, siteOf, subframeUrlAllowed } from './sites'

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

describe('hostPortOf', () => {
  it('formato de localOrigins, con puerto por defecto explícito', () => {
    expect(hostPortOf('http://127.0.0.1:4173/a.css')).toBe('127.0.0.1:4173')
    expect(hostPortOf('http://LocalHost:5173/')).toBe('localhost:5173')
    expect(hostPortOf('http://[::1]:8080/')).toBe('[::1]:8080')
    expect(hostPortOf('http://localhost/')).toBe('localhost:80')
    expect(hostPortOf('https://localhost/')).toBe('localhost:443')
    expect(hostPortOf('ws://127.0.0.1:5173/@vite')).toBe('127.0.0.1:5173')
  })
  it('esquemas que no son de red o basura: null', () => {
    expect(hostPortOf('about:blank')).toBeNull()
    expect(hostPortOf('file:///etc/hosts')).toBeNull()
    expect(hostPortOf('???')).toBeNull()
  })
})

describe('localSubresourceAllowed', () => {
  const none = (): boolean => false
  const always = (o: string): boolean => o === 'localhost:5173'
  it('mismo origen que la página: sí, aunque nada esté aprobado (CSS/JS/imágenes del sitio local)', () => {
    expect(localSubresourceAllowed('http://127.0.0.1:4173/estilo.css', '127.0.0.1:4173', none)).toBe(true)
    expect(localSubresourceAllowed('ws://localhost:5173/@vite', 'localhost:5173', none)).toBe(true)
  })
  it('otro puerto local: no, salvo que el origen de la página esté en «Permitir siempre»', () => {
    expect(localSubresourceAllowed('http://127.0.0.1:3000/api', '127.0.0.1:4173', none)).toBe(false)
    expect(localSubresourceAllowed('http://127.0.0.1:3000/api', 'localhost:5173', always)).toBe(true)
    expect(localSubresourceAllowed('http://127.0.0.1:3000/api', '127.0.0.1:4173', always)).toBe(false)
  })
  it('mismo puerto pero otro nombre de host (127.0.0.1 vs localhost) cuenta como otro origen', () => {
    expect(localSubresourceAllowed('http://127.0.0.1:4173/x.css', 'localhost:4173', none)).toBe(false)
  })
  it('sin página (service worker, webContents destruido): no', () => {
    expect(localSubresourceAllowed('http://127.0.0.1:4173/x.css', null, always)).toBe(false)
  })
})
