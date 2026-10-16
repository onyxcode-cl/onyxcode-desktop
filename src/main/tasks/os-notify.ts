/**
 * Aviso del sistema (macOS y Windows) cuando una tarea termina, falla o espera a la persona.
 *
 * Solo corre en el proceso principal y solo a partir de eventos del monitor de tareas (sondeo propio contra los
 * servidores locales): ni el renderer ni el control remoto pueden disparar avisos. Reglas:
 *  - nada si la ventana tiene el foco (ya lo estás viendo);
 *  - nada si el interruptor general de Ajustes > Tareas está apagado;
 *  - una sola vez por tarea y tipo de aviso en una ventana corta (anti-duplicados);
 *  - el texto lleva solo el título de la tarea, recortado: nunca rutas, claves ni contenido de archivos.
 */
import { t, type MsgKey } from '@shared/i18n'
import type { NotifyTarget } from '@shared/types'
import type { MonitorNotifyEvent } from './monitor'

export const NOTIFY_TITLE_MAX = 80
/** Dos avisos iguales (misma tarea y tipo) dentro de esta ventana cuentan como uno. */
export const NOTIFY_DEDUPE_MS = 60_000

const KEY = {
  done: 'merr.notif.taskDone',
  approval: 'merr.notif.taskApproval',
  question: 'merr.notif.taskQuestion',
  error: 'merr.notif.taskError'
} as const satisfies Record<MonitorNotifyEvent['kind'], MsgKey>

export interface OsNotificationLike {
  on(event: 'click', cb: () => void): unknown
  show(): void
}

export interface OsNotifyDeps {
  isSupported(): boolean
  create(opts: { title: string; silent: boolean }): OsNotificationLike
  /** Interruptor general de notificaciones de la app (Ajustes > General). */
  appEnabled(): boolean
  /** Interruptor de Ajustes > Tareas. */
  tasksEnabled(): boolean
  silent(): boolean
  /** ¿La ventana principal existe, está visible y tiene el foco? */
  windowFocused(): boolean
  /** Trae la ventana al frente y abre esa tarea. */
  open(target: NotifyTarget): void
  now?: () => number
}

/** Título de una línea, sin saltos de línea ni caracteres de control, recortado con «…». */
export function cleanTaskTitle(raw: string): string {
  const one = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const s = one || t('merr.notif.untitledTask')
  const chars = [...s]
  return chars.length > NOTIFY_TITLE_MAX
    ? `${chars
        .slice(0, NOTIFY_TITLE_MAX - 1)
        .join('')
        .trimEnd()}…`
    : s
}

export function createOsNotifier(deps: OsNotifyDeps): (ev: MonitorNotifyEvent) => void {
  const seen = new Map<string, number>()
  const now = deps.now ?? Date.now
  return (ev) => {
    if (!deps.tasksEnabled() || !deps.appEnabled() || !deps.isSupported()) return
    if (deps.windowFocused()) return
    const at = now()
    for (const [k, ts] of seen) if (at - ts >= NOTIFY_DEDUPE_MS) seen.delete(k)
    const key = `${ev.sessionId}\u0000${ev.kind}`
    if (seen.has(key)) return
    seen.set(key, at)
    const n = deps.create({ title: t(KEY[ev.kind], { title: cleanTaskTitle(ev.title) }), silent: deps.silent() })
    n.on('click', () => deps.open({ mode: 'tasks', id: ev.sessionId, directory: ev.folder, fullAccess: ev.fullAccess }))
    n.show()
  }
}
