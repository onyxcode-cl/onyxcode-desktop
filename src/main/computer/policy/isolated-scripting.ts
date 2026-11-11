/**
 * Lista pura (sin importaciones: la usa también `computer/mcp-server.ts`, que se empaqueta aparte y no importa módulos de la app).
 */
/**
 * Origen aislado (puente de apps desde una Tarea): apps que ejecutan guiones o cambian ajustes del sistema. Controlarlas permitiría salir
 * de la jaula sin pasar por `equipo` (un guion en Script Editor, System Events), cambiar permisos de privacidad (Ajustes) o pulsar el
 * diálogo nativo de una aprobación (`osascript`). Nunca se actúan desde una Tarea, ni con tarjeta.
 */
export const ISOLATED_SCRIPTING_BUNDLE_IDS: ReadonlySet<string> = new Set(
  [
    // guiones y ajustes del sistema
    'com.apple.ScriptEditor2',
    'com.apple.ScriptEditor',
    'com.apple.systemevents',
    'com.apple.systempreferences',
    'com.apple.Settings',
    'com.apple.osascript',
    'com.apple.Automator',
    'com.apple.shortcuts',
    // terminales: ejecutan órdenes fuera de la jaula
    'com.apple.Terminal',
    'com.googlecode.iterm2',
    'dev.warp.Warp-Stable',
    'com.mitchellh.ghostty',
    'net.kovidgoyal.kitty',
    'org.alacritty',
    'io.alacritty',
    // diálogos del sistema (Gatekeeper «Abrir de todos modos», avisos, contraseñas, llavero)
    'com.apple.coreservices.uiagent',
    'com.apple.UserNotificationCenter',
    'com.apple.SecurityAgent',
    'com.apple.keychainaccess',
    // Finder: un `.command` que escriba la tarea se abre con doble clic en Terminal, fuera de la jaula
    'com.apple.finder'
  ].map((x) => x.toLowerCase())
)
/** Prefijos de id (en minúsculas): variantes y versiones de la misma app. */
const ISOLATED_SCRIPTING_BUNDLE_PREFIXES: readonly string[] = ['com.latenightsw.scriptdebugger', 'dev.warp.']
const ISOLATED_SCRIPTING_NAMES =
  /^(?:osascript|System Events|Script Editor|Editor de Scripts|System Settings|System Preferences|Ajustes del Sistema|Preferencias del Sistema|Configuración del Sistema|Automator|Shortcuts|Atajos|Script Debugger|Terminal|iTerm2?|Warp|Ghostty|kitty|Alacritty|CoreServicesUIAgent|UserNotificationCenter|SecurityAgent|Keychain Access|Acceso a Llaveros|Finder|Command Prompt|Símbolo del sistema|cmd(?:\.exe)?|(?:Windows )?PowerShell(?:\.exe)?|pwsh(?:\.exe)?|Windows Terminal|wt(?:\.exe)?|WindowsTerminal(?:\.exe)?|wscript(?:\.exe)?|cscript(?:\.exe)?|mshta(?:\.exe)?|Registry Editor|Editor del Registro|regedit(?:\.exe)?|mmc(?:\.exe)?|Microsoft Management Console|Control Panel|Panel de control|control(?:\.exe)?|SystemSettings(?:\.exe)?|Task Manager|Administrador de tareas|taskmgr(?:\.exe)?|File Explorer|Explorador de archivos|explorer(?:\.exe)?|Run|Ejecutar)$/i

/**
 * ¿Es una app de guiones, terminal, ajustes o diálogo del sistema (por id o por nombre, sin distinguir mayúsculas; `osascript` no tiene
 * id de paquete)? Los nombres incluyen los de Windows (la lista de Windows por ejecutable está en `mcp-platform-win32.ts`).
 */
export function isIsolatedScriptingApp(bundleId: string | undefined, name?: string): boolean {
  const id = bundleId?.toLowerCase()
  if (id && (ISOLATED_SCRIPTING_BUNDLE_IDS.has(id) || ISOLATED_SCRIPTING_BUNDLE_PREFIXES.some((p) => id.startsWith(p)))) return true
  return !!name && ISOLATED_SCRIPTING_NAMES.test(name.trim())
}
