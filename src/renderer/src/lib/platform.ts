/**
 * Plataforma del proceso principal para el renderer (`window.api.platform`, ya expuesto por el preload) y las
 * capacidades que dependen de ella (`shared/platform-caps`). Tolerante a que `window.api` no exista (pruebas).
 */
import { capsFor, type PlatformCaps } from '@shared/platform-caps'

export function currentPlatform(): string {
  try {
    const api = (globalThis as { window?: { api?: { platform?: string } } }).window?.api
    return typeof api?.platform === 'string' ? api.platform : 'darwin'
  } catch {
    return 'darwin'
  }
}

export const isMacPlatform = (): boolean => currentPlatform() === 'darwin'
export const isWindowsPlatform = (): boolean => currentPlatform() === 'win32'
export const platformCaps = (): PlatformCaps => capsFor(currentPlatform())
