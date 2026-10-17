/** Lógica pura de Personalización (sin React): estado de cada ficha y filtros. Probada en `logic.test.ts`. */
import type { McpStatus } from '@opencode-ai/sdk/v2/client'
import type { AppMcpConfig } from '@shared/ipc-extras'
import type { CatalogGroup, CatalogConnector } from '@shared/catalogo'

/**
 * Estado de un conector para la persona (una ficha del catálogo):
 *  - `none`: no está añadido;
 *  - `connected`: añadido y funcionando;
 *  - `needs-login`: añadido, pero falta iniciar sesión en el servicio;
 *  - `off`: añadido y apagado;
 *  - `problem`: añadido pero no responde.
 */
export type ConnectorState = 'none' | 'connected' | 'needs-login' | 'off' | 'problem'

export function connectorState(server: string | null, cfg: AppMcpConfig | null, status: Record<string, McpStatus>): ConnectorState {
  if (!server) return 'none'
  const entry = cfg?.servers[server]
  const st = status[server]
  if (st?.status === 'connected') return 'connected'
  if (st?.status === 'needs_auth' || st?.status === 'needs_client_registration') return 'needs-login'
  if (st?.status === 'failed') return 'problem'
  if (st?.status === 'disabled' || (entry && entry.enabled === false)) return 'off'
  // Añadido y encendido pero el motor aún no informó: no se afirma que esté conectado.
  return entry ? 'off' : 'none'
}

/** Solo «Conectado» cuenta como conectado; todo lo demás es «No conectado» (con su motivo aparte). */
export const isConnected = (s: ConnectorState): boolean => s === 'connected'

/** Grupos con al menos una ficha (los vacíos se ocultan), en el orden del catálogo. */
export function visibleGroups<T extends { group: string }>(
  groups: readonly CatalogGroup[],
  items: readonly T[]
): Array<{ group: CatalogGroup; items: T[] }> {
  return groups.map((group) => ({ group, items: items.filter((i) => i.group === group.id) })).filter((g) => g.items.length > 0)
}

export type SkillTag = 'included' | 'installed' | 'install'

/** Etiqueta de la tarjeta de una habilidad. */
export function skillTag(kind: 'bundled' | 'user' | 'available'): SkillTag {
  return kind === 'bundled' ? 'included' : kind === 'user' ? 'installed' : 'install'
}

/** Qué pide un conector para conectarse, en una clave de texto. */
export function authKey(c: Pick<CatalogConnector, 'auth'>): 'pers.auth.none' | 'pers.auth.token' | 'pers.auth.oauth' {
  return c.auth === 'oauth' ? 'pers.auth.oauth' : c.auth === 'token' ? 'pers.auth.token' : 'pers.auth.none'
}

export function formatBytes(n: number, locale: string): string {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kb)} KB`
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kb / 1024)} MB`
}
