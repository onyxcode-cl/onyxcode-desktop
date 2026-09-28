/**
 * Configuración inyectada a `opencode serve` vía la variable OPENCODE_CONFIG_CONTENT.
 * Se fusiona con la config global del usuario (~/.config/opencode) y la del proyecto.
 *
 * Define los agentes propios de la app:
 * - `chat`: conversación general, sin herramientas de archivos/shell (solo web).
 */
import { CHAT_AGENT } from '@shared/types'

export function buildInlineConfig(): Record<string, unknown> {
  return {
    $schema: 'https://opencode.ai/config.json',
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
      }
    }
  }
}
