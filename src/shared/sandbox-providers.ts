/**
 * Proveedores de modelos disponibles en Tareas CON sandbox. El servidor sandboxeado solo recibe
 * OpenCode Go (clave centinela + proxy de credenciales en main, ver `main/tasks/provider-egress.ts`);
 * el resto de proveedores no se le pasan. Lógica pura compartida por main y renderer.
 */
export const SANDBOX_PROVIDER_IDS: readonly string[] = ['opencode-go']

export const SANDBOX_PROVIDER_NOTICE =
  'En Tareas con sandbox solo está disponible OpenCode Go. Para otros proveedores usa Control total, Chat o Code.'

/** Aviso en español si el modelo elegido no está disponible en Tareas con sandbox; si no, null. */
export function sandboxModelNotice(sandboxed: boolean, providerID: string): string | null {
  if (!sandboxed) return null
  return SANDBOX_PROVIDER_IDS.includes(providerID) ? null : SANDBOX_PROVIDER_NOTICE
}
