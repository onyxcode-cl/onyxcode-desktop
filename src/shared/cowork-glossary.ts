/**
 * Glosario de Cowork (módulo PURO): términos únicos de la interfaz, para que main y renderer
 * usen siempre las mismas palabras.
 *
 * Prohibido en la interfaz: "Acceso total", "acceso completo" y "Carpetas autorizadas".
 */
export const COWORK_TERMS = {
  sandbox: 'Sandbox',
  fullControl: 'Control total del Mac',
  fullControlShort: 'Control total',
  workFolders: 'Carpetas de Cowork',
  trustedFolders: 'Carpetas de confianza',
  linkedFolders: 'Carpetas adicionales',
  readOnly: 'Solo lectura',
  readWrite: 'Lectura y escritura',
  deleteGrant: 'Permitir borrar, mover y renombrar',
  sideChat: 'Consulta lateral',
  routine: 'Rutina',
  browser: 'Navegador'
} as const
