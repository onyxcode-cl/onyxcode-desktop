/** Instancia única de la herramienta `documentos` (servidor MCP en main) con el motor real del Chat. */
import { craftBinary, renderBytes } from './engine'
import { rasterizePdf } from './pdf-raster'
import { renderPreview } from './preview'
import { DocumentsMcpServer } from './mcp-server'

export { DOCUMENTS_ROUTE_NAME, RESERVED_MCP_NAMES } from './names'
export const documentsMcp = new DocumentsMcpServer({
  render: (input, title, opts) => renderBytes(input, title, opts),
  preview: (tipo, bytes) =>
    renderPreview(
      tipo,
      bytes,
      { deckcraft: craftBinary('deckcraft'), wordcraft: craftBinary('wordcraft'), gridcraft: craftBinary('gridcraft') },
      { rasterize: (pdf) => rasterizePdf(pdf) }
    )
})
