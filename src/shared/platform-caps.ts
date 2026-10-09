/**
 * Capacidades que dependen de la plataforma. Lazunox v1 en Windows cubre Chat, Code, Rutinas en modo
 * Code, Ajustes, cuentas, Diagnóstico, MCP, puntos de restauración/Git y accesibilidad. Quedan solo en
 * macOS (y desactivadas limpiamente en el resto, sin cargar su código): modo Tareas (Seatbelt y proxy
 * de credenciales), Control del PC (helper nativo), actualizador automático en su versión de macOS (intercambio de la .app; el de Windows cambia la carpeta de instalación y solo actúa en instalaciones por usuario, `src/main/update/swap-win.ts`).
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
  /**
   * Backend de Control del PC: `ax` (macOS, Accesibilidad), `uia` (Windows, UI Automation; solo con `computer`) o
   * `none`. Derivado de `computer`: nunca es distinto de `none` si `computer` es false.
   */
  computerBackend: ComputerBackend
  /** Actualizador automático que sustituye la aplicación. */
  updater: boolean
  /** El texto de «mantener el equipo despierto» menciona al Mac (solo tiene sentido con Tareas). */
  keepAwakeText: boolean
  /**
   * «Vista rápida» de archivos (`qlmanage`) en Tareas. Solo macOS: en Windows no se activa con `tasksWin`
   * (la tanda W6 la responde con PLATFORM_UNSUPPORTED). Campo nuevo, sin consumidores todavía.
   */
  quickLook: boolean
  /**
   * Control remoto desde el celular (PWA por red local). macOS siempre; Windows solo con la bandera `remoteWin` (apagada por
   * defecto, docs/REMOTO-WINDOWS.md).
   */
  remote: boolean
  /** Terminal integrada (pty + xterm). */
  terminal: boolean
  /** Diálogos nativos del Mac: elegir carpeta/archivos, «Mostrar en Finder», «Abrir en el editor», guardar como…. */
  nativeDialogs: boolean
  /** Abrir enlaces en el navegador del equipo (`app:openExternal`). */
  openExternal: boolean
  /** Vista nativa del navegador integrado (`WebContentsView` sobre la ventana). */
  nativeBrowser: boolean
  /**
   * Visor de documentos de Tareas (PDF/Word/Excel/PowerPoint, `WebContentsView` aislada). Mac y
   * Windows siempre que haya Tareas (depende de la ventana nativa, igual que `nativeBrowser`); en
   * el celular no existe. La disponibilidad de LibreOffice (Fase 5) se detecta en tiempo de
   * ejecución, no va acá.
   */
  docViewer: boolean
}

export type TasksSandbox = 'seatbelt' | 'wsl' | 'none'

export type ComputerBackend = 'ax' | 'uia' | 'none'

/** Banderas de producto que modulan las capacidades (todas apagadas por defecto; las lee `main`). */
export interface CapsFlags {
  /** Tareas (beta) en Windows con WSL2. APAGADA hasta pasar la batería de ataques en el PC (docs/WINDOWS-TAREAS.md). */
  tasksWin?: boolean
  /**
   * Control del PC en Windows (UI Automation). APAGADA hasta pasar S1–S15 en el PC (plan win-C). Además exige
   * `tasksWin` (Control total es un modo de Tareas): `computer = win && tasksWin && computerWin`.
   */
  computerWin?: boolean
  /**
   * Control remoto desde el celular en Windows. APAGADA hasta que el dueño lo pruebe en el PC (docs/REMOTO-WINDOWS.md). La
   * resuelve `src/main/remote/remote-win-flag.ts`; no depende de `tasksWin` (el remoto expone Chat y Code; Tareas solo si existe).
   */
  remoteWin?: boolean
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
      computerBackend: 'none',
      updater: false,
      keepAwakeText: false,
      quickLook: false,
      remote: false,
      terminal: false,
      nativeDialogs: false,
      openExternal: false,
      nativeBrowser: false,
      docViewer: false
    }
  }
  const mac = platform === 'darwin'
  const win = platform === 'win32'
  const computer = mac || (win && flags.tasksWin === true && flags.computerWin === true)
  return {
    tasks: mac || (win && flags.tasksWin === true),
    tasksSandbox: mac ? 'seatbelt' : win ? 'wsl' : 'none',
    computer,
    computerBackend: !computer ? 'none' : mac ? 'ax' : 'uia',
    // macOS: intercambio de la .app. Windows: aviso siempre y, si `installConfig.enabled` (src/main/update/config.ts), intercambio
    // de la carpeta por usuario. La build de la Store lo apaga en `main/index.ts` (process.windowsStore).
    updater: mac || win,
    keepAwakeText: mac,
    quickLook: mac,
    remote: mac || (win && flags.remoteWin === true),
    terminal: true,
    nativeDialogs: true,
    openExternal: true,
    nativeBrowser: true,
    docViewer: mac || (win && flags.tasksWin === true)
  }
}

/** ¿El modo existe en esta plataforma? Solo Tareas depende de ella. */
export function modeAvailable(mode: string, platform: string, flags: CapsFlags = {}): boolean {
  return mode !== 'tasks' || capsFor(platform, flags).tasks
}

/** El modo pedido si está disponible; si no (p. ej. `tasks` guardado desde un Mac), Chat. */
export function usableMode<M extends string>(mode: M, platform: string, flags: CapsFlags = {}): M | 'chat' {
  return modeAvailable(mode, platform, flags) ? mode : 'chat'
}
