/**
 * Remitente virtual del celular: hace de `event.sender` (un `WebContents`) para los handlers IPC atados al
 * remitente (pty `isOwner`, `files:watch/setDirs` con el hub por `sender.id`, diálogos con `fromWebContents`)
 * cuando quien llama NO es una ventana. Sin Electron: se prueba solo.
 *
 * - `id` NEGATIVO y único por remitente (los `webContents.id` reales son positivos): la propiedad de un
 *   recurso (terminal, suscripción de archivos) queda limitada a lo creado por ese remitente y nunca
 *   coincide con la de una ventana ni con la de otro celular.
 * - `send(canal, carga)` reenvía por el canal inyectable (el DataChannel, en T4/T5).
 * - `destroy()` marca el remitente como destruido, emite `destroyed` (los handlers liberan lo suyo) y lo
 *   saca del registro.
 * - `on('did-start-navigation' | 'render-process-gone')` existen pero no hacen nada: no hay navegación.
 */
export type RemoteSendFn = (channel: string, ...args: unknown[]) => void

type Listener = (...args: unknown[]) => void

export interface RemoteSender {
  readonly id: number
  readonly isRemote: true
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
  once(event: string, listener: Listener): RemoteSender
  on(event: string, listener: Listener): RemoteSender
  /** Cierra el remitente (desconexión del celular): dispara `destroyed` una sola vez. */
  destroy(): void
}

const registry = new Map<number, RemoteSender>()
let nextId = -1

export function createRemoteSender(sendFn: RemoteSendFn): RemoteSender {
  const id = nextId--
  let destroyed = false
  const onceDestroyed: Listener[] = []
  const sender: RemoteSender = {
    id,
    isRemote: true,
    send(channel, ...args) {
      if (destroyed) return
      try {
        sendFn(channel, ...args)
      } catch {
        /* el canal se cayó: la desconexión llamará a destroy() */
      }
    },
    isDestroyed: () => destroyed,
    once(event, listener) {
      if (event === 'destroyed') {
        if (destroyed) listener()
        else onceDestroyed.push(listener)
      }
      return sender
    },
    on(event, listener) {
      // Eventos de navegación/proceso del renderer: no existen para el celular. Se ignoran a propósito.
      if (event === 'destroyed') return sender.once(event, listener)
      return sender
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      registry.delete(id)
      for (const l of onceDestroyed.splice(0)) {
        try {
          l()
        } catch {
          /* un liberador que falla no impide los demás */
        }
      }
    }
  }
  registry.set(id, sender)
  return sender
}

/** Remitente virtual vivo con ese id (o undefined si es una ventana real / ya se cerró). */
export function getRemoteSender(id: number): RemoteSender | undefined {
  return registry.get(id)
}

export function isRemoteSender(value: unknown): value is RemoteSender {
  return typeof value === 'object' && value !== null && (value as { isRemote?: unknown }).isRemote === true
}
