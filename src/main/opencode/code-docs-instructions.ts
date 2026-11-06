/**
 * Punto de enganche de la guía de documentos para Code (clave `instructions` de la config inline del sidecar principal).
 *
 * P2 cablea la herramienta `documentos_*` en Code. La guía corta de «cuándo usarla y cargar antes la skill» es de P1
 * (`code-docs-prompt.ts`, `writeCodeDocsPrompt(configDir)`). Mientras P1 no esté integrada esta función devuelve `[]`: la herramienta
 * ya lleva la misma indicación en su descripción y en las instrucciones del servidor MCP (`mcp-server.ts`), así que Code la ve igual.
 *
 * AL INTEGRAR P1: reemplazar el cuerpo por
 *   try {
 *     const file = writeCodeDocsPrompt(getOpencodeConfigDir())
 *     return file ? [file] : []
 *   } catch {
 *     return []
 *   }
 * (con `import { writeCodeDocsPrompt } from './code-docs-prompt'` y `import { getOpencodeConfigDir } from '../tasks/opencode-config'`).
 * Nada más cambia: `server.ts` ya llama a esta función y `config.ts` ya escribe `instructions` si la lista no está vacía.
 */
export function codeDocsInstructions(): string[] {
  return []
}
