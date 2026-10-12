/**
 * Handlers de ArtCraft opcional (`craft:*`) y del doctor (`doctor:run`): estado, instalación bajo demanda (el botón de Ajustes ES el consentimiento) y
 * desinstalación. La lógica vive en `main/office`; aquí solo se conecta al IPC.
 */
import { runRealDoctor } from '../doctor/service'
import { craftService } from '../office/craft/service'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export function registerTasksCraftHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle } = ctx
  handle('craft:status', () => craftService().snapshot())
  handle('craft:install', () => craftService().installNow())
  handle('craft:cancel', () => {
    craftService().cancel()
  })
  handle('craft:remove', () => {
    craftService().remove()
  })
  handle('doctor:run', () => runRealDoctor(ctx.computer))
  return {}
}
