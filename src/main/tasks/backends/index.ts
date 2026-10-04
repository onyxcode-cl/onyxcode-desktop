/**
 * Selección del backend de aislamiento. Hoy solo Seatbelt (macOS con `sandbox-exec`) o ninguno.
 * El backend WSL (`wsl.ts`) NO se enlaza aquí a propósito: Tareas en Windows sigue desactivado
 * (`capsFor('win32').tasks === false`) hasta que el dueño lo autorice tras las pruebas en el PC.
 */
import { noneBackend } from './none'
import { seatbeltAvailable, seatbeltBackend } from './seatbelt'
import type { SandboxBackend } from './types'

export function selectBackend(platform: string = process.platform): SandboxBackend {
  if (platform === 'darwin' && seatbeltAvailable()) return seatbeltBackend
  return noneBackend
}
