/** Regresión V26: app inicializada de verdad; no importa módulos de main en un bundle aparte. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, type E2EApp, ROOT } from '../lib/launch'
import { assertSlidePng } from '../../src/main/extras/slides-deck-pptx'
import { pdfPageCount } from '../../src/main/extras/pdf-options'

let app: E2EApp
let output: string
const suppliedOutput = process.env.LAZUNOX_SLIDES_CHECK_OUT
beforeAll(async () => {
  output = suppliedOutput ? resolve(suppliedOutput) : await mkdtemp(join(tmpdir(), 'lazunox-slides-check-'))
  await mkdir(output, { recursive: true })
  // startApp ya usa --use-mock-keychain en Mac, userData temporal y settings que impiden migrar datos reales.
  app = await startApp({ env: { LAZUNOX_E2E_EXPORT_DIR: output } })
})
afterAll(async () => {
  await app?.stop()
  if (!suppliedOutput && output) await rm(output, { recursive: true, force: true })
})

it('exporta HTML, PDF y PowerPoint sin diálogos ni ventanas ocultas huérfanas', async () => {
  const photo = (await readFile(join(ROOT, 'src/main/documents/fixtures-free-images/synthetic-exif-6.jpg'))).toString('base64')
  const photoTag = `<img src="data:image/jpeg;base64,${photo}" style="width:220px;height:150px;object-fit:cover" alt="Foto de prueba"><p class="credit">Foto de prueba · CC0</p>`
  const variants = process.env.LAZUNOX_SLIDES_CHECK_HTML
    ? [
        {
          name: 'presentation',
          html: await readFile(process.env.LAZUNOX_SLIDES_CHECK_HTML, 'utf8'),
          count: Number(process.env.LAZUNOX_SLIDES_CHECK_COUNT || 0)
        }
      ]
    : [
        { name: 'fixed', css: '.slide{width:960px;height:540px}', count: 2 },
        { name: 'large', css: '.slide{width:1280px;height:720px}', count: 2 },
        {
          name: 'responsive-hidden',
          css: '.deck{position:relative;width:100vw;height:100vh}.slide{position:absolute;inset:0;display:none}.slide.active{display:flex}',
          count: 2
        }
      ].map(({ name, css, count }) => ({
        name,
        count,
        html: `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0}.slide{padding:30px;background:#17324d;color:white;font:24px sans-serif}${css}</style></head><body><main class="deck"><section class="slide active"><h1>Foto visible</h1>${photoTag}</section><section class="slide"><h1>Segunda lámina</h1>${photoTag}</section></main><nav>Control fuera de lámina</nav></body></html>`
      }))
  const baseline = await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const reports: unknown[] = []
  for (const { name, html, count: requestedCount } of variants) {
    const count = requestedCount || (html.match(/class=["'][^"']*\bslide\b/gi) || []).length
    expect(count).toBeGreaterThan(0)
    const photos = (html.match(/data:image\/(?:jpeg|png|webp);base64,/g) || []).length
    const credits = (html.match(/(?:class=["'][^"']*(?:credit|credito)|data-(?:lzx-)?(?:image|photo)-credit)/gi) || []).length
    expect(photos, 'La muestra debe incluir fotos autónomas').toBeGreaterThan(0)
    expect(credits, 'La muestra debe incluir créditos identificables').toBeGreaterThan(0)
    const paths = await app.page.evaluate(
      async (payload) => ({
        html: await window.api.extras.downloadHtml(payload),
        pdf: await window.api.extras.downloadHtmlAsPdf(payload),
        pptx: await window.api.extras.downloadSlidesAsPptx(payload)
      }),
      { title: name, html }
    )
    expect(paths.html).toBeTruthy()
    expect(paths.pdf).toBeTruthy()
    expect(paths.pptx).toBeTruthy()
    expect(await readFile(paths.html!, 'utf8')).toContain('data:image/')
    expect(pdfPageCount(await readFile(paths.pdf!))).toBe(count)
    const zip = await JSZip.loadAsync(await readFile(paths.pptx!))
    const media = Object.keys(zip.files)
      .filter((n) => /^ppt\/media\/.+\.png$/.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    expect(media).toHaveLength(count)
    expect(slides).toHaveLength(count)
    const hashes: string[] = []
    for (const [i, path] of media.entries()) {
      const png = await zip.file(path)!.async('nodebuffer')
      assertSlidePng(png, i)
      hashes.push(createHash('sha256').update(png).digest('hex'))
      await writeFile(join(output, `${name}-slide-${i + 1}.png`), png)
    }
    expect(await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(baseline)
    await app.assertClean(`exportación ${name}`)
    reports.push({ name, slides: count, png: { width: 3840, height: 2160 }, photos, credits, hashes, paths })
  }
  await writeFile(
    join(output, 'verification.json'),
    JSON.stringify(
      {
        reports,
        review: 'Revisar PNG: fotos, créditos y recortes; abrir PPTX en PowerPoint. Hashes de PNG extraídos, no comparación previa a ZIP.'
      },
      null,
      2
    ) + '\n'
  )
}, 180_000)

it('el plazo real devuelve un error y destruye la ventana bloqueada en fuentes', async () => {
  const baseline = await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const html =
    '<!doctype html><style>.slide{width:960px;height:540px}</style><section class="slide">Espera de fuente simulada</section><script>Object.defineProperty(document,"fonts",{value:{ready:new Promise(()=>{})}})</script>'
  for (const method of ['downloadHtmlAsPdf', 'downloadSlidesAsPptx'] as const) {
    const error = await app.page.evaluate(
      async ({ method, html }) => {
        try {
          await window.api.extras[method]({ html, title: 'Timeout controlado' })
          return null
        } catch (error) {
          return String(error)
        }
      },
      { method, html }
    )
    expect(error).toMatch(/(?:tardó demasiado|tiempo máximo)/)
    expect(await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(baseline)
  }
  await app.assertClean('plazo de exportación')
}, 90_000)
