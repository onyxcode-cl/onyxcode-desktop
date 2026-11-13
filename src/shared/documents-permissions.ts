/**
 * Nombres y permisos de la herramienta `documentos` (Word, Excel, PowerPoint y PDF) en Code: parte PURA, sin Node ni Electron, para que la
 * usen `main` (config del motor) y el renderer de Code (bloque de modo de la sesión). Calcado de `shell-bg-permissions.ts`.
 *
 * `documentos` NO es un conector «interno» (`CODE_INTERNAL_MCP` daría `allow` total): va como servidor con reglas fijas, igual que `bgshell`.
 */
import { effectiveModeFor, rulesetForMode, type PermissionModeId, type PermissionRuleLike, type RuleAction } from './permission-rules'

/** Clave del servidor en el bloque `mcp` del motor (y prefijo de las herramientas: `documentos_crear`). Debe coincidir con `DOCUMENTS_ROUTE_NAME` de main. */
export const DOCUMENTS_SERVER = 'documentos'
/** `folder` de la atadura de Code en main: NO es una ruta, solo la clave que hace que un arranque nuevo del motor sustituya el token anterior. */
export const CODE_BINDING_FOLDER = '<code>'
export const DOCUMENTS_CREATE_TOOL = `${DOCUMENTS_SERVER}_crear`
export const DOCUMENTS_EXPORT_PDF_TOOL = `${DOCUMENTS_SERVER}_exportar_pdf`
export const DOCUMENTS_RENDER_TOOL = `${DOCUMENTS_SERVER}_renderizar`
export const DOCUMENTS_IMAGE_SEARCH_TOOL = `${DOCUMENTS_SERVER}_imagenes_buscar`
export const DOCUMENTS_IMAGE_VIEW_TOOL = `${DOCUMENTS_SERVER}_imagenes_ver`
export const DOCUMENTS_IMAGE_USE_TOOL = `${DOCUMENTS_SERVER}_imagenes_usar`

/**
 * Acción de `documentos_crear` en un modo/agente: LA MISMA que la regla efectiva de `write` con patrón `*` del bloque del modo
 * (Preguntar → `ask`; Aceptar ediciones, Automático y Todo sin preguntar → `allow`; Plan → `deny`). Crear un documento es escribir un archivo
 * nuevo en el proyecto: no puede ser más permisivo que `write`. Si no hubiera regla se devuelve `ask` (lo más restrictivo que deja trabajar).
 */
export function documentsCreateAction(mode: PermissionModeId, agent?: string): RuleAction {
  return documentsModeAction('write', mode, agent)
}

/** Buscar fotos conserva el permiso de búsqueda web; descargarlas conserva el de escritura. */
export function documentsSearchAction(mode: PermissionModeId, agent?: string): RuleAction {
  return documentsModeAction('websearch', mode, agent)
}

function documentsModeAction(permission: string, mode: PermissionModeId, agent?: string): RuleAction {
  const block = rulesetForMode(effectiveModeFor(mode, agent))
  for (let i = block.length - 1; i >= 0; i--) {
    const r = block[i]!
    if (r.permission === permission && r.pattern === '*') return r.action
  }
  return 'ask'
}

/**
 * Reglas de sesión para enviar JUNTO al bloque de modo (`session.update({ permission })`): `documentos_crear` igual que `write`;
 * `documentos_renderizar` en `allow` (solo mira archivos del proyecto y devuelve imágenes). Van ANTES del bloque del modo para que la
 * sesión siga TERMINANDO con él (`endsWithRuleset`). Úsese como `[...bgshellSessionRules(...), ...documentsSessionRules(...), ...rulesetForMode(...)]`.
 */
export function documentsSessionRules(mode: PermissionModeId, agent?: string): PermissionRuleLike[] {
  return [
    { permission: DOCUMENTS_CREATE_TOOL, pattern: '*', action: documentsCreateAction(mode, agent) },
    { permission: DOCUMENTS_RENDER_TOOL, pattern: '*', action: 'allow' },
    { permission: DOCUMENTS_IMAGE_SEARCH_TOOL, pattern: '*', action: documentsSearchAction(mode, agent) },
    { permission: DOCUMENTS_IMAGE_VIEW_TOOL, pattern: '*', action: documentsSearchAction(mode, agent) },
    { permission: DOCUMENTS_IMAGE_USE_TOOL, pattern: '*', action: documentsCreateAction(mode, agent) },
    { permission: DOCUMENTS_EXPORT_PDF_TOOL, pattern: '*', action: documentsCreateAction(mode, agent) }
  ]
}

/**
 * Suelo de la configuración (bloque `permission` de la config inline, vale para TODOS los agentes y sesiones): `documentos_crear` pregunta,
 * `documentos_renderizar` pasa. El bloque de sesión lo ajusta después según el modo.
 */
export function documentsConfigPermission(): Record<string, RuleAction> {
  return {
    [DOCUMENTS_CREATE_TOOL]: 'ask',
    [DOCUMENTS_RENDER_TOOL]: 'allow',
    [DOCUMENTS_IMAGE_SEARCH_TOOL]: 'ask',
    [DOCUMENTS_IMAGE_VIEW_TOOL]: 'ask',
    [DOCUMENTS_IMAGE_USE_TOOL]: 'ask',
    [DOCUMENTS_EXPORT_PDF_TOOL]: 'ask'
  }
}
