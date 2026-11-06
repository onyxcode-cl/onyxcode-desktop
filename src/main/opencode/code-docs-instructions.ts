/**
 * Guía de documentos para Code (clave `instructions` de la config inline del sidecar principal).
 *
 * La herramienta `documentos_*` la cablea `server.ts` (ver `documents/mcp-server.ts`); la guía corta de «cuándo usarla y cargar antes la
 * skill» está en `code-docs-prompt.ts`. Esta función escribe esa guía en la carpeta de configuración y devuelve su ruta para que
 * `config.ts` la enlace desde `instructions`. Nunca lanza: si no se puede escribir, el motor arranca igual (la herramienta ya lleva la
 * misma indicación en su descripción y en las instrucciones del servidor MCP).
 */
import { getOpencodeConfigDir } from '../tasks/opencode-config'
import { writeCodeDocsPrompt } from './code-docs-prompt'

export function codeDocsInstructions(): string[] {
  try {
    const file = writeCodeDocsPrompt(getOpencodeConfigDir())
    return file ? [file] : []
  } catch {
    return []
  }
}
