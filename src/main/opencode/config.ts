/**
 * Configuración inyectada a `opencode serve` vía la variable OPENCODE_CONFIG_CONTENT.
 * Se fusiona con la config global del usuario (~/.config/opencode) y la del proyecto.
 *
 * Define los agentes propios de la app:
 * - `chat`: conversación general, sin herramientas de archivos/shell (solo web); `'*': deny` ya
 *   cubre `browser_*` sin necesidad de listarlo aparte.
 * - `computer` se oculta aquí: solo existe en los servidores Tareas de acceso total.
 *
 * Navegador integrado (Lote D, B.7): `server.ts` resuelve `mcp.browser` con
 * `embeddedBrowserMcp.configFor({product:'code'})` ANTES de arrancar y se lo pasa a
 * `buildInlineConfig({ browserMcp })`. Si el MCP no arrancó (`browserMcp` es null), el sidecar
 * arranca igual, sin navegador: `mcp.browser` simplemente no se incluye.
 */
import { CHAT_AGENT } from '@shared/types'

export interface InlineConfigOptions {
  /** Bloque `mcp.browser` ya resuelto (o null si el MCP del navegador integrado no arrancó). */
  browserMcp?: Record<string, unknown> | null
}

export function buildInlineConfig(opts: InlineConfigOptions = {}): Record<string, unknown> {
  return {
    $schema: 'https://opencode.ai/config.json',
    // La app fija la versión del SDK: sin auto-actualización del binario (AUDIT.md B3/§1.2).
    autoupdate: false,
    // Sin `/share`: nada de las conversaciones sube a opencode.ai. La config inline gana sobre la global y la de
    // proyecto (orden de OpenCode: global < proyecto < OPENCODE_CONFIG_CONTENT), así que un `share` del usuario no lo pisa.
    share: 'disabled',
    ...(opts.browserMcp ? { mcp: { browser: opts.browserMcp } } : {}),
    agent: {
      [CHAT_AGENT]: {
        description: 'Conversación general, sin acceso a archivos ni terminal',
        mode: 'primary',
        prompt:
          'Eres un asistente conversacional útil. Responde en el idioma del usuario, usando Markdown cuando ayude a la claridad. No tienes acceso a archivos ni a la terminal del usuario.',
        permission: {
          '*': 'deny',
          webfetch: 'allow',
          websearch: 'allow'
        }
      },
      computer: { disable: true }
    }
  }
}
