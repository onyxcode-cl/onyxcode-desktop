import { createContext } from 'react'

/**
 * Puente entre los bloques de código de las respuestas (`Markdown`) y la terminal interna de Code. Solo Code de escritorio lo
 * provee (`ShellRunProvider`): Chat, Tareas, Overdrive y el celular no tienen proveedor y, sin él, el botón «Ejecutar» no existe.
 * Así `Markdown` no importa xterm ni el almacén de Code.
 */
export type ShareState = 'pending' | 'sent' | 'queued' | 'attached' | 'blocked-secret' | 'empty'

export interface ShellRunSnapshot {
  /** Últimas líneas de la salida (sin ANSI ni claves). */
  lines: string[]
  lineCount: number
  status: 'running' | 'done' | 'waiting'
  waitKind: 'password' | 'answer' | null
  /** Qué pasó con el envío a la IA. */
  share: ShareState
  /** Interruptor «Compartir con la IA» de esta ejecución. */
  shareOn: boolean
}

/** Una ejecución con ▶: su salida en vivo y su envío a la IA. */
export interface ShellRunHandle {
  subscribe(cb: () => void): () => void
  getSnapshot(): ShellRunSnapshot
  setShareOn(on: boolean): void
  /** «Enviar a la IA ahora»: camino alternativo cuando el interruptor está apagado. */
  sendNow(): void
}

export interface ShellRunner {
  /** Escribe las líneas (cada una con Enter) en la terminal del proyecto. `null` si la terminal está ocupada con una ejecución anterior. */
  run(lines: string[]): ShellRunHandle | null
  /** La ejecución anterior de estas mismas líneas (el mensaje se vuelve a pintar y la tarjeta de salida debe conservarse). */
  find(lines: string[]): ShellRunHandle | null
  /** Abre el panel de terminal y le da el foco. */
  showTerminal(): void
}

export const ShellRunContext = createContext<ShellRunner | null>(null)
