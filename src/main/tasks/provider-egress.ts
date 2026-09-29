/**
 * Mapa de proveedores de modelos → destino real (para `CredentialProxy`) y overrides de config
 * de OpenCode que apuntan el `baseURL` del proveedor al proxy de credenciales local.
 *
 * Solo se necesita listar los proveedores que el sandbox puede usar; hoy: OpenCode Go/Zen
 * (`opencode-go`, `env: OPENCODE_API_KEY`, `api: https://opencode.ai/zen/go/v1`, verificado
 * contra el binario `opencode` 1.18.32 instalado — `strings` sobre el bundle). Si el usuario
 * configura otro proveedor con otra clave, el servidor sandboxeado simplemente no la recibirá
 * (mejor fallar cerrado que filtrarla): solo se reescriben los proveedores de esta tabla.
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

/** Contenido centinela para `OPENCODE_AUTH_CONTENT`: mismos proveedores, clave SIN valor real. */
export function placeholderAuthContent(real: Record<string, ProviderAuthEntry>): string {
  const out: Record<string, ProviderAuthEntry> = {}
  for (const [id, entry] of Object.entries(real)) {
    if (PROVIDER_TARGETS[id] && entry.key) {
      out[id] = { ...entry, key: `sandboxed-placeholder-${randomBytes(8).toString('hex')}` }
    } else {
      out[id] = entry
    }
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
