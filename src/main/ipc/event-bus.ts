/**
 * Bus de eventos main → (ventanas | celular). Único sitio que hace `webContents.send` de eventos de la app.
 *
 * - `publish(canal, carga)`: a TODAS las ventanas (mismos canales y cargas que antes, mismo orden) y a los
 *   suscriptores remotos. Los remotos reciben aunque no quede ninguna ventana abierta.
 * - `publishTo(destino, canal, carga)`: a ventanas concretas (principal, «Navegador» aparte…). Es un envío
 *   dirigido a una ventana: NO llega a los suscriptores remotos.
 * - `subscribeRemote`: cada suscriptor declara su lista blanca (`channels`; sin ella no recibe nada) y puede
 *   recortar la carga (`trim`, devolver null = descartar) antes de salir del equipo.
 * - Sin carga (`undefined`) se envía sin argumentos, como hacían los eventos `void` de extras.
 */
import { BrowserWindow, webContents as electronWebContents, type WebContents } from 'electron'
import type { IpcEventContract } from '@shared/ipc'
import type { IpcExtrasEventContract } from '@shared/ipc-extras'
import type { BrowserEventContract } from '@shared/ipc-browser'
import type { CodeEventContract } from '@shared/ipc-code'
import type { RemoteEventContract } from '@shared/ipc-remote'
import type { TasksEventContract } from '@shared/ipc-tasks'
import { getRemoteSender } from '../remote/sender'

export type AppEventContract = IpcEventContract &
  TasksEventContract &
  BrowserEventContract &
  CodeEventContract &
  IpcExtrasEventContract &
  RemoteEventContract
export type AppEventChannel = keyof AppEventContract & string

export interface RemoteSubscriber {
  /** Canales que puede recibir (lista blanca; vacía = ninguno). */
  channels: ReadonlySet<string>
  /** Recorte de la carga antes de salir; null = no enviar este evento. */
  trim?: (channel: string, payload: unknown) => unknown | null
  deliver: (channel: string, payload: unknown) => void
}

export type EventTarget = WebContents | BrowserWindow | ReadonlyArray<WebContents | BrowserWindow | null | undefined>

const remoteSubs = new Set<RemoteSubscriber>()

export function subscribeRemote(sub: RemoteSubscriber): () => void {
  remoteSubs.add(sub)
  return () => {
    remoteSubs.delete(sub)
  }
}

function toWc(t: WebContents | BrowserWindow | null | undefined): WebContents | null {
  if (!t) return null
  return 'webContents' in t ? t.webContents : t
}

function sendWc(wc: WebContents | null, channel: string, payload: unknown): void {
  if (!wc || wc.isDestroyed?.()) return
  if (payload === undefined) wc.send(channel)
  else wc.send(channel, payload)
}

function toRemote(channel: string, payload: unknown): void {
  for (const sub of [...remoteSubs]) {
    if (!sub.channels.has(channel)) continue
    try {
      const out = sub.trim ? sub.trim(channel, payload) : payload
      if (out === null) continue
      sub.deliver(channel, out)
    } catch (err) {
      console.error(`[event-bus] suscriptor remoto (${channel}):`, err)
    }
  }
}

/** A todas las ventanas y a los suscriptores remotos. */
export function publish(channel: AppEventChannel, ...payload: unknown[]): void {
  const p = payload[0]
  for (const win of BrowserWindow.getAllWindows()) sendWc(win.isDestroyed() ? null : win.webContents, channel, p)
  toRemote(channel, p)
}

/** A ventanas concretas (no llega al celular). */
export function publishTo(to: EventTarget, channel: AppEventChannel, ...payload: unknown[]): void {
  const p = payload[0]
  const list = Array.isArray(to) ? to : [to as WebContents | BrowserWindow]
  for (const t of list) sendWc(toWc(t), channel, p)
}

/**
 * Al remitente con ese id: ventana real (`webContents.id`) o remitente virtual del celular (id negativo).
 * Lo usan los eventos que pertenecen a un recurso (pty, archivos) y deben ir a quien lo creó.
 */
export function publishToSender(senderId: number, channel: AppEventChannel, ...payload: unknown[]): void {
  const p = payload[0]
  const virtual = getRemoteSender(senderId)
  if (virtual) {
    if (!virtual.isDestroyed()) virtual.send(channel, ...(p === undefined ? [] : [p]))
    return
  }
  sendWc(electronWebContents.fromId(senderId) ?? null, channel, p)
}

/** Formas de un solo argumento de `publish`/`publishTo` (para los emisores que ya recibían `(canal, carga)`). */
export function emit(channel: AppEventChannel, payload: unknown): void {
  publish(channel, payload)
}
export function emitTo(to: EventTarget, channel: AppEventChannel, payload: unknown): void {
  publishTo(to, channel, payload)
}

/** Solo para pruebas. */
export function _resetEventBus(): void {
  remoteSubs.clear()
}
