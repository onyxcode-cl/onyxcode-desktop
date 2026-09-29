/**
 * Constantes del asistente de primer uso: acciones permitidas (lista blanca), comando de instalación
 * y versión del SDK. Módulo puro (lo usan main y renderer).
 *
 * El comando de instalación es el oficial de OpenCode: el propio binario descarga `https://opencode.ai/install`
 * y lo ejecuta con bash para actualizarse. La app SOLO lo copia al portapapeles: nunca lo ejecuta.
 */

/** Versión del SDK (`@opencode-ai/sdk`) con la que se compila la app; un test la ata a package.json. */
export const OPENCODE_SDK_VERSION = '1.18.32'

export const OPENCODE_INSTALL_COMMAND = 'curl -fsSL https://opencode.ai/install | bash'

/** Páginas que la app puede abrir desde el asistente (URL fija: el renderer solo elige la clave). */
export const OPENCODE_LINKS = {
  openDocs: 'https://opencode.ai/docs',
  openGo: 'https://opencode.ai/go',
  openAuth: 'https://opencode.ai/auth'
} as const

export const OPENCODE_ACTIONS = ['copyInstall', 'openDocs', 'openGo', 'openAuth'] as const
export type OpencodeAction = (typeof OPENCODE_ACTIONS)[number]
