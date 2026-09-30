/**
 * Mapa de proveedores de modelos → destino real (para `CredentialProxy`) y overrides de config
 * de OpenCode que apuntan el `baseURL` del proveedor al proxy de credenciales local.
 *
 * Solo se lista lo que el sandbox de Tareas puede usar; hoy: OpenCode Go/Zen (`opencode-go`,
 * `api: https://opencode.ai/zen/go/v1`, verificado contra el binario `opencode` 1.18.32).
 *
 * Política de credenciales del servidor SANDBOXEADO (falla cerrado):
 * - OpenCode Go con `key`: la clave real vive solo en un `CredentialProxy` del proceso main (fuera
 *   del sandbox); el servidor recibe en `OPENCODE_AUTH_CONTENT` una clave centinela aleatoria.
 * - Todo lo demás del `auth.json` del usuario (otros proveedores, OAuth, entradas sin `key`,
 *   cualquier otro campo) se OMITE: el servidor sandboxeado no lo recibe, así que esos proveedores
 *   no están disponibles en Tareas con sandbox. Nunca se pasa un secreto real por entorno.
 * Fuera de este caso (Control total, Chat, Code) no hay aislamiento de credenciales: el motor lee
 * el `auth.json` como haría el CLI.
 */
import { randomBytes } from 'node:crypto'

export interface ProviderTarget {
  /** Host real (para la lista blanca del proxy de egress; el credential-proxy no la necesita,
   * conecta directo desde el proceso main, sin sandbox). */
  host: string
  origin: string
  pathPrefix: string
  /** Esquema de autorización real: 'bearer' → `Authorization: Bearer <key>`. */
  auth: 'bearer'
}

export const PROVIDER_TARGETS: Record<string, ProviderTarget> = {
  'opencode-go': {
    host: 'opencode.ai',
    origin: 'https://opencode.ai',
    pathPrefix: '/zen/go/v1',
    auth: 'bearer'
  }
}

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
