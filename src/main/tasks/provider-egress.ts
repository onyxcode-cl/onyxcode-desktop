/**
 * Mapa de proveedores de modelos → destino real (para `CredentialProxy`) y overrides de config
 * de OpenCode que apuntan el `baseURL` del proveedor al proxy de credenciales local.
 *
 * Solo se lista lo que el sandbox de Tareas puede usar: proveedores con CLAVE de API estática (cada fila: origen +
 * prefijo que es el `baseURL` por defecto del SDK + esquema de autenticación). Para añadir uno basta una fila nueva
 * (y su id en `SANDBOX_PROVIDER_IDS`; una prueba vigila que coincidan). Los de inicio de sesión (OAuth) o nube
 * (Bedrock, Azure, Vertex) no caben aquí: sus credenciales no son una clave estática.
 *
 * Política de credenciales del servidor SANDBOXEADO (falla cerrado):
 * - Proveedor de `PROVIDER_TARGETS` con `key`: la clave real vive solo en un `CredentialProxy` del proceso main (fuera
 *   del sandbox); el servidor recibe en `OPENCODE_AUTH_CONTENT` una clave centinela aleatoria.
 * - Todo lo demás del `auth.json` del usuario (otros proveedores, OAuth, entradas sin `key`,
 *   cualquier otro campo) se OMITE: el servidor sandboxeado no lo recibe, así que esos proveedores
 *   no están disponibles en Tareas con sandbox. Nunca se pasa un secreto real por entorno.
 * Fuera de este caso (Control total, Chat, Code) no hay aislamiento de credenciales: el motor lee
 * el `auth.json` como haría el CLI.
 */
import { randomBytes } from 'node:crypto'
import { GENERATED_PROVIDER_TARGETS } from '../../shared/provider-targets.generated'

export interface ProviderTarget {
  origin: string
  pathPrefix: string
}

/**
 * Destinos con clave de API estática, de la tabla VERSIONADA `shared/provider-targets.generated.ts` (la genera
 * `scripts/gen-provider-targets.mjs` desde el catálogo de models.dev + lista manual; no se lee ningún catálogo en ejecución).
 * `pathPrefix` = el `baseURL` del proveedor; el override apunta al proxy local y el SDK le añade las mismas rutas relativas.
 * El esquema de autenticación NO es por proveedor (un mismo baseURL sirve a SDKs distintos): el proxy reinyecta la clave real
 * en la cabecera que usó el cliente (ver `buildUpstreamHeaders`).
 *
 * EXCLUIDOS en esta ronda (siguen requiriendo Control total, Chat o Code): inicio de sesión/OAuth (ChatGPT/Codex, Copilot,
 * xAI OAuth, GitLab, SAP), SigV4/IAM (Bedrock), Azure, Vertex y Cloudflare (URL por recurso) y proveedores con variables en la URL.
 */
export const PROVIDER_TARGETS: Record<string, ProviderTarget> = Object.fromEntries(
  Object.entries(GENERATED_PROVIDER_TARGETS).map(([id, t]) => [id, { ...t }])
)

export interface ProviderAuthEntry {
  type: string
  key?: string
  [k: string]: unknown
}

/**
 * Contenido de `OPENCODE_AUTH_CONTENT` del servidor sandboxeado. Lista blanca estricta: solo los
 * proveedores de `PROVIDER_TARGETS` con `key` de texto no vacío, y con una entrada NUEVA
 * `{ type: 'api', key: <centinela aleatorio> }` (no se copia ningún campo de la entrada real).
 * Sin ninguno devuelve `'{}'`.
 */
export function placeholderAuthContent(real: Record<string, ProviderAuthEntry>): string {
  const out: Record<string, ProviderAuthEntry> = {}
  for (const id of Object.keys(PROVIDER_TARGETS)) {
    if (!Object.prototype.hasOwnProperty.call(real ?? {}, id)) continue
    const entry = real[id]
    if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || entry.key.length === 0) continue
    out[id] = { type: 'api', key: `sandboxed-placeholder-${randomBytes(8).toString('hex')}` }
  }
  return JSON.stringify(out)
}

/** `provider.<id>.options.baseURL` para cada proveedor con un `CredentialProxy` activo. */
export function buildProviderOverride(baseUrls: Record<string, string>): Record<string, unknown> {
  const provider: Record<string, unknown> = {}
  for (const [id, baseURL] of Object.entries(baseUrls)) {
    provider[id] = { options: { baseURL } }
  }
  return Object.keys(provider).length ? { provider } : {}
}
