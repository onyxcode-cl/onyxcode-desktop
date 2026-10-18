/**
 * Catálogo curado de servidores MCP (F8-B24). Va incluido en la app: no se descarga nada.
 *
 * Los servidores REMOTOS (una URL https) no ejecutan ningún programa en el Mac al añadirlos. Desde F8-B186 hay además
 * fichas LOCALES (`transport: "local"`): programas de terceros que la app descarga e instala en el equipo, con versión y hashes
 * fijados y solo consulta (`main/extras/local-connectors.ts`). Ajustes › Conectores ofrece solo los remotos; Personalización, ambos.
 * El renderer solo envía id, nombre y entradas del formulario; el proceso principal construye la entrada
 * de `opencode.json` desde SU copia de este catálogo (ver `main/extras/mcp-catalog-install.ts`).
 *
 * Los datos de las fichas viven en UN archivo (`resources/catalogo/catalogo.json`, F8-B181) que comparten Ajustes › Conectores y
 * la pantalla Personalización; aquí solo están los tipos, los textos por idioma y la búsqueda por id.
 * Cada URL se verificó contra la documentación oficial del proveedor y respondiendo como servidor MCP
 * (`npm run check:mcp-catalog` lo repite a mano, con red, fuera de `verify`).
 */
import {
  CATALOG,
  MCP_NAME_RE,
  type CatalogConnector,
  type CatalogLocalConnector,
  type CatalogRemoteConnector,
  type McpCatalogAuth,
  type McpCatalogInput
} from './catalogo'
import { t, type MsgKey } from './i18n'

export { MCP_NAME_RE }
export type { McpCatalogAuth, McpCatalogInput }

/**
 * Marcador con el que main sustituye los valores de `headers`/`environment` de un servidor MCP antes de
 * enviarlos al renderer (F8-B69). Al guardar, un valor igual a este marcador significa «no lo cambié»:
 * main restituye el secreto guardado.
 */
export const MCP_VALUE_MASK = '••••••••'

/** Clave de `permission` que cubre todas las herramientas de un servidor (OpenCode las nombra `<servidor>_<herramienta>`). */
export const mcpPermissionKey = (name: string): string => `${name}_*`

/** Sube cuando cambia el contenido del catálogo (queda anotada en la procedencia de cada instalación). */
export const MCP_CATALOG_VERSION = 1

/** Ficha de un conector REMOTO del catálogo (los datos viven en `resources/catalogo/catalogo.json`, ver `catalogo.ts`). */
export type McpCatalogItem = CatalogRemoteConnector

/** Los conectores remotos del catálogo empaquetado (una sola fuente: el archivo JSON; nada se repite aquí). */
export const MCP_CATALOG: readonly McpCatalogItem[] = CATALOG.connectors.filter(
  (c): c is CatalogRemoteConnector => c.transport === 'remote'
)

/** Los conectores LOCALES (programas de terceros que se instalan en el equipo; solo Personalización los ofrece). */
export const LOCAL_CATALOG: readonly CatalogLocalConnector[] = CATALOG.connectors.filter(
  (c): c is CatalogLocalConnector => c.transport === 'local'
)

/** Textos visibles de una ficha en el idioma activo (la ficha guarda el español; main solo usa url/nombre/entradas). */
export interface McpCatalogText {
  title: string
  description: string
  capabilities: string[]
  cannot: string[]
  examples: string[]
  dataLeaves: string
  inputs: Record<string, { label: string; help?: string }>
}

/** Traducción con respaldo: una ficha sin claves (p. ej. recién añadida) sigue mostrando su texto base. */
export function tx(key: string, fallback: string): string {
  const v = t(key as MsgKey)
  return v === key ? fallback : v
}

export function catalogText(item: CatalogConnector): McpCatalogText {
  const p = `mcp.cat.${item.id}`
  const q = `pers.cat.conn.${item.id}`
  return {
    title: tx(`${p}.title`, item.title),
    description: tx(`${p}.description`, item.description),
    capabilities: item.capabilities.map((c, i) => tx(`${p}.cap${i + 1}`, c)),
    cannot: item.cannot.map((c, i) => tx(`${q}.cannot${i + 1}`, c)),
    examples: item.examples.map((c, i) => tx(`${q}.ex${i + 1}`, c)),
    dataLeaves: tx(`${p}.leaves`, item.dataLeaves),
    inputs: Object.fromEntries(
      item.inputs.map((i) => [
        i.id,
        { label: tx(`${p}.input.${i.id}.label`, i.label), help: i.help === undefined ? undefined : tx(`${p}.input.${i.id}.help`, i.help) }
      ])
    )
  }
}

export function findCatalogItem(id: string): McpCatalogItem | undefined {
  return MCP_CATALOG.find((i) => i.id === id)
}

export function findLocalItem(id: string): CatalogLocalConnector | undefined {
  return LOCAL_CATALOG.find((i) => i.id === id)
}

/** Cualquier ficha (remota o local) por id. */
export function findAnyConnector(id: string): CatalogConnector | undefined {
  return CATALOG.connectors.find((i) => i.id === id)
}

/** Clave de `permission` de UNA herramienta de un servidor (OpenCode las nombra `<servidor>_<herramienta>`). */
export const mcpToolPermissionKey = (name: string, tool: string): string => `${name}_${tool}`

/** Procedencia de un servidor instalado desde el catálogo (la guarda main aparte, no en `opencode.json`). */
export interface McpCatalogProvenance {
  catalogId: string
  version: number
  installedAt: number
  /** Dirección del servicio (remotos) o cadena vacía (locales). */
  url: string
  /** Solo conectores locales: dónde quedó instalado y con qué programa se lanza (para detectar desvíos y para borrarlo todo). */
  local?: { dir: string; bin: string; packageVersion: string }
}

/** Qué hace falta en este equipo para instalar un conector local (lo informa main; el renderer no ejecuta nada). */
export interface LocalConnectorReadiness {
  /** La plataforma está entre las que la ficha admite. */
  platformOk: boolean
  /** Gestor necesario (`uv` o `npm`) y si se encontró en este equipo. */
  manager: 'uv' | 'npm'
  managerFound: boolean
}

export interface McpCatalogState {
  items: McpCatalogItem[]
  /** Por nombre de servidor; `drift` = ya no coincide con lo que instaló el catálogo («modificado»). */
  installed: Record<string, { catalogId: string; drift: boolean; local?: boolean }>
  /** Por id de ficha local: requisitos de este equipo. */
  local: Record<string, LocalConnectorReadiness>
}
