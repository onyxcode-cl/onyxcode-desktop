/**
 * Proveedores de modelos disponibles en Tareas CON sandbox. El servidor sandboxeado solo recibe
 * OpenCode Go (clave centinela + proxy de credenciales en main, ver `main/tasks/provider-egress.ts`);
 * el resto de proveedores no se le pasan.
 * `opencode` son los modelos gratuitos de OpenCode, que el motor ofrece sin clave. Lógica pura compartida por main y renderer.
 */
export const SANDBOX_PROVIDER_IDS: readonly string[] = ['opencode-go', 'opencode']

export const SANDBOX_PROVIDER_NOTICE =
  'En Tareas con sandbox solo está disponible OpenCode Go (y los modelos gratuitos de OpenCode). Para otros proveedores usa Control total, Chat o Code.'

/** Aviso en español si el modelo elegido no está disponible en Tareas con sandbox; si no, null. */
export function sandboxModelNotice(sandboxed: boolean, providerID: string): string | null {
  if (!sandboxed) return null
  return SANDBOX_PROVIDER_IDS.includes(providerID) ? null : SANDBOX_PROVIDER_NOTICE
}

/**
 * Al enviar: `available` son los proveedores que el servidor sandboxeado dice tener (o null si no se
 * pudo consultar: entonces no se bloquea y responde el propio servidor).
 */
export function sandboxSendBlocked(available: readonly string[] | null, providerID: string): string | null {
  if (!available) return null
  return available.includes(providerID) ? null : SANDBOX_PROVIDER_NOTICE
}
