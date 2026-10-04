/**
 * Capacidades que dependen de la plataforma. OnyxCode v1 en Windows cubre Chat, Code, Rutinas en modo
 * Code, Ajustes, cuentas, Diagnóstico, MCP, puntos de restauración/Git y accesibilidad. Quedan solo en
 * macOS (y desactivadas limpiamente en el resto, sin cargar su código): modo Tareas (Seatbelt y proxy
 * de credenciales), Control del PC (helper nativo), actualizador automático (intercambio de la .app).
 * Además existe la superficie `remote` (PWA del celular, F8-B56): la misma interfaz React corriendo en el navegador del
 * celular, sin ventana nativa. Reutiliza este mismo mecanismo de degradación: oculta Control del PC, actualizador, ajustes del
 * propio puente, terminal (pty), diálogos nativos, abrir enlaces/editores del Mac y la vista nativa del navegador. Mac y
 * Windows no cambian: sus cuatro capacidades nuevas son siempre `true`.
 * Puro: sin Electron ni Node, lo pueden importar main y renderer.
 */
export interface PlatformCaps {
  /** Modo Tareas con sandbox (Seatbelt), proxy de credenciales y Rutinas en modo Tareas. */
  tasks: boolean
  /**
   * Aislamiento que usaría Tareas en esta plataforma: `seatbelt` (macOS), `wsl` (Windows, WSL2; fase 1 en
   * preparación, ver docs/WINDOWS-TAREAS.md) o `none`. NO dice si está instalado ni listo (eso es estado de
   * ejecución) ni si `tasks` está activa: en Windows `tasks` sigue en `false` mientras `tasksWin` esté apagada.
   */
  tasksSandbox: TasksSandbox
  /** Control del PC (helper nativo, overlay, grabación de skills). */
  computer: boolean
  /** Actualizador automático que sustituye la aplicación. */
  updater: boolean
  /** El texto de «mantener el equipo despierto» menciona al Mac (solo tiene sentido con Tareas). */
  keepAwakeText: boolean
  /** Control remoto desde el celular (PWA por red local; prototipo, solo macOS). */
  remote: boolean
  /** Terminal integrada (pty + xterm). */
  terminal: boolean
  /** Diálogos nativos del Mac: elegir carpeta/archivos, «Mostrar en Finder», «Abrir en el editor», guardar como…. */
  nativeDialogs: boolean
  /** Abrir enlaces en el navegador del equipo (`app:openExternal`). */
  openExternal: boolean
  /** Vista nativa del navegador integrado (`WebContentsView` sobre la ventana). */
  nativeBrowser: boolean
}

export type TasksSandbox = 'seatbelt' | 'wsl' | 'none'

/** Banderas de producto que modulan las capacidades (todas apagadas por defecto; las lee `main`). */
export interface CapsFlags {
  /** Tareas (beta) en Windows con WSL2. APAGADA hasta pasar la batería de ataques en el PC (docs/WINDOWS-TAREAS.md). */
  tasksWin?: boolean
}

/** Valor de `window.api.platform` en la PWA del celular. */
export const REMOTE_SURFACE = 'remote'

export function capsFor(platform: string, flags: CapsFlags = {}): PlatformCaps {
  if (platform === REMOTE_SURFACE) {
    // Tareas sí (por el puente, acciones peligrosas confirmadas en el Mac); lo demás depende de la ventana nativa del Mac.
    return {
      tasks: true,
      tasksSandbox: 'none',
      computer: false,
      updater: false,
      keepAwakeText: false,
      remote: false,
      terminal: false,
      nativeDialogs: false,
      openExternal: false,
      nativeBrowser: false
    }
  }
  const mac = platform === 'darwin'
  const win = platform === 'win32'
  return {
    tasks: mac || (win && flags.tasksWin === true),
    tasksSandbox: mac ? 'seatbelt' : win ? 'wsl' : 'none',
    computer: mac,
    updater: mac,
    keepAwakeText: mac,
    remote: mac,
    terminal: true,
    nativeDialogs: true,
    openExternal: true,
    nativeBrowser: true
  }
}

/** ¿El modo existe en esta plataforma? Solo Tareas depende de ella. */
export function modeAvailable(mode: string, platform: string): boolean {
  return mode !== 'tasks' || capsFor(platform).tasks
}

/** El modo pedido si está disponible; si no (p. ej. `tasks` guardado desde un Mac), Chat. */
export function usableMode<M extends string>(mode: M, platform: string): M | 'chat' {
  return modeAvailable(mode, platform) ? mode : 'chat'
}
