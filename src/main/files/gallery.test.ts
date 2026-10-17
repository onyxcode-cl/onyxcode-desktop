import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { Gallery } from './gallery'
import { GalleryIndex, MAX_GALLERY_ITEMS, galleryKey, galleryTypeOf } from './gallery-index'
import { THUMB_WIDTH, firstLine, galleryThumb } from './gallery-thumbs'
import { resolveChatFile } from './chat-files'
import { IPC_SCHEMAS } from '../ipc/schemas'
import { CELULAR_POLICY } from '../remote/policy'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'gallery-')))
let n = 0
let chat: string
let outside: string
let od: string
let indexFile: string
let approvedOd = true
let clock = 1_000_000

function make(scan = true): { g: Gallery; index: GalleryIndex } {
  const index = new GalleryIndex(indexFile, false)
  const g = new Gallery({
    index,
    chatRoots: () => [chat],
    scanDirs: () => (scan ? [chat] : []),
    overdriveApproved: (r) => approvedOd && r === od,
    now: () => clock++
  })
  return { g, index }
}

beforeEach(() => {
  const d = join(base, `t${n++}`)
  chat = join(d, 'chat')
  outside = join(d, 'fuera')
  od = join(d, 'overdrive')
  for (const x of [chat, outside, od]) mkdirSync(x, { recursive: true })
  indexFile = join(d, 'userData', 'gallery-index.json')
  approvedOd = true
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('tipos', () => {
  it('clasifica por extensión, también con rutas de Windows', () => {
    expect(galleryTypeOf('C:\\Users\\ana\\Informe.DOCX')).toBe('document')
    expect(galleryTypeOf('/a/b/hoja.xlsx')).toBe('sheet')
    expect(galleryTypeOf('/a/b/pres.pptx')).toBe('slides')
    expect(galleryTypeOf('D:\\x\\index.HTML')).toBe('web')
    expect(galleryTypeOf('/a/x.pdf')).toBe('pdf')
    expect(galleryTypeOf('/a/x.png')).toBe('image')
    expect(galleryTypeOf('/a/x.md')).toBe('text')
    for (const bad of ['/a/x.exe', '/a/x.sh', '/a/x.ts', '/a/x.json', '/a/sin-extension', '/a/.docx']) expect(galleryTypeOf(bad)).toBeNull()
  })
  it('la clave en Windows no distingue mayúsculas ni barras', () => {
    expect(galleryKey('C:/Users/Ana/A.docx', true)).toBe(galleryKey('c:\\users\\ana\\a.DOCX', true))
    expect(galleryKey('/a/B.docx', false)).not.toBe(galleryKey('/a/b.docx', false))
  })
})

describe('índice', () => {
  it('alta, repetido, baja y persistencia', () => {
    const idx = new GalleryIndex(indexFile, false)
    expect(idx.add({ path: '/x/a.docx', type: 'document', origin: 'chat', createdAt: 5 })).toBe(true)
    expect(idx.add({ path: '/x/a.docx', type: 'document', origin: 'chat', createdAt: 9 })).toBe(false)
    expect(idx.add({ path: '/x/a.docx', type: 'document', origin: 'chat', createdAt: 9, title: 'Carta' })).toBe(true)
    expect(new GalleryIndex(indexFile, false).entries()).toHaveLength(1)
    expect(new GalleryIndex(indexFile, false).get('/x/a.docx')?.title).toBe('Carta')
    expect(idx.remove('/x/a.docx')).toBe(true)
    expect(new GalleryIndex(indexFile, false).entries()).toHaveLength(0)
  })
  it('rutas de Windows inyectadas: mismo archivo con otra capitalización no se duplica', () => {
    const idx = new GalleryIndex(indexFile, true)
    idx.add({ path: 'C:\\Users\\Ana\\Informe.docx', type: 'document', origin: 'overdrive', createdAt: 1, root: 'C:\\Users\\Ana' })
    expect(idx.add({ path: 'c:\\users\\ana\\informe.DOCX', type: 'document', origin: 'overdrive', createdAt: 2 })).toBe(false)
    expect(idx.has('C:/Users/Ana/Informe.docx')).toBe(true)
    expect(idx.entries()).toHaveLength(1)
  })
  it('tope de 500: se descartan las más antiguas', () => {
    const idx = new GalleryIndex(indexFile, false)
    for (let i = 1; i <= MAX_GALLERY_ITEMS + 20; i++) idx.add({ path: `/x/${i}.pdf`, type: 'pdf', origin: 'chat', createdAt: i })
    const e = idx.entries()
    expect(e).toHaveLength(MAX_GALLERY_ITEMS)
    expect(e[0].path).toBe(`/x/${MAX_GALLERY_ITEMS + 20}.pdf`)
    expect(idx.has('/x/1.pdf')).toBe(false)
  })
  it('un archivo roto o con campos raros no tumba nada', () => {
    mkdirSync(join(indexFile, '..'), { recursive: true })
    writeFileSync(indexFile, '{no es json')
    expect(new GalleryIndex(indexFile, false).entries()).toEqual([])
    writeFileSync(
      indexFile,
      JSON.stringify({
        items: [
          { path: '/ok/a.pdf', type: 'pdf', origin: 'chat', createdAt: 3 },
          { path: '/mal/a.pdf', type: 'virus', origin: 'chat', createdAt: 3 },
          { path: 5, type: 'pdf', origin: 'chat', createdAt: 3 },
          { path: '/mal/b.pdf', type: 'pdf', origin: 'otro', createdAt: 3 },
          { path: '/mal/c.pdf', type: 'pdf', origin: 'chat', createdAt: -1 },
          null
        ]
      })
    )
    expect(new GalleryIndex(indexFile, false).entries().map((x) => x.path)).toEqual(['/ok/a.pdf'])
  })
  it('no deja archivo temporal tras guardar', () => {
    new GalleryIndex(indexFile, false).add({ path: '/x/a.pdf', type: 'pdf', origin: 'chat', createdAt: 1 })
    expect(existsSync(`${indexFile}.tmp`)).toBe(false)
    expect(JSON.parse(readFileSync(indexFile, 'utf8')).items).toHaveLength(1)
  })
})

describe('galería: validación y estados', () => {
  it('registra un archivo del Chat y lo lista; el borrado sale como «no encontrado» y se quita', () => {
    const { g } = make()
    const f = join(chat, 'carta.docx')
    writeFileSync(f, 'PK')
    expect(g.record('chat', f, { title: 'Carta de renovación', session: 's1' })).toBe(true)
    let r = g.list()
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({
      name: 'Carta de renovación',
      type: 'document',
      origin: 'chat',
      missing: false,
      canView: true,
      canOpen: true
    })
    rmSync(f)
    r = g.list()
    expect(r.items[0].missing).toBe(true)
    expect(r.items[0].canOpen).toBe(false)
    g.remove(f)
    expect(g.list().items).toHaveLength(0)
  })
  it('rechaza rutas fuera de las carpetas, secretos y tipos que no son creaciones', () => {
    const { g } = make()
    const out = join(outside, 'x.pdf')
    writeFileSync(out, '%PDF')
    expect(g.record('chat', out)).toBe(false)
    writeFileSync(join(chat, 'credentials.txt'), 'x')
    expect(g.record('chat', join(chat, 'credentials.txt'))).toBe(false)
    writeFileSync(join(chat, 'run.sh'), 'x')
    expect(g.record('chat', join(chat, 'run.sh'))).toBe(false)
    expect(g.record('chat', join(chat, 'no-existe.pdf'))).toBe(false)
    expect(g.record('chat', 'relativa/x.pdf')).toBe(false)
    expect(g.list().items).toHaveLength(0)
  })
  it.skipIf(!posixOnly)('un enlace que escapa de la carpeta se rechaza; los archivos ejecutables no entran', () => {
    const { g } = make()
    const real = join(outside, 'secreto.pdf')
    writeFileSync(real, '%PDF')
    symlinkSync(real, join(chat, 'enlace.pdf'))
    expect(g.record('chat', join(chat, 'enlace.pdf'))).toBe(false)
    const exe = join(chat, 'prog.pdf')
    writeFileSync(exe, '%PDF')
    chmodSync(exe, 0o755)
    expect(g.record('chat', exe)).toBe(false)
  })
  it('Overdrive: solo carpetas autorizadas, y si se revoca la carpeta sus archivos pasan a «no encontrado»', () => {
    const { g } = make()
    const f = join(od, 'Informe.pdf')
    writeFileSync(f, '%PDF')
    expect(g.record('overdrive', f, { root: outside })).toBe(false)
    expect(g.record('overdrive', f, { root: od, createdAt: 50 })).toBe(true)
    expect(g.list().items[0]).toMatchObject({ origin: 'overdrive', missing: false })
    expect(g.extraRoots()).toEqual([od])
    approvedOd = false
    expect(g.list().items[0].missing).toBe(true)
    expect(g.extraRoots()).toEqual([])
    expect(() => g.resolve(f)).toThrow()
  })
  it('«Descargar»: autoriza ese archivo exacto, no su carpeta', () => {
    const { g } = make()
    const saved = join(outside, 'Presupuesto.xlsx')
    writeFileSync(saved, 'PK')
    writeFileSync(join(outside, 'otro.xlsx'), 'PK')
    expect(g.record('chat', saved, { exact: true, title: 'Presupuesto' })).toBe(true)
    expect(g.resolve(saved).name).toBe('Presupuesto.xlsx')
    expect(() => g.resolve(join(outside, 'otro.xlsx'))).toThrow()
    expect(g.list().items[0].missing).toBe(false)
  })
  it('recorre la carpeta del Chat al listar y salta lo oculto y lo que no es creación', () => {
    const { g } = make()
    mkdirSync(join(chat, 'sub'))
    writeFileSync(join(chat, 'sub', 'hoja.xlsx'), 'PK')
    writeFileSync(join(chat, 'foto.png'), 'x')
    writeFileSync(join(chat, 'notas.json'), '{}')
    mkdirSync(join(chat, '.oculta'))
    writeFileSync(join(chat, '.oculta', 'a.pdf'), '%PDF')
    expect(
      g
        .list()
        .items.map((i) => i.name)
        .sort()
    ).toEqual(['foto.png', 'hoja.xlsx'])
  })
  it('un archivo quitado de la lista no vuelve con el recorrido de la carpeta', () => {
    const { g } = make()
    const f = join(chat, 'a.pdf')
    writeFileSync(f, '%PDF')
    expect(g.list().items).toHaveLength(1)
    g.remove(f)
    expect(g.list().items).toHaveLength(0)
    expect(make().g.list().items).toHaveLength(0)
  })
  it('volver a abrir el mismo documento del Chat reemplaza al anterior', () => {
    const { g } = make(false)
    for (const id of ['a', 'b']) {
      const f = join(chat, `${id}.docx`)
      writeFileSync(f, 'PK')
      g.record('chat', f, { title: 'Carta', session: 's1' })
    }
    expect(g.list().items).toHaveLength(1)
  })
  it('ordena por fecha, lo más nuevo primero', () => {
    const { g } = make()
    for (const [name, t] of [
      ['a.pdf', 10],
      ['b.pdf', 30],
      ['c.pdf', 20]
    ] as const) {
      writeFileSync(join(chat, name), '%PDF')
      g.record('chat', join(chat, name), { createdAt: t })
    }
    expect(g.list().items.map((i) => i.name)).toEqual(['b.pdf', 'c.pdf', 'a.pdf'])
  })
})

describe('miniaturas', () => {
  const shrink = (b: Buffer, w: number): Buffer => Buffer.from(`png:${w}:${b.length}`)
  it('imagen: reduce, guarda en caché y no vuelve a reducir', () => {
    const f = join(chat, 'foto.png')
    writeFileSync(f, Buffer.alloc(100, 1))
    const info = resolveChatFile([chat], f)
    let calls = 0
    const deps = { cacheDir: join(base, 'cache'), shrink: (b: Buffer, w: number) => (calls++, shrink(b, w)) }
    const a = galleryThumb(info, 'image', deps)
    expect(a.kind).toBe('image')
    expect(Buffer.from((a as { dataUrl: string }).dataUrl.split(',')[1], 'base64').toString()).toBe(`png:${THUMB_WIDTH}:100`)
    galleryThumb(info, 'image', deps)
    expect(calls).toBe(1)
  })
  it('sin red ni programas: svg, Office y PDF devuelven «none»; un reductor que falla también', () => {
    const svg = join(chat, 'x.svg')
    writeFileSync(svg, '<svg/>')
    const deps = { cacheDir: join(base, 'cache2'), shrink: () => null }
    expect(galleryThumb(resolveChatFile([chat], svg), 'image', deps).kind).toBe('none')
    const doc = join(chat, 'x.docx')
    writeFileSync(doc, 'PK')
    expect(galleryThumb(resolveChatFile([chat], doc), 'document', deps).kind).toBe('none')
    const png = join(chat, 'y.png')
    writeFileSync(png, 'x')
    expect(galleryThumb(resolveChatFile([chat], png), 'image', deps).kind).toBe('none')
  })
  it('imagen demasiado grande de origen: sin miniatura', () => {
    const f = join(chat, 'enorme.png')
    writeFileSync(f, 'x')
    const info = { ...resolveChatFile([chat], f), bytes: 11 * 1024 * 1024 }
    expect(galleryThumb(info, 'image', { cacheDir: join(base, 'c3'), shrink })).toEqual({ kind: 'none' })
  })
  it('texto: primera línea sin marcas; HTML: su título; binario: nada', () => {
    const md = join(chat, 'a.md')
    writeFileSync(md, '\n## **Acta** de reunión\n\ncuerpo')
    const deps = { cacheDir: join(base, 'c4'), shrink }
    expect(galleryThumb(resolveChatFile([chat], md), 'text', deps)).toEqual({ kind: 'text', text: 'Acta de reunión' })
    const html = join(chat, 'p.html')
    writeFileSync(html, '<html><head><title>Seguros del Sur</title><script>x()</script></head><body>hola</body></html>')
    expect(galleryThumb(resolveChatFile([chat], html), 'web', deps)).toEqual({ kind: 'text', text: 'Seguros del Sur' })
    const bin = join(chat, 'b.txt')
    writeFileSync(bin, Buffer.from([65, 0, 66]))
    expect(galleryThumb(resolveChatFile([chat], bin), 'text', deps).kind).toBe('none')
    expect(firstLine('x'.repeat(500), 'text').length).toBeLessThanOrEqual(140)
  })
})

describe('IPC', () => {
  it('esquemas estrictos y clase X', () => {
    const chan = ['extras:gallery:list', 'extras:gallery:thumb', 'extras:gallery:remove'] as const
    for (const c of chan) {
      expect(IPC_SCHEMAS[c]).toBeDefined()
      expect(CELULAR_POLICY[c]).toBe('X')
    }
    const sch = IPC_SCHEMAS['extras:gallery:thumb']
    expect(() => sch({ path: '/a/b.png' })).not.toThrow()
    expect(() => sch({ path: 'relativa.png' })).toThrow()
    expect(() => sch({ path: '/a/b.png', extra: 1 } as never)).toThrow()
    expect(() => sch({ path: '/a/\0b.png' })).toThrow()
    expect(() => IPC_SCHEMAS['extras:gallery:remove']({} as never)).toThrow()
    expect(() => IPC_SCHEMAS['extras:gallery:list'](undefined)).not.toThrow()
  })
})
