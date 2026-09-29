/**
 * Nombres heredados que las migraciones necesitan conocer. Es el ÚNICO sitio (junto con los tests de
 * `migrations/` y los fixtures de userData viejo) donde pueden aparecer los términos anteriores del
 * modo Tareas y de la app (`cowork`, `Lapis`, `OpenDesk`, `.lapis`). No importa nada: se puede usar desde main,
 * desde tests y (por valor) desde el renderer.
 */

/** Ficheros y carpetas de userData que cambian de nombre: `[viejo, nuevo]`, rutas relativas a userData. */
export const LEGACY_USERDATA_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['cowork.json', 'tasks-folders.json'],
  ['cowork-tasks.json', 'tasks-meta.json'],
  ['cowork-prefs.json', 'tasks-prefs.json'],
  ['cowork-projects.json', 'tasks-projects.json'],
  ['cowork-rules.json', 'tasks-rules.json'],
  ['cowork-network.json', 'tasks-network.json'],
  ['cowork-mcp.json', 'tasks-mcp.json'],
  ['cowork-auto.json', 'tasks-auto.json'],
  ['cowork-keep-awake.json', 'tasks-keep-awake.json'],
  // XDG de cada servidor aislado (BD de OpenCode e historial de tareas): lo más crítico.
  ['cowork-sandbox', 'tasks-sandbox'],
  // Única partición persistente (cookies del navegador integrado).
  ['Partitions/onyxcode-web-cowork', 'Partitions/onyxcode-web-tasks']
]

/** Identificador del modo en valores persistidos (ModeId, RoutineMode, BrowserProduct, ModelMode, ui.mode…). */
export const LEGACY_MODE = 'cowork'
/** Identificador nuevo del mismo modo. */
export const NEW_MODE = 'tasks'

/** `settings.json`: clave de las instrucciones globales del modo. */
export const LEGACY_SETTINGS_GLOBAL_INSTRUCTIONS_KEY = 'coworkGlobalInstructions'

/** Fichero de marcas propias de los MCP (`servers[*].cowork`). */
export const LEGACY_MCP_FLAG_KEY = 'cowork'

/** Prefijo de las claves de localStorage del renderer (`cowork.pinned`, …). */
export const LEGACY_LOCALSTORAGE_PREFIX = 'cowork.'

/** Id del agente de OpenCode y nombre de su fichero (`agents/cowork.md`). */
export const LEGACY_AGENT_ID = 'cowork'

/** Etiqueta del servidor aislado en pids.json y prefijos varios. */
export const LEGACY_SANDBOX_PID_KIND = 'cowork'
export const LEGACY_FULL_ACCESS_PID_KIND = 'cowork-full'

/** Partición persistente del navegador integrado. */
export const LEGACY_BROWSER_PARTITION = 'persist:onyxcode-web-cowork'

/** Carpeta de trabajo que el modo dejaba dentro de las carpetas del usuario. */
export const LEGACY_FOLDER_SCRATCH = '.cowork'
/** Destino nuevo (relativo a la carpeta del usuario): NO es `.onyxcode/` entera para no exponer `memoria.md`. */
export const NEW_FOLDER_SCRATCH = ['.onyxcode', 'trabajo'] as const

/** Nombres antiguos de la app (carpetas de userData previas). */
export const LEGACY_APP_NAMES = ['Lapis', 'OpenDesk'] as const
/** Carpeta de memoria por proyecto con el nombre antiguo. */
export const LEGACY_PROJECT_DIR = '.lapis'

/** Variables de entorno antiguas. */
export const LEGACY_ENV_VARS = ['OPENDESK_COWORK_FOLDER', 'OPENDESK_FULL_ACCESS'] as const
