import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEntry, prefetchFullApp, resetEntryCache } from '../../../pwa/src/full'

const V2 = {
  v: 2,
  js: 'assets/main-abc.js',
  css: ['assets/main-abc.css'],
  preload: ['assets/main-abc.js', 'assets/vendor-1.js', 'assets/boot-9.js'],
  bootCss: ['assets/boot-9.css']
}

function stubFetch(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const f = vi.fn(async () => ({ ok, json: async () => body }))
  vi.stubGlobal('fetch', f)
  return f
}

// Sin DOM en el vitest del proyecto: un `document` mínimo (solo lo que usa `addLink`).
interface FakeLink {
  rel: string
  href: string
  setAttribute(k: string, v: string): void
}
let head: FakeLink[] = []
const fakeDocument = {
  head: {
    append: (l: FakeLink) => void head.push(l),
    querySelector: (sel: string) => {
      const m = /link\[rel="([^"]+)"\]\[href="([^"]+)"\]/.exec(sel)
      return head.find((l) => l.rel === m?.[1] && l.href === m?.[2]) ?? null
    }
  },
  createElement: (): FakeLink => ({ rel: '', href: '', setAttribute() {} })
}
const links = (): string[] => head.map((l) => `${l.rel}:${l.href}`)
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('full.ts: entry.json y precarga', () => {
  beforeEach(() => {
    resetEntryCache()
    head = []
    vi.stubGlobal('document', fakeDocument)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('parseEntry acepta v1 (sin preload) y v2', () => {
    expect(parseEntry({ v: 1, js: 'assets/a.js', css: ['assets/a.css'] })).toEqual({
      js: 'assets/a.js',
      css: ['assets/a.css'],
      preload: [],
      bootCss: []
    })
    expect(parseEntry(V2)?.preload).toHaveLength(3)
  })

  it('parseEntry rechaza rutas fuera de assets/ y descarta las malas de las listas', () => {
    expect(parseEntry({ js: '../evil.js' })).toBeNull()
    expect(parseEntry({ js: 'https://x.test/a.js' })).toBeNull()
    expect(
      parseEntry({ js: 'assets/a.js', preload: ['assets/ok.js', '//evil.test/x.js', 'assets/../x.js', 3], bootCss: ['x.css'] })
    ).toMatchObject({
      preload: ['assets/ok.js'],
      bootCss: []
    })
    expect(parseEntry(null)).toBeNull()
  })

  it('prefetchFullApp inserta modulepreload y preload de estilos, sin duplicar y pidiendo entry.json una vez', async () => {
    const f = stubFetch(V2)
    prefetchFullApp()
    prefetchFullApp()
    await flush()
    const l = links()
    expect(l).toContain('modulepreload:./app/assets/vendor-1.js')
    expect(l).toContain('modulepreload:./app/assets/boot-9.js')
    expect(l).toContain('preload:./app/assets/boot-9.css')
    expect(l.filter((x) => x === 'modulepreload:./app/assets/main-abc.js')).toHaveLength(1)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('sin entry.json válido no inserta nada y un reintento vuelve a pedirlo', async () => {
    const f = stubFetch({}, false)
    prefetchFullApp()
    await flush()
    expect(links()).toEqual([])
    prefetchFullApp()
    await flush()
    expect(f).toHaveBeenCalledTimes(2)
  })
})
