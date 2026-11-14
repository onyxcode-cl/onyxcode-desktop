// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FreeImageAsset } from './free-images'
import { FreeImageRegistry } from './free-image-registry'
import { resolvePreparedHtml } from './html-photos'
import { FREE_IMAGE_PREVIEW_MARKER } from './free-image-preview'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH7sAAAAASUVORK5CYII=', 'base64')
const evaluation = { mode: 'manual' as const, observed: 'Foto elegida por la persona.', meets: [], doubts: '' }
const credit = 'Foto: Author · CC BY 4.0 · Wikimedia Commons'
const photo = (id: string): FreeImageAsset => {
  const bytes = Buffer.concat([PNG, Buffer.from(id)])
  return {
    bytes,
    ext: 'jpg',
    credit,
    provenance: {
      provider: 'Wikimedia Commons',
      id,
      title: 'Photo',
      author: 'Author',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Photo.jpg',
      credit,
      sourceSha1: 'abc123',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      checkedAt: '2026-11-13T00:00:00.000Z',
      queries: ['photo'],
      requirements: { subject: 'Photo', usage: 'Report', required: [], excluded: [], realPhoto: true },
      evaluation,
      evaluationStatus: 'seleccion-manual-declarada',
      status: 'licencia-comprobada',
      transformations: [],
      width: 1,
      height: 1,
      notices: 'Aviso de atribución completo',
      fullCredit: 'Texto completo original del autor'
    }
  }
}

let base: string, root: string, registry: FreeImageRegistry
const rel = 'img/free-12345678901234567890.jpg'
beforeEach(async () => {
  vi.unstubAllGlobals()
  base = await mkdtemp(join(tmpdir(), 'html-photos-'))
  root = join(base, 'scope')
  await mkdir(join(root, 'img'), { recursive: true })
  registry = new FreeImageRegistry(join(base, 'registry'))
  const asset = photo('p1')
  await writeFile(join(root, rel), asset.bytes)
  await registry.remember(root, 'p1', rel, asset)
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})
it('embeds one copy per hash and adds legible credit inside every photo slide', async () => {
  const html = await resolvePreparedHtml(
    '<body><section class="slide"><img src="imagen:p1"><img src="' +
      rel +
      '"></section><section class="slide"><img src="imagen:p1"></section></body>',
    { root },
    registry
  )
  expect(html.split(photo('p1').bytes.toString('base64')).length - 1).toBe(1)
  document.body.innerHTML = html
  const script = document.querySelector('[data-lzx-prepared-photos]')!.textContent!
  new Function('document', 'getComputedStyle', script)(document, (el: Element) => window.getComputedStyle(el))
  const slides = [...document.querySelectorAll('.slide')]
  expect(slides).toHaveLength(2)
  for (const slide of slides) {
    const footer = slide.querySelector('[data-lzx-photo-credit]') as HTMLElement
    expect(footer.textContent).toContain(credit)
    expect(footer.style.color).toBe('rgb(255, 255, 255)')
    expect(footer.style.background).toBe('rgb(17, 17, 17)')
  }
  expect(document.querySelectorAll('img[src^="data:image/jpeg;base64,"]')).toHaveLength(3)
  expect(document.querySelector('[data-lzx-photo-credit] a:last-child')?.getAttribute('href')).toBe(photo('p1').provenance.licenseUrl)
  const provenance = JSON.parse(document.querySelector('[data-lzx-photo-provenance]')!.textContent!)
  expect(provenance[0].provenance).toEqual(photo('p1').provenance)
  document.body.innerHTML = ''
})
it('rejects IDs from another conversation, arbitrary paths, changed bytes and symlinks', async () => {
  const other = join(base, 'other')
  await mkdir(other)
  await expect(resolvePreparedHtml('<section class="slide"><img src="imagen:p1">', { root: other }, registry)).rejects.toThrow(
    'conversación o carpeta'
  )
  await expect(resolvePreparedHtml('<section class="slide"><img src="../scope/' + rel + '">', { root: other }, registry)).rejects.toThrow(
    'subir'
  )
  await expect(resolvePreparedHtml('<section class="slide"><img src="/etc/passwd">', { root }, registry)).rejects.toThrow('relativa')
  await writeFile(join(root, rel), 'changed')
  await expect(resolvePreparedHtml('<section class="slide"><img src="imagen:p1">', { root }, registry)).rejects.toThrow('cambió')
  await rm(join(root, rel))
  await symlink(join(base, 'elsewhere.jpg'), join(root, rel))
  await expect(resolvePreparedHtml('<section class="slide"><img src="imagen:p1">', { root }, registry)).rejects.toThrow('enlace')
})
it('rejects marked preview data and enforces context and byte budgets', async () => {
  await expect(
    resolvePreparedHtml(
      '<section class="slide"><img src="data:image/jpeg;base64,' + Buffer.from(FREE_IMAGE_PREVIEW_MARKER).toString('base64') + '">'
    )
  ).rejects.toThrow('MUESTRA')
  await expect(resolvePreparedHtml('<section class="slide"><img src="imagen:p1">')).rejects.toThrow('contexto')
  await expect(resolvePreparedHtml('<section class="slide"><img src="https://example.org/photo.jpg">')).rejects.toThrow('URLs')
  await expect(resolvePreparedHtml('x'.repeat(24 * 1024 * 1024 + 1))).rejects.toThrow('24 MiB')
})
it('accepts an autonomous deck whose provenance text mentions the preview watermark (Mac, prueba real)', async () => {
  const html =
    '<section class="slide"><h1>Café</h1></section>' +
    '<script type="application/json" id="lzx-procedencia">{"nota":"la marca MUESTRA NO USAR es de la vista previa"}</script>'
  await expect(resolvePreparedHtml(html)).resolves.toBe(html)
})
it('supports prepared CSS background IDs and ignores script strings', async () => {
  const html = await resolvePreparedHtml(
    '<style>.slide{background:url("imagen:p1")}</style><section class="slide"></section><script>var example="url(no-file.jpg)"</script>',
    { root },
    registry
  )
  expect(html).toContain('var(--lzx-photo-')
  expect(html).toContain('url(no-file.jpg)')
  expect(html).toContain('data-lzx-photo-credit')
  document.body.innerHTML = html
  new Function('document', 'getComputedStyle', document.querySelector('[data-lzx-prepared-photos]')!.textContent!)(
    document,
    (el: Element) => window.getComputedStyle(el)
  )
  expect(document.querySelector('.slide [data-lzx-photo-credit]')?.textContent).toContain(credit)
  await expect(resolvePreparedHtml(html)).resolves.toBe(html)
})

