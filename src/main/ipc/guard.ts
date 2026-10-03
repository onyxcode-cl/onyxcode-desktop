/**
 * Validación en main de CADA llamada IPC invoke (AUDIT.md 1.5 / S8):
 *
 * 1. Emisor: debe ser el frame PRINCIPAL (`senderFrame.parent === null`) de una ventana creada por
 *    la app y registrada con un rol (`registerWindowRole`), y su URL debe ser un origen propio
 *    (`onyxcode://app` o el dev server de Vite). Iframes, ventanas de artifacts (sin preload y otro
 *    esquema) o una página que haya navegado fuera → rechazo.
 * 2. Rol: la ventana principal puede usar todos los canales; Quick Entry, overlay y píldora solo
 *    los suyos (`CHANNEL_ROLES`).
 * 3. Payload: el esquema del canal (`IPC_SCHEMAS`) valida tipos, claves y longitudes, y devuelve el
 *    payload saneado que recibe el handler.
 */
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { isTrustedUrl } from '../security/app-protocol'
import { CHANNEL_ROLES, IPC_SCHEMAS, type WindowRole } from './schemas'
import { ValidationError } from './validate'

export class IpcGuardError extends Error {
  constructor(
    readonly kind: 'FORBIDDEN' | 'INVALID',
    message: string
  ) {
    super(message)
  }
}

const roles = new Map<number, WindowRole>()

/** Asigna el rol de una ventana de la app (antes de cargar su página). */
export function registerWindowRole(wc: WebContents, role: WindowRole): void {
  const id = wc.id
  roles.set(id, role)
  wc.once('destroyed', () => {
    if (roles.get(id) === role) roles.delete(id)
  })
}

let rejections = 0
function reject(kind: 'FORBIDDEN' | 'INVALID', channel: string, detail: string): never {
  // Registro acotado (un renderer comprometido podría inundar el log).
  if (rejections++ < 200) console.warn(`[ipc] rechazado ${channel}: ${detail}`)
  throw new IpcGuardError(kind, kind === 'FORBIDDEN' ? `Llamada IPC no permitida (${channel})` : detail)
}

/**
 * Comprueba emisor y payload. Devuelve el payload validado (lanzar = rechazar la llamada).
 * `args` son todos los argumentos tras el evento: los canales aceptan como mucho uno.
 */
export function guardInvoke(event: IpcMainInvokeEvent, channel: string, args: unknown[]): unknown {
  const frame = event.senderFrame
  if (!frame) reject('FORBIDDEN', channel, 'frame destruido')
  if (frame.parent !== null) reject('FORBIDDEN', channel, 'emisor no es el frame principal')
  if (!isTrustedUrl(frame.url)) reject('FORBIDDEN', channel, `origen no permitido (${frame.url.slice(0, 120)})`)
  const role = roles.get(event.sender.id)
  if (!role) reject('FORBIDDEN', channel, 'ventana sin rol registrado')
  if (role !== 'main' && !CHANNEL_ROLES[role].has(channel)) reject('FORBIDDEN', channel, `canal no permitido para la ventana ${role}`)

  return validatePayload(channel, args)
}

/**
 * Validación de payload COMPARTIDA por las ventanas (`guardInvoke`) y por quien no es una ventana
 * (`invokeAs`, el celular): canal con esquema, un solo argumento y esquema estricto.
 */
export function validatePayload(channel: string, args: unknown[]): unknown {
  const schema = IPC_SCHEMAS[channel]
  if (!schema) reject('FORBIDDEN', channel, 'canal sin esquema')
  if (args.length > 1) reject('INVALID', channel, 'demasiados argumentos')
  try {
    return schema(args[0], '')
  } catch (err) {
    if (err instanceof ValidationError) reject('INVALID', channel, err.message)
    throw err
  }
}
