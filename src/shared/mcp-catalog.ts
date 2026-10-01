/**
 * Catálogo curado de servidores MCP (F8-B24). Va incluido en la app: no se descarga nada.
 *
 * v1 solo ofrece servidores REMOTOS (una URL https): añadir uno no ejecuta ningún programa en el Mac.
 * El renderer solo envía id, nombre y entradas del formulario; el proceso principal construye la entrada
 * de `opencode.json` desde SU copia de este catálogo (ver `main/extras/mcp-catalog-install.ts`).
 *
 * Cada URL se verificó contra la documentación oficial del proveedor y respondiendo como servidor MCP
 * (`npm run check:mcp-catalog` lo repite a mano, con red, fuera de `verify`).
 */

/** Nombre de servidor MCP válido (el mismo que acepta `mcp:save`). */
export const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Sube cuando cambia el contenido del catálogo (queda anotada en la procedencia de cada instalación). */
export const MCP_CATALOG_VERSION = 1

export type McpCatalogAuth = 'oauth' | 'token' | 'none'

export interface McpCatalogInput {
  id: string
  label: string
  /** `secret` se enmascara en pantalla y no se vuelve a mostrar. */
  kind: 'secret' | 'text'
  /** Expresión anclada (`^…$`) que debe cumplir el valor. */
  pattern: string
  maxLength: number
  /** Cabecera HTTP donde se coloca; `template` lleva exactamente un `{value}`. */
  target: { header: string; template: string }
  /** Dónde crear el valor (texto de ayuda). */
  help?: string
}

export interface McpCatalogItem {
  id: string
  /** Nombre sugerido del servidor (cumple `MCP_NAME_RE`); la persona puede cambiarlo. */
  name: string
  title: string
  publisher: string
  category: 'Documentación' | 'Desarrollo' | 'Proyectos' | 'Conocimiento'
  description: string
  transport: 'remote'
  url: string
  auth: McpCatalogAuth
  inputs: McpCatalogInput[]
  /** Lo que podrá hacer la IA con él. */
  capabilities: string[]
  /** `true` si puede crear, cambiar o borrar cosas en el servicio. */
  writes: boolean
  /** Qué datos salen de este equipo hacia el servicio. */
  dataLeaves: string
  docsUrl: string
  /** Fecha (AAAA-MM-DD) en que se verificó contra la documentación y la red. */
  verifiedAt: string
}

const VERIFIED = '2026-10-01'

