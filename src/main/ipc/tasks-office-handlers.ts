/**
 * Handlers de LibreOffice opcional (`office:*`) y del doctor (`doctor:run`): estado, instalación bajo demanda (el botón de Ajustes ES el consentimiento) y
 * desinstalación. La lógica vive en `main/office`; aquí solo se conecta al IPC.
 */
import { runRealDoctor } from '../doctor/service'
import { officeService } from '../office/service'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export function registerTasksOfficeHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle } = ctx
  handle('office:status', () => officeService().snapshot())
  handle('office:install', () => officeService().install())
  handle('office:cancel', () => {
    officeService().cancel()
  })
  handle('office:remove', () => {
    officeService().remove()
  })
  handle('doctor:run', () => runRealDoctor(ctx.computer))
  return {}
}
