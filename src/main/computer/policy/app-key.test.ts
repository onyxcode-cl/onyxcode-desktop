import { describe, expect, it } from 'vitest'
import { UNSIGNED_PUBLISHER, appKeyFor, aumidKey, exeBaseName, exeKey, normalizeExePath, parseAppKey } from './app-key'

describe('exeKey', () => {
  it('ruta en minúsculas + editor tal cual', () => {
    expect(exeKey('C:\\Program Files\\Google\\Chrome\\Application\\Chrome.EXE', 'Google LLC')).toEqual({
      ok: true,
      key: 'exe:c:\\program files\\google\\chrome\\application\\chrome.exe|pub:Google LLC'
    })
  })
  it.each([
    ['C:/Users/Ana/App Data/Tool.exe', 'c:\\users\\ana\\app data\\tool.exe'],
    ['c:\\\\Users\\\\Ana\\\\Tool.exe', 'c:\\users\\ana\\tool.exe'],
    ['\\\\?\\C:\\Windows\\System32\\Notepad.exe', 'c:\\windows\\system32\\notepad.exe'],
    ['  D:\\Ñandú\\Ápp.exe ', 'd:\\ñandú\\ápp.exe']
  ])('normaliza %s', (raw, expected) => {
    expect(normalizeExePath(raw)).toEqual({ ok: true, key: expected })
  })
  it('la misma ruta con otra capitalización da la misma clave; otro editor, otra clave', () => {
    const a = exeKey('C:\\Apps\\Foo.exe', 'Acme')
    const b = exeKey('c:\\APPS\\foo.EXE', 'Acme')
    const c = exeKey('c:\\apps\\foo.exe', 'Mallory')
    expect(a).toEqual(b)
    expect(a.ok && c.ok && a.key !== c.key).toBe(true)
  })
  it('sin editor: marcador de sin firma, distinto de cualquier editor real', () => {
    const r = exeKey('C:\\Apps\\Foo.exe', null)
    expect(r).toEqual({ ok: true, key: `exe:c:\\apps\\foo.exe|pub:${UNSIGNED_PUBLISHER}` })
  })
  it.each([
    ['PROGRA~1\\Foo\\a.exe', 'C:\\PROGRA~1\\Foo\\a.exe'],
    ['ARCHIV~2.EXE', 'C:\\Apps\\ARCHIV~2.EXE'],
    ['relativa', 'Apps\\foo.exe'],
    ['relativa con unidad', 'C:foo.exe'],
    ['UNC', '\\\\server\\share\\foo.exe'],
    ['punto-punto', 'C:\\Apps\\..\\Windows\\foo.exe'],
    ['pipe', 'C:\\Apps\\fo|o.exe'],
    ['flujo alterno', 'C:\\Apps\\foo.exe:evil'],
    ['vacía', '  '],
    ['solo unidad', 'C:\\'],
    ['espacio final', 'C:\\Apps \\foo.exe']
  ])('rechaza %s', (_n, path) => {
    expect(exeKey(path, 'X').ok).toBe(false)
  })
  it('la ruta corta 8.3 da un motivo claro; un nombre largo con ~ sin patrón 8.3 se admite', () => {
    const r = normalizeExePath('C:\\PROGRA~1\\x.exe')
    expect(!r.ok && r.reason).toMatch(/8\.3/)
    expect(normalizeExePath('C:\\Apps\\my~tool-long-name\\x.exe').ok).toBe(true)
  })
  it('editor con barra vertical o control se rechaza', () => {
    expect(exeKey('C:\\a.exe', 'A|pub:B').ok).toBe(false)
    expect(exeKey('C:\\a.exe', 'A\nB').ok).toBe(false)
  })
})

describe('aumidKey (UWP)', () => {
  it('Calculadora', () => {
    expect(aumidKey('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')).toEqual({
      ok: true,
      key: 'aumid:microsoft.windowscalculator_8wekyb3d8bbwe!app'
    })
  })
  it.each(['', 'a b', 'a!b!c', 'pkg!', '!x', 'x'.repeat(257), 'a|b', 'a\\b'])('rechaza «%s»', (v) => {
    expect(aumidKey(v).ok).toBe(false)
  })
})

describe('appKeyFor', () => {
  it('el AUMID manda sobre la ruta (ApplicationFrameHost sería común a todas las UWP)', () => {
    const r = appKeyFor({
      aumid: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
      exePath: 'C:\\Windows\\System32\\ApplicationFrameHost.exe'
    })
    expect(r.ok && r.key.startsWith('aumid:')).toBe(true)
  })
  it('sin nada se rechaza; con ruta usa exe', () => {
    expect(appKeyFor({}).ok).toBe(false)
    const r = appKeyFor({ exePath: 'C:\\Apps\\a.exe', publisher: 'P' })
    expect(r.ok && r.key).toBe('exe:c:\\apps\\a.exe|pub:P')
  })
  it('un AUMID inválido NO cae a la ruta (falla cerrado)', () => {
    expect(appKeyFor({ aumid: 'a b', exePath: 'C:\\Apps\\a.exe' }).ok).toBe(false)
  })
})

describe('parseAppKey / exeBaseName', () => {
  it('ida y vuelta', () => {
    const k = exeKey('C:\\Apps\\Foo\\Bar.exe', 'Acme Inc')
    if (!k.ok) throw new Error('x')
    expect(parseAppKey(k.key)).toEqual({ kind: 'exe', path: 'c:\\apps\\foo\\bar.exe', publisher: 'Acme Inc' })
    expect(exeBaseName(k.key)).toBe('bar.exe')
    const u = aumidKey('A.B_c!App')
    if (!u.ok) throw new Error('x')
    expect(parseAppKey(u.key)).toEqual({ kind: 'aumid', id: 'a.b_c!app' })
    expect(exeBaseName(u.key)).toBeNull()
  })
  it('claves mal formadas o no canónicas -> null', () => {
    for (const k of ['com.apple.finder', 'exe:c:\\a.exe', 'exe:C:\\A.exe|pub:X', 'exe:c:\\progra~1\\a.exe|pub:X', 'aumid:', 'aumid:A B'])
      expect(parseAppKey(k)).toBeNull()
  })
})