it('requires every prepared img to be inside its slide and preserves generic remote HTML', async () => {
  await expect(resolvePreparedHtml('<section class="slide"></section><img src="imagen:p1">', { root }, registry)).rejects.toThrow(
    'misma lámina'
  )
  const generic = '<img src="https://example.org/photo.jpg">'
  expect(await resolvePreparedHtml(generic)).toBe(generic)
  const html = await resolvePreparedHtml(
    '<section class="slide" style="background-image:url(&quot;imagen:p1&quot;)"></section>',
    { root },
    registry
  )
  expect(html).toContain('var(--lzx-photo-')
})

it('rejects the final embedded budget before constructing oversized data URIs', async () => {
  const byId = new Map()
  for (let i = 0; i < 4; i++) {
    const asset = photo('large-' + i)
    asset.bytes = Buffer.alloc(5 * 1024 * 1024, i + 1)
    const sha = createHash('sha256').update(asset.bytes).digest('hex')
    const rel = 'img/large-' + i + '.jpg'
    await writeFile(join(root, rel), asset.bytes)
    byId.set('large-' + i, { sha, id: 'large-' + i, rel, asset })
  }
  vi.spyOn(registry, 'findId').mockImplementation(async (_root, id) => byId.get(id) ?? null)
  const html = '<section class="slide">' + [...byId.keys()].map((id) => '<img src="imagen:' + id + '">').join('') + '</section>'
  await expect(resolvePreparedHtml(html, { root }, registry)).rejects.toThrow('presupuesto de 24 MiB')
})

