/**
 * Selección del agente `computer` por plataforma (plan win-C, tanda C6). PURO: solo `node:fs`, sin Electron.
 *
 * OpenCode carga el agente por su id (`computer`) desde `<configDir>/agents/computer.md`. En macOS ese archivo es el del
 * bundle y NO se toca. `computer.win.md` vive en `resources/opencode/agents-win/` (fuera de `agents/`, que se copia entera a userData). En Windows, y SOLO con Control del PC activo (`computerWin` y `tasksWin`), `computer.md` se
 * sustituye por el contenido de `computer.win.md`; con la función apagada se restaura el de macOS (que es el que copia
 * `prepareOpencodeConfigDir`). `computer.win.md` nunca debe quedar como agente propio (`computer.win`): si alguien lo copió al destino, se borra.
 */
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const COMPUTER_AGENT_FILE = 'computer.md'
export const COMPUTER_WIN_AGENT_FILE = 'computer.win.md'

export interface ComputerAgentOptions {
  platform: NodeJS.Platform
  /** `computerWin && tasksWin` efectivos. Todo lo que no sea `true` cuenta como apagado. */
  enabled: boolean | undefined
  /** `<userData>/opencode-config/agents` (destino que lee OpenCode). */
  agentsDest: string
  /** Carpetas con `computer.md` (el agente de macOS) del bundle, por orden de preferencia: `resources/opencode/agents`. */
  bundledAgentsDirs: string[]
  /** Carpetas con `computer.win.md`, por orden de preferencia: `resources/opencode/agents-win` del bundle y del paquete. */
  bundledWinAgentsDirs: string[]
}

/** Archivo del bundle que debe ser el agente `computer` en esa plataforma. */
export function computerAgentSourceFile(platform: NodeJS.Platform, enabled: boolean | undefined): string {
  return platform === 'win32' && enabled === true ? COMPUTER_WIN_AGENT_FILE : COMPUTER_AGENT_FILE
}

function findBundled(dirs: string[], file: string): string | null {
  for (const d of dirs) {
    const p = join(d, file)
    if (existsSync(p)) return p
  }
  return null
}

function sameContent(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

/**
 * Deja en `agentsDest/computer.md` el agente que corresponde. Devuelve el archivo del bundle usado, o `null` si no hizo
 * nada (macOS, u otra plataforma, o el bundle no trae el archivo: entonces NO se toca nada y se conserva lo que haya).
 */
export function applyComputerAgent(opts: ComputerAgentOptions): string | null {
  // macOS y el resto: sin cambios (ni siquiera se limpia nada).
  if (opts.platform !== 'win32') return null
  // Nunca un agente `computer.win` suelto en el destino.
  rmSync(join(opts.agentsDest, COMPUTER_WIN_AGENT_FILE), { force: true })
  const file = computerAgentSourceFile(opts.platform, opts.enabled)
  // Apagado: `computer.md` (el de macOS) viene del bundle; con la función encendida, `computer.win.md`. Si falta, falla cerrado:
  // con la función encendida y sin el agente de Windows NO se deja el de macOS (habla de Mac, Seatbelt y ⌘).
  const src = findBundled(file === COMPUTER_WIN_AGENT_FILE ? opts.bundledWinAgentsDirs : opts.bundledAgentsDirs, file)
  const dest = join(opts.agentsDest, COMPUTER_AGENT_FILE)
  if (!src) {
    if (opts.enabled === true) rmSync(dest, { force: true })
    return null
  }
  if (!existsSync(dest) || !sameContent(src, dest)) copyFileSync(src, dest)
  return file
}
