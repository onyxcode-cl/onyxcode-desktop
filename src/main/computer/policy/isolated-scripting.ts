/**
 * Lista pura (sin importaciones: la usa también `computer/mcp-server.ts`, que se empaqueta aparte y no importa módulos de la app).
 */
/**
 * Origen aislado (puente de apps desde una Tarea): apps que ejecutan guiones o cambian ajustes del sistema. Controlarlas permitiría salir
 * de la jaula sin pasar por `equipo` (un guion en Script Editor, System Events), cambiar permisos de privacidad (Ajustes) o pulsar el
 * diálogo nativo de una aprobación (`osascript`). Nunca se actúan desde una Tarea, ni con tarjeta.
 */
export const ISOLATED_SCRIPTING_BUNDLE_IDS: ReadonlySet<string> = new Set([
  'com.apple.ScriptEditor2',
  'com.apple.systemevents',
  'com.apple.systempreferences',
  'com.apple.Settings',
  'com.apple.osascript'
])
const ISOLATED_SCRIPTING_NAMES =
  /^(?:osascript|System Events|Script Editor|Editor de Scripts|Editor de scripts|System Settings|System Preferences|Ajustes del Sistema|Preferencias del Sistema|Configuración del Sistema)$/i

/** ¿Es una app de guiones o de ajustes del sistema (por id o por nombre; `osascript` no tiene id de paquete)? */
export function isIsolatedScriptingApp(bundleId: string | undefined, name?: string): boolean {
  return (!!bundleId && ISOLATED_SCRIPTING_BUNDLE_IDS.has(bundleId)) || (!!name && ISOLATED_SCRIPTING_NAMES.test(name.trim()))
}
