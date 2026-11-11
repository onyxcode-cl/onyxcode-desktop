/**
 * Aprobaciones de las herramientas de los conectores de la persona («preguntar cada herramienta») en Tareas aisladas: tarjeta en el
 * renderer (`tasks:connector:approval`, respuesta por `tasks:connector:respond`) y, sin ventana visible, aviso del sistema + diálogo
 * nativo con «No» en el índice 0. Si los argumentos no caben en el diálogo (más de 3 líneas o 300 caracteres), ahí solo se ofrece «No» o
 * abrir la app. La lógica vive en `tasks/connector-approvals.ts`.
 */
import { t } from '@shared/i18n'
import { DISPLAY_NAME } from '@shared/brand'
import { Notification } from 'electron'
import {
  cancelAllConnectorApprovals,
  initConnectorApprovals,
  pendingConnectorApprovals,
  respondConnectorApproval
} from '../tasks/connector-approvals'
import { askButtons } from '../util/native-dialog'
import { fitsNativeDialog } from './tasks-host-exec-handlers'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export function registerTasksConnectorHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle, send, getWindow } = ctx
  const showWindow = (): void => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  initConnectorApprovals({
    hasVisibleHost: () => {
      const w = getWindow()
      return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized()
    },
    broadcast: (req) => send('tasks:connector:approval', req),
    broadcastDone: (id) => send('tasks:connector:approvalDone', { id }),
    notify: (req) => {
      const w = getWindow()
      if (w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()) return
      try {
        if (!Notification.isSupported()) return
        const n = new Notification({ title: DISPLAY_NAME, body: t('merr.connector.notif', { server: req.server }) })
        n.on('click', showWindow)
        n.show()
      } catch (err) {
        console.error('[conectores] notificación de aprobación:', err instanceof Error ? err.message : 'error')
      }
    },
    fallback: async (req, signal) => {
      const giveUpSeconds = Math.max(1, Math.floor((req.expiresAt - Date.now()) / 1000))
      const short = fitsNativeDialog(req.args)
      const i = await askButtons({
        message: t('merr.connector.dialog', { server: req.server, tool: req.tool }),
        detail: short
          ? `${req.args}\n\n${t('merr.hostExec.folder', { folder: req.folder })}`
          : t('merr.connector.dialogLong', { chars: req.args.length, folder: req.folder }),
        // 1.8.19: el diálogo nativo nunca aprueba (un clic reflejo para quitarlo no puede usar un conector): solo negar o abrir la app.
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
  })

  handle('tasks:connector:respond', ({ id, decision }) => {
    respondConnectorApproval(id, decision === 'allow' || decision === 'task' ? decision : 'deny')
  })
  handle('tasks:connector:pending', () => pendingConnectorApprovals())

  return {
    dispose: () => {
      cancelAllConnectorApprovals()
      initConnectorApprovals(null)
    }
  }
}
