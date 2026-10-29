/** Nombre de la ruta del proxy MCP y del servidor MCP `documentos` en la config del agente (la herramienta sale como `documentos_crear`). */
export const DOCUMENTS_ROUTE_NAME = 'documentos'
/** Nombres de MCP que un MCP del usuario no puede usar en Tareas: pisarían a uno de la app. */
export const RESERVED_MCP_NAMES: ReadonlySet<string> = new Set([DOCUMENTS_ROUTE_NAME, 'equipo'])
