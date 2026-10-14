/**
 * Lógica sin DOM de los componentes opcionales que se instalan bajo demanda (hoy ArtCraft): megabytes, mensaje humano de cada fallo y
 * el controlador que pide el consentimiento ANTES de llamar a la instalación. Lo usan la tarjeta de Ajustes y el diagnóstico.
 */
import type { MsgKey } from '@shared/i18n'

/** Megabytes redondeados (1 MB = 1e6 bytes, como en la descarga). */
export function officeMb(bytes: number): number {
  return Math.round(Math.max(0, bytes) / 1e6)
}

/** Clave del mensaje humano de un fallo (`disk`, `hash`/`size`, `signature`, `download`, `cancelled`… o genérico). */
export function officeErrorKey(code: string | undefined): MsgKey {
  switch (code) {
    case 'disk':
      return 'settings.craft.error.disk'
    case 'hash':
    case 'size':
      return 'settings.craft.error.hash'
    case 'signature':
      return 'settings.craft.error.signature'
    case 'download':
      return 'settings.craft.error.download'
    case 'cancelled':
      return 'settings.craft.error.cancelled'
    default:
      return 'settings.craft.error.generic'
  }
}

/**
 * Código del fallo de una instalación para mostrar su motivo (Bienvenida y asistente). Si la llamada ni siquiera respondió
 * (`undefined`, IPC caído) o no trae código, `download`; así nunca se queda en un «falló» sin explicación.
 */
export function installFailureCode(r: { ok: boolean; error?: string } | undefined): string | undefined {
  if (r?.ok) return undefined
  return r?.error || 'download'
}

export type InstallResult = { ok: true } | { ok: false; error: string; message?: string }

export interface ComponentApi<S> {
  status: () => Promise<S>
  install: () => Promise<InstallResult>
  cancel: () => Promise<void>
  remove: () => Promise<void>
}

export type InstallOutcome = { kind: 'declined' } | { kind: 'installed' } | { kind: 'failed'; error: string }

/**
 * Acciones de la tarjeta. `install` pide el consentimiento ANTES de llamar a `api.install`: si se rechaza no se descarga nada.
 * `onStart` se invoca justo cuando la instalación arranca (tras confirmar).
 */
export function officeController<S>(api: ComponentApi<S>, confirm: (mb: number) => Promise<boolean>) {
  return {
    status: () => api.status(),
    async install(mb: number, onStart?: () => void): Promise<InstallOutcome> {
      if (!(await confirm(mb))) return { kind: 'declined' }
      onStart?.()
      const r = await api.install()
      return r.ok ? { kind: 'installed' } : { kind: 'failed', error: r.error }
    },
    cancel: () => api.cancel(),
    remove: () => api.remove()
  }
}