it('resolves img paths relative to the HTML directory within the registered scope', async () => {
  const asset = photo('nested')
  await mkdir(join(root, 'decks/img'), { recursive: true })
  await writeFile(join(root, 'decks/img/free-12345678901234567890.jpg'), asset.bytes)
  await registry.remember(join(root, 'decks'), 'nested', rel, asset)
  const html = await resolvePreparedHtml(
    '<section class="slide"><img src="img/free-12345678901234567890.jpg"></section>',
    { root, baseDir: 'decks' },
    registry
  )
  expect(html).toContain(asset.bytes.toString('base64'))
  expect(html).not.toContain('src="img/')
  const byId = await resolvePreparedHtml('<section class="slide"><img src="imagen:nested"></section>', { root, baseDir: 'decks' }, registry)
  expect(byId).toContain(asset.bytes.toString('base64'))
  await expect(
    resolvePreparedHtml('<section class="slide"><img src="../img/free-nested.jpg"></section>', { root, baseDir: 'decks' }, registry)
  ).rejects.toThrow('subir')
})

it('keeps an existing verified author/license credit instead of drawing a second bar', async () => {
  const html = await resolvePreparedHtml(
    '<section class="slide"><img src="imagen:p1"><small>Photo: Author · CC BY 4.0</small><button>Next</button></section>',
    { root },
    registry
  )
  document.body.innerHTML = html
  new Function('document', 'getComputedStyle', document.querySelector('[data-lzx-prepared-photos]')!.textContent!)(
    document,
    (el: Element) => window.getComputedStyle(el)
  )
  expect(document.querySelectorAll('[data-lzx-photo-credit]')).toHaveLength(1)
  expect(document.querySelector('[data-lzx-photo-credit]')?.tagName).toBe('SMALL')
  expect(document.querySelector('aside')).toBeNull()
  expect(document.querySelectorAll('small a')).toHaveLength(2)
})

it('places generated credits above navigation controls, without stealing clicks', async () => {
  const html = await resolvePreparedHtml(
    '<section class="slide"><img src="imagen:p1"></section><nav><button>Next</button></nav>',
    { root },
    registry
  )
  document.body.innerHTML = html
  vi.spyOn(document.querySelector('.slide')!, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: 960,
    top: 0,
    bottom: 540,
    width: 960,
    height: 540
  } as DOMRect)
  vi.spyOn(document.querySelector('button')!, 'getBoundingClientRect').mockReturnValue({
    left: 400,
    right: 560,
    top: 490,
    bottom: 535,
    width: 160,
    height: 45
  } as DOMRect)
  new Function('document', 'getComputedStyle', document.querySelector('[data-lzx-prepared-photos]')!.textContent!)(
    document,
    (el: Element) => window.getComputedStyle(el)
  )
  const credit = document.querySelector('[data-lzx-photo-credit]') as HTMLElement
  expect(credit.parentElement).toBe(document.querySelector('.slide'))
  expect(credit.style.bottom).toBe('58px')
  expect(credit.style.pointerEvents).toBe('none')
})

it('recognizes copied credits on initially hidden slides and preserves their links', async () => {
  const html = await resolvePreparedHtml(
    '<section class="slide" style="display:none"><img src="imagen:p1"><div class="credito">Foto: Author · CC BY 4.0 · Wikimedia Commons <a href="https://commons.wikimedia.org/wiki/File:Photo.jpg">Fuente</a></div></section>',
    { root },
    registry
  )
  document.body.innerHTML = html
  new Function('document', 'getComputedStyle', document.querySelector('[data-lzx-prepared-photos]')!.textContent!)(
    document,
    (el: Element) => window.getComputedStyle(el)
  )
  expect(document.querySelectorAll('[data-lzx-photo-credit]')).toHaveLength(1)
  expect(document.querySelectorAll('.credito a')).toHaveLength(2)
  expect((document.querySelector('.credito') as HTMLElement).style.background).toBe('rgb(17, 17, 17)')
  expect((document.querySelector('.credito') as HTMLElement).style.color).toBe('rgb(255, 255, 255)')
  expect(document.querySelector('aside')).toBeNull()
})
