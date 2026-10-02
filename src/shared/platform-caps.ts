/**
 * Capacidades que dependen de la plataforma. OnyxCode v1 en Windows cubre Chat, Code, Rutinas en modo
 * Code, Ajustes, cuentas, Diagnóstico, MCP, puntos de restauración/Git y accesibilidad. Quedan solo en
 * macOS (y desactivadas limpiamente en el resto, sin cargar su código): modo Tareas (Seatbelt y proxy
 * de credenciales), Control del PC (helper nativo), actualizador automático (intercambio de la .app).
 * Puro: sin Electron ni Node, lo pueden importar main y renderer.
 */
export interface PlatformCaps {
  /** Modo Tareas con sandbox (Seatbelt), proxy de credenciales y Rutinas en modo Tareas. */
  tasks: boolean
  /** Control del PC (helper nativo, overlay, grabación de skills). */
  computer: boolean
  /** Actualizador automático que sustituye la aplicación. */
  updater: boolean
  /** El texto de «mantener el equipo despierto» menciona al Mac (solo tiene sentido con Tareas). */
  keepAwakeText: boolean
}

export function capsFor(platform: string): PlatformCaps {
  const mac = platform === 'darwin'
  return { tasks: mac, computer: mac, updater: mac, keepAwakeText: mac }
}
