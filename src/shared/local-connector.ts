/**
 * Lo que se escribe en `opencode.json` para un conector LOCAL del catálogo (F8-B186). Puro (sin Node ni Electron): lo usan `main`
 * para escribir la entrada y el renderer para mostrar «exactamente qué se guarda» ANTES de instalar, con la misma función.
 *
 * Todo sale de la ficha empaquetada (`runtime`): nada de lo que escriba la persona entra aquí, salvo el nombre del servidor, que
 * ya cumple `MCP_NAME_RE` y solo nombra la carpeta y las reglas de permisos.
 */
import type { CatalogLocalConnector, LocalRuntime } from './catalogo'
import type { McpLocalEntry } from './ipc-extras'
import { mcpPermissionKey, mcpToolPermissionKey } from './mcp-catalog'

/** Tiempo que el motor espera al programa al conectar (Python tarda unos segundos en importar todo). */
export const LOCAL_MCP_TIMEOUT_MS = 60_000

/** Une rutas con «/» (los conectores locales solo están disponibles en Mac por ahora; ver `runtime.platforms`). */
export const joinPosix = (...parts: string[]): string =>
  parts.map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, ''))).join('/')

/** Programa a lanzar: para `uv` el ejecutable del entorno; para `npm`, `node` con el script del paquete. */
export function launchCommand(rt: LocalRuntime, dir: string, nodeBin: string | null): string[] {
  const entry = joinPosix(dir, rt.entry)
  return rt.manager === 'npm' ? [nodeBin ?? 'node', entry, ...rt.args] : [entry, ...rt.args]
}

/** Entrada `mcp.<nombre>` EXACTA que escribe la app. */
export function buildLocalEntry(item: CatalogLocalConnector, dir: string, nodeBin: string | null, enable = true): McpLocalEntry {
  const rt = item.runtime
  const environment: Record<string, string> = {}
  for (const [k, v] of Object.entries(rt.env)) environment[k] = v.split('{dir}').join(dir)
  if (rt.clientFile) environment[rt.clientFile.env] = joinPosix(dir, rt.clientFile.file)
  return {
    type: 'local',
    command: launchCommand(rt, dir, nodeBin),
    environment,
    // El directorio de trabajo es la carpeta del conector: un `.env` de la carpeta del proyecto no puede cambiar su cliente de OAuth.
    cwd: dir,
    enabled: enable,
    timeout: LOCAL_MCP_TIMEOUT_MS
  }
}

/**
 * Permisos por herramienta que se escriben junto al servidor: «preguntar antes de cada uso» (opcional) y DENEGAR cada herramienta
 * que cambia algo. Van en este orden porque en el motor gana la última regla que coincide.
 */
export function localPermissions(name: string, item: CatalogLocalConnector, askEachUse: boolean): Record<string, 'ask' | 'deny'> {
  const out: Record<string, 'ask' | 'deny'> = {}
  if (askEachUse) out[mcpPermissionKey(name)] = 'ask'
  for (const tool of item.runtime.tools.blocked) out[mcpToolPermissionKey(name, tool)] = 'deny'
  return out
}

/** Claves de `permission` que puso la app para este servidor (para quitarlas al quitar el conector). */
export function localPermissionKeys(name: string, item: CatalogLocalConnector): string[] {
  return Object.keys(localPermissions(name, item, true))
}
