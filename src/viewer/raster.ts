/**
 * Página oculta que convierte un PDF en imágenes PNG para la vista previa de la herramienta `documentos` (Excel y PDF). Corre en la
 * vista aislada del visor (`lazunox-viewer://viewer/raster.html`: sin red, permisos denegados), con pdf.js sin evaluar nada del archivo.
 * El proceso principal la maneja con `executeJavaScript('window.lzxRaster(...)')`; no recibe ninguna otra entrada. Funciona igual en
 * macOS y en Windows (no depende de Python ni de ningún programa externo).
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface RasterResult {
  pages: number
  /** PNG en base64, uno por página (hasta `maxPages`). */
  images: string[]
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function rasterize(b64: string, maxPages: number, maxSide: number): Promise<RasterResult> {
  const task = pdfjs.getDocument({ data: b64ToBytes(b64), enableXfa: false, isEvalSupported: false, verbosity: 0 })
  const doc = await task.promise
  try {
    const total = doc.numPages
    const images: string[] = []
    for (let n = 1; n <= Math.min(total, maxPages); n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(3, maxSide / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('sin canvas')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      images.push(canvas.toDataURL('image/png').split(',')[1] ?? '')
      page.cleanup()
    }
    return { pages: total, images }
  } finally {
    void task.destroy()
  }
}

;(window as unknown as { lzxRaster: typeof rasterize }).lzxRaster = rasterize
document.documentElement.dataset.ready = '1'
