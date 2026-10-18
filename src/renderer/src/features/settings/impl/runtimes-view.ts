/**
 * Lógica sin DOM de Node.js y uv de la app (F8-B195): mensaje humano de cada fallo y llamadas a main que comparten la tarjeta de Ajustes,
 * la preparación inicial («Preparando Lazunox», «Prepara tu equipo») y la ficha de los conectores locales.
 */
import type { MsgKey } from '@shared/i18n'
import type { RuntimesInstallResult, RuntimesSnapshot } from '@shared/runtimes'
import { cw } from '../../tasks/impl/bridge'

/** Clave del mensaje humano de un fallo de la descarga de Node.js y uv. Nunca devuelve «falló» sin explicación. */
export function runtimesErrorKey(code: string | undefined): MsgKey {
  switch (code) {
    case 'disk':
      return 'settings.runtimes.error.disk'
    case 'permission':
      return 'settings.runtimes.error.permission'
    case 'offline':
      return 'settings.runtimes.error.offline'
    case 'hash':
      return 'settings.runtimes.error.hash'
    case 'unsafe':
    case 'broken':
      return 'settings.runtimes.error.unsafe'
    case 'cancelled':
      return 'settings.runtimes.error.cancelled'
    case 'unsupported':
      return 'settings.runtimes.error.unsupported'
    case 'download':
    case 'io':
      return 'settings.runtimes.error.download'
    default:
      return 'settings.runtimes.error.generic'
  }
}

export const runtimesApi = {
  status: () => cw('runtimes:status') as Promise<RuntimesSnapshot>,
  install: () => cw('runtimes:install') as Promise<RuntimesInstallResult>,
  cancel: () => cw('runtimes:cancel') as Promise<void>,
  remove: () => cw('runtimes:remove') as Promise<void>
}

/** Porcentaje de la descarga en curso (0–100), o `null` si no se conoce. */
export function runtimesPct(s: RuntimesSnapshot): number | null {
  const total = s.progress?.total ?? 0
  return s.installing && total > 0 ? Math.min(100, Math.round(((s.progress?.done ?? 0) / total) * 100)) : null
}
