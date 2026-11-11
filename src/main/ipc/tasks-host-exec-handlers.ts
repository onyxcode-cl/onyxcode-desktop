/**
 * Aprobaciones de la herramienta `equipo` (comandos fuera del aislamiento) en la ventana: tarjeta en el renderer (`tasks:hostExec:approval`,
 * respuesta por `tasks:hostExec:respond`) y, sin ventana visible, aviso del sistema + diálogo nativo con «No» en el índice 0 (Return y Esc
 * deniegan). La lógica (tiempo límite que deniega, una tarjeta por llamada, sin «siempre») vive en `host-exec/approvals.ts`.
 */
import { t } from '@shared/i18n'
import { DISPLAY_NAME } from '@shared/brand'
import { Notification } from 'electron'
import {
  cancelAllHostApprovals,
  initHostApprovals,
  pendingHostApprovals,
  respondHostApproval,
  type HostApprovalRequest
} from '../host-exec/approvals'
import { askButtons } from '../util/native-dialog'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

/** Texto del diálogo nativo: el comando completo primero, luego el motivo y la carpeta. */
export function hostApprovalDialogDetail(req: HostApprovalRequest): string {
  return [
    req.command,
    '',
    t('merr.hostExec.reason', { reason: req.reason }),
    t('merr.hostExec.folder', { folder: req.folder }),
    ...(req.background ? [t('merr.hostExec.background')] : [])
  ].join('\n')
}

/** `display dialog` no tiene desplazamiento: un comando más largo que esto no se puede aprobar ahí (hay que verlo en la app). */
export const NATIVE_MAX_LINES = 3
export const NATIVE_MAX_CHARS = 300
export const fitsNativeDialog = (command: string): boolean =>
  command.length <= NATIVE_MAX_CHARS && command.split('\n').length <= NATIVE_MAX_LINES

export function registerTasksHostExecHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle, send, getWindow } = ctx
  const showWindow = (): void => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  initHostApprovals({
    hasVisibleHost: () => {
      const w = getWindow()
      return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized()
    },
    broadcast: (req) => send('tasks:hostExec:approval', req),
    broadcastDone: (id) => send('tasks:hostExec:approvalDone', { id }),
    notify: () => {
      const w = getWindow()
      if (w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()) return
      try {
        if (!Notification.isSupported()) return
        const n = new Notification({ title: DISPLAY_NAME, body: t('merr.hostExec.notif') })
        n.on('click', showWindow)
        n.show()
      } catch (err) {
        console.error('[equipo] notificación de aprobación:', err instanceof Error ? err.message : 'error')
      }
    },
    // Botón seguro («No») en el índice 0, por defecto y al cancelar: ver `embedded-browser/approvals.ts` (Return en macOS).
    // Se cierra solo al resolverse o vencer (`signal`) y nunca dura más que lo que le queda a la petición. Un comando largo no se puede
    // aprobar aquí: solo «No» o abrir la app, donde la tarjeta lo muestra entero.
    fallback: async (req, signal) => {
      const giveUpSeconds = Math.max(1, Math.floor((req.expiresAt - Date.now()) / 1000))
      if (!fitsNativeDialog(req.command)) {
        const i = await askButtons({
          message: t('merr.hostExec.dialogLong'),
          detail: t('merr.hostExec.dialogLongDetail', {
            lines: req.command.split('\n').length,
            chars: req.command.length,
            folder: req.folder
          }),
          buttons: [t('merr.dialog.no'), t('merr.hostExec.openApp')],
          defaultIndex: 0,
          cancelIndex: 0,
          giveUpSeconds,
          signal
        })
        if (i !== 1 || signal.aborted) return 'deny'
        showWindow()
        return 'open'
      }
      const i = await askButtons({
        message: t('merr.hostExec.dialog'),
        detail: hostApprovalDialogDetail(req),
        buttons: [t('merr.dialog.no'), t('merr.hostExec.allowOnce')],
        defaultIndex: 0,
        cancelIndex: 0,
        giveUpSeconds,
        signal
      })
      return i === 1 && !signal.aborted ? 'allow' : 'deny'
    }
  })

  handle('tasks:hostExec:respond', ({ id, decision }) => {
    respondHostApproval(id, decision === 'allow' ? 'allow' : 'deny')
  })
  handle('tasks:hostExec:pending', () => pendingHostApprovals())

  return {
    dispose: () => {
      cancelAllHostApprovals()
      initHostApprovals(null)
    }
  }
}
