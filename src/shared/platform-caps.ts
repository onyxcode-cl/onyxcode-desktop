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
  /** Control remoto desde el celular (PWA por red local; prototipo, solo macOS). */
  remote: boolean
}

export function capsFor(platform: string): PlatformCaps {
  const mac = platform === 'darwin'
  return { tasks: mac, computer: mac, updater: mac, keepAwakeText: mac, remote: mac }
}

/** ¿El modo existe en esta plataforma? Solo Tareas depende de ella. */
export function modeAvailable(mode: string, platform: string): boolean {
  return mode !== 'tasks' || capsFor(platform).tasks
}

/** El modo pedido si está disponible; si no (p. ej. `tasks` guardado desde un Mac), Chat. */
export function usableMode<M extends string>(mode: M, platform: string): M | 'chat' {
  return modeAvailable(mode, platform) ? mode : 'chat'
}
