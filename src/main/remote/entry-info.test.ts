import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseHostFrame } from '@shared/remote/protocol'
import { loadEntryInfo, sriOf } from './entry-info'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

function fs(files: Record<string, string>): (f: string) => Uint8Array {
  return (f) => {
    // `join` en Windows devuelve `\\app\\assets\\x.js`: se normaliza antes de buscar.
    const k = f.replace(/\\/g, '/').replace(/^\/app\//, '')
    if (!(k in files)) throw new Error('ENOENT')
    return enc(files[k])
  }
}

const ENTRY = JSON.stringify({
  v: 2,
  js: 'assets/main-AAA.js',
  css: [],
  preload: ['assets/main-AAA.js', 'assets/boot-BBB.js'],
  bootCss: ['assets/boot-CCC.css']
})

describe('loadEntryInfo', () => {
  it('calcula el sha384 de cada archivo del arranque, sin repetidos', () => {
    const info = loadEntryInfo(
      '/app',
      '0.3.0',
      fs({ 'entry.json': ENTRY, 'assets/main-AAA.js': 'main', 'assets/boot-BBB.js': 'boot', 'assets/boot-CCC.css': 'css' })
    )
    expect(info).not.toBeNull()
    expect(info!.v).toBe('0.3.0')
    expect(info!.js).toBe('assets/main-AAA.js')
    expect(info!.files.map((f) => f.p).sort()).toEqual(['assets/boot-BBB.js', 'assets/boot-CCC.css', 'assets/main-AAA.js'])
    const main = info!.files.find((f) => f.p === 'assets/main-AAA.js')!
    expect(main.sri).toBe(`sha384-${createHash('sha384').update('main').digest('base64')}`)
  })

  it('la trama que sale pasa el validador del celular', () => {
    const info = loadEntryInfo(
      '/app',
      '0.3.0',
      fs({ 'entry.json': ENTRY, 'assets/main-AAA.js': 'a', 'assets/boot-BBB.js': 'b', 'assets/boot-CCC.css': 'c' })
    )!
    const raw = JSON.stringify({ t: 'entry', ...info })
    expect(parseHostFrame(raw)).toMatchObject({ ok: true, value: { t: 'entry', js: 'assets/main-AAA.js' } })
  })

  it('sin app/, JSON roto, rutas raras o archivos vacíos: null', () => {
    expect(loadEntryInfo('/app', '1', () => Promise.reject as never)).toBeNull()
    expect(loadEntryInfo('/app', '1', fs({ 'entry.json': 'no json' }))).toBeNull()
    for (const bad of [
      { js: '../x.js' },
      { js: 'assets/a.html' },
      { js: 'assets/a.js', css: ['../../etc/passwd.css'] },
      { js: 'assets/a.js', preload: 'x' },
      { js: 5 }
    ])
      expect(loadEntryInfo('/app', '1', fs({ 'entry.json': JSON.stringify(bad), 'assets/a.js': 'x' })), JSON.stringify(bad)).toBeNull()
    expect(loadEntryInfo('/app', '1', fs({ 'entry.json': JSON.stringify({ js: 'assets/a.js' }), 'assets/a.js': '' }))).toBeNull()
    expect(loadEntryInfo('/app', 'ver sión', fs({ 'entry.json': JSON.stringify({ js: 'assets/a.js' }), 'assets/a.js': 'x' }))).toBeNull()
  })

  it('sriOf es el formato de integrity', () => {
    expect(sriOf(enc('abc'))).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/)
  })
})

describe('trama entry', () => {
  const sri = (c: string): string => `sha384-${c.repeat(64)}`
  const ok = {
    t: 'entry',
    v: '0.3.0',
    js: 'assets/a.js',
    files: [
      { p: 'assets/a.js', sri: sri('A') },
      { p: 'assets/b.css', sri: sri('B') }
    ]
  }
  it('válida', () => {
    expect(parseHostFrame(JSON.stringify(ok)).ok).toBe(true)
  })
  it('rechaza lo raro', () => {
    for (const bad of [
      { ...ok, extra: 1 },
      { ...ok, v: 'con espacio' },
      { ...ok, js: 'assets/b.css' },
      { ...ok, js: 'assets/zzz.js' }, // su hash no está en la lista
      { ...ok, files: [] },
      { ...ok, files: [...ok.files, { p: 'assets/a.js', sri: sri('C') }] }, // repetido
      { ...ok, files: [{ p: '../a.js', sri: sri('A') }] },
      { ...ok, files: [{ p: 'assets/a.js', sri: 'sha256-x' }] },
      { ...ok, files: Array.from({ length: 33 }, (_, i) => ({ p: `assets/f${i}.js`, sri: sri('A') })) }
    ])
      expect(parseHostFrame(JSON.stringify(bad)).ok, JSON.stringify(bad).slice(0, 80)).toBe(false)
  })
})
