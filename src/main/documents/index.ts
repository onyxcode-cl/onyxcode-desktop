/** Instancia única de la herramienta `documentos` (servidor MCP en main) con el motor real del Chat. */
import { app } from 'electron'
import { join } from 'node:path'
import { setPrivateTmpBase } from '../office/craft/private-tmp'
import { captureDeckSlides, captureDocxPages } from '../viewer/capture'
import { craftBinary, ensureCraft, renderBytes } from './engine'
import { rasterizePdf } from './pdf-raster'
import { renderPreview } from './preview'
import { DocumentsMcpServer } from './mcp-server'
import { FreeImageRegistry } from './free-image-registry'
import { exportDocumentPdf } from './export-pdf'
import { hasPreparedPhotoReferences } from './html-photos'
import { ChatPhotosMcpServer } from './chat-photos'

export { DOCUMENTS_ROUTE_NAME, RESERVED_MCP_NAMES } from './names'
// Temporales de la vista previa fuera del alcance del agente aislado (en `$TMPDIR` el sandbox sí escribe).
try {
  setPrivateTmpBase(join(app.getPath('userData'), 'documentos-tmp'))
} catch {
  /* sin Electron (pruebas): se queda en os.tmpdir() */
}

export const documentsMcp = new DocumentsMcpServer({
  photoRegistry: new FreeImageRegistry(join(app.getPath('userData'), 'documentos-fotos')),
  exportPdf: async (tipo, bytes) => {
    await ensureCraft()
    return exportDocumentPdf(tipo, bytes, { wordcraft: craftBinary('wordcraft'), deckcraft: craftBinary('deckcraft') })
  },
  render: (input, title, opts) => renderBytes(input, title, opts),
  preview: async (tipo, bytes, range) => {
    // PDF no usa ArtCraft; el resto sí: se instala bajo demanda si falta, para no mirar la vista simplificada sin necesidad.
    if (tipo !== 'pdf') await ensureCraft()
    return renderPreview(
      tipo,
      bytes,
      { deckcraft: craftBinary('deckcraft'), wordcraft: craftBinary('wordcraft'), gridcraft: craftBinary('gridcraft') },
      {
        range,
        rasterize: (pdf) => rasterizePdf(pdf),
        captureDocx: (bytes, timeoutMs, range) =>
          captureDocxPages(bytes, range ? range.lastPage - range.firstPage + 1 : undefined, timeoutMs, range?.firstPage),
        captureDeck: (bytes, timeoutMs) => captureDeckSlides(bytes, undefined, timeoutMs)
      }
    )
  }
})

export const chatPhotosMcp = new ChatPhotosMcpServer(documentsMcp, join(app.getPath('userData'), 'chat-fotos'))
export async function resolveChatHtmlPhotos(html: string, sessionId: string): Promise<string> {
  if (!hasPreparedPhotoReferences(html)) return documentsMcp.resolveHtmlPhotos(html)
  return documentsMcp.resolveHtmlPhotos(html, { root: await chatPhotosMcp.rootFor(sessionId) })
}
