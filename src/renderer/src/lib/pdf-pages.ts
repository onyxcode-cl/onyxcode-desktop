/**
 * PDF → páginas como imágenes (o texto) para los modelos que no leen PDF directo. Corre en el renderer con pdf.js:
 * nada del archivo se ejecuta (`isEvalSupported: false`) y el resultado vuelve como URL `data:`, igual que cualquier adjunto.
 * pdf.js se importa recién al necesitarlo (no pesa en el arranque).
 */
import { textToDataUrl } from './attachments'
import { PDF_IMAGE_MAX_PAGES, PDF_IMAGE_MAX_SIDE, PDF_TEXT_MAX_CHARS, pageImageName } from '@shared/attach-adapt'

export type PdfConvertResult =
  | { ok: true; parts: { mime: string; filename: string; url: string }[]; truncated: boolean }
  | { ok: false; reason: 'encrypted' | 'unreadable' | 'empty' }

function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function openPdf(
  url: string
): Promise<
  { ok: true; doc: import('pdfjs-dist').PDFDocumentProxy; close: () => void } | { ok: false; reason: 'encrypted' | 'unreadable' }
> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  try {
    const task = pdfjs.getDocument({ data: dataUrlToBytes(url), enableXfa: false, verbosity: 0 })
    const doc = await task.promise
    return { ok: true, doc, close: () => void task.destroy() }
  } catch (e) {
    return { ok: false, reason: (e as { name?: string } | null)?.name === 'PasswordException' ? 'encrypted' : 'unreadable' }
  }
}

/** Las primeras páginas del PDF como JPEG (`data:`). */
export async function pdfToImages(url: string, name: string): Promise<PdfConvertResult> {
  const opened = await openPdf(url)
  if (!opened.ok) return opened
  const { doc, close } = opened
  try {
    const total = doc.numPages
    const count = Math.min(total, PDF_IMAGE_MAX_PAGES)
    const parts: { mime: string; filename: string; url: string }[] = []
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(3, PDF_IMAGE_MAX_SIDE / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return { ok: false, reason: 'unreadable' }
      ctx.fillStyle = '#fff' // las páginas sin fondo saldrían negras en JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      parts.push({ mime: 'image/jpeg', filename: pageImageName(name, n), url: canvas.toDataURL('image/jpeg', 0.85) })
      page.cleanup()
    }
    return parts.length ? { ok: true, parts, truncated: total > count } : { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    close()
  }
}

/** El texto del PDF (para modelos que solo leen texto). Un PDF escaneado no tiene texto → `empty`. */
export async function pdfToText(url: string, name: string): Promise<PdfConvertResult> {
  const opened = await openPdf(url)
  if (!opened.ok) return opened
  const { doc, close } = opened
  try {
    let text = ''
    let truncated = false
    for (let n = 1; n <= doc.numPages && !truncated; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      let line = ''
      let pageText = ''
      for (const it of content.items) {
        if (!('str' in it)) continue
        line += it.str
        if (it.hasEOL) {
          pageText += line.trim() + '\n'
          line = ''
        }
      }
      pageText += line.trim()
      text += `\n--- página ${n} ---\n${pageText}`
      page.cleanup()
      if (text.length > PDF_TEXT_MAX_CHARS) {
        text = text.slice(0, PDF_TEXT_MAX_CHARS)
        truncated = true
      }
    }
    if (!text.replace(/--- página \d+ ---/g, '').trim()) return { ok: false, reason: 'empty' }
    return {
      ok: true,
      parts: [{ mime: 'text/plain', filename: name.replace(/\.pdf$/i, '') + '.txt', url: textToDataUrl(text) }],
      truncated
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    close()
  }
}
