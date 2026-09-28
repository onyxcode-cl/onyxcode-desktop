/**
 * Configuración de OpenCode propia de la app (agentes `chat` y `cowork`).
 *
 * Mecanismo verificado con opencode v1.18.32: la variable de entorno `OPENCODE_CONFIG_DIR`
 * apunta a un directorio con la misma estructura que `~/.config/opencode`
 * (`agents/*.md`, `opencode.json`, `commands/`…). Se SUMA a la config global del usuario
 * (no la reemplaza) y la config inline `OPENCODE_CONFIG_CONTENT` tiene prioridad sobre ella.
 *
 * Los archivos viven en `resources/opencode/` (empaquetado vía `asarUnpack: resources/**`).
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const CHAT_AGENT_ID = 'chat'
export const COWORK_AGENT_ID = 'cowork'

/** Ruta absoluta a `resources/opencode` (dev y empaquetado, fuera del asar). */
export function getOpencodeConfigDir(): string {
  const candidates = [
    join(app.getAppPath(), 'resources', 'opencode').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'),
    join(process.resourcesPath ?? '', 'opencode'),
    join(process.cwd(), 'resources', 'opencode')
  ]
  return candidates.find((p) => existsSync(join(p, 'agents'))) ?? candidates[0]
}

/**
 * Variables de entorno para cualquier `opencode serve` de la app (sidecar principal y
 * servidores de Cowork). Fusionar con `process.env` al hacer spawn.
 */
export function getOpencodeEnv(): Record<string, string> {
  return {
    OPENCODE_CONFIG_DIR: getOpencodeConfigDir()
  }
}
