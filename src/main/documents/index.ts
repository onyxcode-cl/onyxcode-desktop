/** Instancia única de la herramienta `documentos` (servidor MCP en main) con el motor real del Chat. */
import { renderBytes } from './engine'
import { DocumentsMcpServer } from './mcp-server'

export { DOCUMENTS_ROUTE_NAME, RESERVED_MCP_NAMES } from './names'
export const documentsMcp = new DocumentsMcpServer({ render: (input, title, opts) => renderBytes(input, title, opts) })
