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
  /** Pestaña de la terminal donde corre esta ejecución. */
  readonly tabId?: string
  subscribe(cb: () => void): () => void
  getSnapshot(): ShellRunSnapshot
  setShareOn(on: boolean): void
  /** «Enviar a la IA ahora»: camino alternativo cuando el interruptor está apagado. */
  sendNow(): void
}

export interface ShellRunner {
  /**
   * Escribe las líneas (cada una con Enter) en la pestaña seleccionada de la terminal del proyecto, o en una pestaña nueva con
   * `newTab`. `null` si esa pestaña está ocupada con una ejecución anterior (o ya no caben más pestañas).
   */
  run(lines: string[], opts?: { newTab?: boolean }): ShellRunHandle | null
  /** La ejecución anterior de estas mismas líneas (el mensaje se vuelve a pintar y la tarjeta de salida debe conservarse). */
  find(lines: string[]): ShellRunHandle | null
  /** Abre el panel de terminal (en la pestaña indicada, si se da) y le da el foco. */
  showTerminal(tabId?: string): void
}

export const ShellRunContext = createContext<ShellRunner | null>(null)
