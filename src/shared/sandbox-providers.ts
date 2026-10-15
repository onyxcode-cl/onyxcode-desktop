/**
 * Proveedores de modelos disponibles en Tareas CON sandbox. El servidor sandboxeado solo recibe los proveedores con
 * clave de API de `PROVIDER_TARGETS` (clave centinela + proxy de credenciales en main, ver `main/tasks/provider-egress.ts`);
 * el resto (OAuth, nube) no se le pasan. Los ids salen de la misma tabla generada que usa `main`
 * (`shared/provider-targets.generated.ts`); `provider-egress.sync.test.ts` vigila que sigan coincidiendo.
 * `opencode` son los modelos gratuitos de OpenCode, que el motor ofrece sin clave. Lógica pura compartida por main y renderer.
 */
import { t } from './i18n'
import { GENERATED_PROVIDER_TARGETS } from './provider-targets.generated'

export const SANDBOX_PROVIDER_IDS: readonly string[] = [...Object.keys(GENERATED_PROVIDER_TARGETS), 'opencode']

/** Aviso en el idioma activo. */
export const sandboxProviderNotice = (): string => t('tasks.sandboxProviderNotice')

/** Aviso si el modelo elegido no está disponible en Tareas con sandbox; si no, null. */
export function sandboxModelNotice(sandboxed: boolean, providerID: string): string | null {
  if (!sandboxed) return null
  return SANDBOX_PROVIDER_IDS.includes(providerID) ? null : sandboxProviderNotice()
}

/**
 * Al enviar: `available` son los proveedores que el servidor sandboxeado dice tener (o null si no se
 * pudo consultar: entonces no se bloquea y responde el propio servidor).
 */
export function sandboxSendBlocked(available: readonly string[] | null, providerID: string): string | null {
  if (!available) return null
  if (available.includes(providerID)) return null
  // Un proveedor que el sandbox SÍ admite pero su servidor aún no tiene: se conectó después de arrancar (lee las credenciales una vez).
  if (SANDBOX_PROVIDER_IDS.includes(providerID)) return sandboxProviderPendingNotice()
  return sandboxProviderNotice()
}

/** Aviso: el proveedor es admitido, pero aún no llegó al entorno aislado de esta tarea. */
export const sandboxProviderPendingNotice = (): string => t('tasks.sandboxProviderPending')
