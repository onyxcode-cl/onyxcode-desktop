/**
 * Diálogo de botones del sistema que NO congela la app.
 *
 * `dialog.showMessageBox` sin ventana padre se ejecuta en macOS dentro de `-[NSAlert runModal]`: mientras está abierto, el bucle de eventos
 * de Node (temporizadores, servidor HTTP del canal lateral, IPC) queda DETENIDO. Medido en vivo: con un permiso de sitio esperando y la
 * ventana principal minimizada (Control total), el aviso de «espera» de 12 s nunca saltó, el control de parada dejó de responder y el agente
 * entró en un bucle de reintentos. Aquí en macOS el diálogo lo muestra `osascript` en un PROCESO APARTE, así que la app sigue viva; en el
 * resto de plataformas (o si `osascript` falla) se usa el diálogo de Electron de siempre.
 *
 * Los textos viajan como ARGUMENTOS (`argv`), nunca dentro del script: una URL con comillas no puede inyectar AppleScript.
 */
import { execFile } from 'node:child_process'
import { dialog } from 'electron'
import { DISPLAY_NAME } from '@shared/brand'

export interface ButtonsDialog {
  message: string
  detail?: string
  /** 2 o 3 botones (límite de `display dialog`), con nombres distintos. */
  buttons: string[]
  /** Índice del botón por defecto (el de Return). Debe ser el SEGURO. */
  defaultIndex?: number
  /** Qué índice cuenta cuando se cierra sin elegir (Esc, tiempo agotado). */
  cancelIndex?: number
}

/** Tiempo tras el cual el diálogo se cierra solo y cuenta como «cancelar» (alineado con el tope de 10 min de las aprobaciones). */
const GIVE_UP_SECONDS = 600

/** Script fijo: lo único que cambia son los argumentos. Devuelve el nombre del botón o `__cancel__`. */
export const APPLESCRIPT = [
  'on run argv',
  '  set theTitle to item 1 of argv',
  '  set theText to item 2 of argv',
  '  set theDefault to item 3 of argv',
  '  set theSeconds to (item 4 of argv) as integer',
  '  set theButtons to items 5 thru -1 of argv',
  '  try',
  '    set r to display dialog theText with title theTitle buttons theButtons default button theDefault with icon caution giving up after theSeconds',
  '    if (gave up of r) then return "__cancel__"',
  '    return button returned of r',
  '  on error number -128',
  '    return "__cancel__"',
  '  end try',
  'end run'
].flatMap((l) => ['-e', l])

export type RunOsascript = (args: string[]) => Promise<string>

const realRun: RunOsascript = (args) =>
  new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', args, { timeout: (GIVE_UP_SECONDS + 30) * 1000, maxBuffer: 64 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout).trim())
    )
  })

/** Muestra el diálogo y devuelve el ÍNDICE del botón elegido (o `cancelIndex` si se cerró sin elegir). */
export async function askButtons(
  d: ButtonsDialog,
  opts: { platform?: string; run?: RunOsascript; electronDialog?: Pick<typeof dialog, 'showMessageBox'> } = {}
): Promise<number> {
  const defaultIndex = d.defaultIndex ?? 0
  const cancelIndex = d.cancelIndex ?? 0
  const platform = opts.platform ?? process.platform
  const unique = new Set(d.buttons).size === d.buttons.length && d.buttons.length >= 2 && d.buttons.length <= 3
  if (platform === 'darwin' && unique) {
    try {
      const text = d.detail ? `${d.message}\n\n${d.detail}` : d.message
      const out = await (opts.run ?? realRun)([
        ...APPLESCRIPT,
        '--',
        DISPLAY_NAME,
        text,
        d.buttons[defaultIndex],
        String(GIVE_UP_SECONDS),
        ...d.buttons
      ])
      if (out === '__cancel__') return cancelIndex
      const i = d.buttons.indexOf(out)
      return i >= 0 ? i : cancelIndex
    } catch (err) {
      console.error('[native-dialog] osascript falló; se usa el diálogo de Electron:', err instanceof Error ? err.message : err)
    }
  }
  const res = await (opts.electronDialog ?? dialog).showMessageBox({
    type: 'warning',
    message: d.message,
    detail: d.detail,
    buttons: d.buttons,
    defaultId: defaultIndex,
    cancelId: cancelIndex,
    noLink: true
  })
  return res.response
}