export const MCP_CATALOG: readonly McpCatalogItem[] = [
  {
    id: 'context7',
    name: 'context7',
    title: 'Context7',
    publisher: 'Upstash',
    category: 'Documentación',
    description: 'Documentación y ejemplos de código actualizados de bibliotecas y frameworks.',
    transport: 'remote',
    url: 'https://mcp.context7.com/mcp',
    auth: 'none',
    inputs: [],
    capabilities: ['Buscar la documentación vigente de una biblioteca o framework', 'Traer ejemplos de código de esa documentación'],
    writes: false,
    dataLeaves: 'El nombre de la biblioteca y el tema que la IA consulte se envían a Context7. No hace falta cuenta.',
    docsUrl: 'https://github.com/upstash/context7',
    verifiedAt: VERIFIED
  },
  {
    id: 'cloudflare-docs',
    name: 'cloudflare-docs',
    title: 'Cloudflare Docs',
    publisher: 'Cloudflare',
    category: 'Documentación',
    description: 'Busca en la documentación oficial de Cloudflare (Workers, R2, DNS, etc.).',
    transport: 'remote',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    auth: 'none',
    inputs: [],
    capabilities: ['Buscar en la documentación de Cloudflare', 'Leer páginas de esa documentación'],
    writes: false,
    dataLeaves: 'Las preguntas que la IA haga sobre la documentación se envían a Cloudflare. No accede a tu cuenta de Cloudflare.',
    docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/',
    verifiedAt: VERIFIED
  },
  {
    id: 'github',
    name: 'github',
    title: 'GitHub',
    publisher: 'GitHub',
    category: 'Desarrollo',
    description: 'Repositorios, incidencias y pull requests de tu cuenta de GitHub.',
    transport: 'remote',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'token',
    inputs: [
      {
        id: 'token',
        label: 'Token de acceso personal',
        kind: 'secret',
        pattern: '^(ghp_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$',
        maxLength: 400,
        target: { header: 'Authorization', template: 'Bearer {value}' },
        help: 'Créalo en GitHub: Settings › Developer settings › Personal access tokens, con los permisos mínimos que necesites.'
      }
    ],
    capabilities: [
      'Leer repositorios, código, incidencias y pull requests',
      'Crear y comentar incidencias y pull requests, según los permisos del token'
    ],
    writes: true,
    dataLeaves: 'Tu token y lo que la IA pida sobre tus repositorios (y su contenido) viajan a GitHub.',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server',
    verifiedAt: VERIFIED
  },
  {
    id: 'linear',
    name: 'linear',
    title: 'Linear',
    publisher: 'Linear',
    category: 'Proyectos',
    description: 'Incidencias, proyectos y ciclos de tu espacio de Linear.',
    transport: 'remote',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    inputs: [],
    capabilities: ['Buscar y leer incidencias y proyectos', 'Crear y actualizar incidencias y comentarios'],
    writes: true,
    dataLeaves: 'Lo que la IA lea o escriba en tu espacio de Linear viaja a Linear. El acceso se concede iniciando sesión.',
    docsUrl: 'https://linear.app/docs/mcp',
    verifiedAt: VERIFIED
  },
  {
    id: 'notion',
    name: 'notion',
    title: 'Notion',
    publisher: 'Notion',
    category: 'Conocimiento',
    description: 'Busca, lee y edita páginas y bases de datos de tu Notion.',
    transport: 'remote',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    inputs: [],
    capabilities: ['Buscar y leer páginas y bases de datos', 'Crear y editar páginas y comentarios'],
    writes: true,
    dataLeaves: 'El contenido de Notion que la IA lea o escriba viaja a Notion. El acceso se concede iniciando sesión.',
    docsUrl: 'https://developers.notion.com/docs/get-started-with-mcp',
    verifiedAt: VERIFIED
  },
  {
    id: 'sentry',
    name: 'sentry',
    title: 'Sentry',
    publisher: 'Sentry',
    category: 'Desarrollo',
    description: 'Errores, rendimiento e incidencias de tus proyectos en Sentry.',
    transport: 'remote',
    url: 'https://mcp.sentry.dev/mcp',
    auth: 'oauth',
    inputs: [],
    capabilities: ['Buscar y analizar errores e incidencias', 'Consultar rendimiento y gestionar proyectos'],
    writes: true,
    dataLeaves:
      'Los datos de errores que la IA consulte (pueden incluir trazas y contexto de tu código) viajan a Sentry. El acceso se concede iniciando sesión.',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
    verifiedAt: VERIFIED
  },
  {
    id: 'atlassian',
    name: 'atlassian',
    title: 'Atlassian (Jira y Confluence)',
    publisher: 'Atlassian',
    category: 'Proyectos',
    description: 'Incidencias de Jira y páginas de Confluence de tu organización.',
    transport: 'remote',
    url: 'https://mcp.atlassian.com/v2/mcp',
    auth: 'oauth',
    inputs: [],
    capabilities: ['Buscar y leer incidencias y páginas', 'Crear y actualizar incidencias y páginas'],
    writes: true,
    dataLeaves: 'El contenido de Jira y Confluence que la IA lea o escriba viaja a Atlassian. El acceso se concede iniciando sesión.',
    docsUrl: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/',
    verifiedAt: VERIFIED
  }
]

export function findCatalogItem(id: string): McpCatalogItem | undefined {
  return MCP_CATALOG.find((i) => i.id === id)
}

/** Procedencia de un servidor instalado desde el catálogo (la guarda main aparte, no en `opencode.json`). */
export interface McpCatalogProvenance {
  catalogId: string
  version: number
  installedAt: number
  url: string
}

export interface McpCatalogState {
  items: McpCatalogItem[]
  /** Por nombre de servidor; `drift` = ya no coincide con lo que instaló el catálogo («modificado»). */
  installed: Record<string, { catalogId: string; drift: boolean }>
}
