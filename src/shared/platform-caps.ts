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
  /**
   * «Vista rápida» de archivos (`qlmanage`) en Tareas. Solo macOS: en Windows es `false` y no hay botón. Lo consume
   * `Deliverables.tsx` (botón «Vista rápida» de los entregables).
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
   * el celular no existe. La disponibilidad de ArtCraft se detecta en tiempo de
   * ejecución, no va acá.
   */
  docViewer: boolean
  /**
   * Traducir un PDF sin cambiar su diseño (F8-B200): usa el Python incluido con PyMuPDF, que hoy solo viaja en macOS. En el celular
   * no existe (necesita la ventana nativa) y en Windows queda apagada hasta que el paquete incluya Python.
   */
  translatePdf: boolean
}

export type TasksSandbox = 'seatbelt' | 'wsl' | 'none'

export type ComputerBackend = 'ax' | 'uia' | 'none'

/** Banderas de producto que modulan las capacidades (todas apagadas por defecto; las lee `main`). */
export interface CapsFlags {
  /**
   * Tareas en Windows con WSL2. Encendida en la compilación (`TASKS_WIN_BUILD = true`); la bandera efectiva la resuelve
   * `src/main/tasks/tasks-win-flag.ts`, que también respeta la política `disableWslTasks` (docs/WINDOWS-TAREAS.md).
   */
  tasksWin?: boolean
  /**
   * Control del PC en Windows (UI Automation). Sin interruptor propio: exige `tasksWin` (Control total es un modo de
   * Tareas) y que `cu-helper.exe` esté presente (`src/main/computer/computer-win-flag.ts`): `computer = win && tasksWin && computerWin`.
   */
  computerWin?: boolean
  /**
   * Control remoto desde el celular en Windows. Encendida en la compilación (`REMOTE_WIN_BUILD = true`, desde 2026-10-07; la resuelve
   * `src/main/remote/remote-win-flag.ts`, que respeta la política `blocked`). No depende de `tasksWin` (el remoto expone Chat y Code; Tareas solo si existe).
   */
  remoteWin?: boolean
  /** La ventana puede ser translúcida (vibrancy en macOS, Mica/Acrylic en Windows 11). Solo adorno: la resuelve `main`. */
  glass?: boolean
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
      quickLook: false,
      remote: false,
      terminal: false,
      nativeDialogs: false,
      openExternal: false,
      nativeBrowser: false,
      docViewer: false,
      translatePdf: false
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
    quickLook: mac,
    remote: mac || (win && flags.remoteWin === true),
    terminal: true,
    nativeDialogs: true,
    openExternal: true,
    nativeBrowser: true,
    docViewer: mac || (win && flags.tasksWin === true),
    translatePdf: mac
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
