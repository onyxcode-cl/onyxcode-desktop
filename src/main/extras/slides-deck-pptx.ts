/**
 * Armado puro del `.pptx` proyectable de un deck `​```slides` (ver `slides-deck-export.ts` para el
 * resto del contexto/decisión) — SIN ningún import de `electron`, a propósito: así se puede probar
 * con buffers de prueba, sin necesitar una `BrowserWindow` real (a diferencia de la captura de
 * imágenes, que sí la necesita y por eso vive en un archivo aparte).
 */
import PptxGenJS from 'pptxgenjs'

/** Mismo 16:9 que `render-pptx.ts` (`PAGE_W`/`PAGE_H`) — consistencia de tamaño entre los dos caminos de PowerPoint, aunque son archivos independientes. */
const PAGE_W = 10
const PAGE_H = 5.625

/** `images` (una por diapositiva, en orden) → `.pptx` con cada imagen a pantalla completa, sin texto ni forma. */
export async function assembleSlidesPptx(images: Buffer[]): Promise<Buffer> {
  const pres = new PptxGenJS()
  pres.defineLayout({ name: 'LAZUNOX-SLIDES', width: PAGE_W, height: PAGE_H })
  pres.layout = 'LAZUNOX-SLIDES'
  for (const image of images) {
    const slide = pres.addSlide()
    slide.addImage({ data: `data:image/png;base64,${image.toString('base64')}`, x: 0, y: 0, w: PAGE_W, h: PAGE_H })
  }
  return (await pres.write({ outputType: 'nodebuffer' })) as Buffer
}
