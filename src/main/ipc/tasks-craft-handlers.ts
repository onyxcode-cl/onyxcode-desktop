/**
 * Handlers de ArtCraft opcional (`craft:*`), de Node.js y uv de la app (`runtimes:*`) y del doctor (`doctor:run`): estado, instalación bajo demanda (el botón de Ajustes ES el consentimiento) y
 * desinstalación. La lógica vive en `main/office`; aquí solo se conecta al IPC.
 */
import { runRealDoctor } from '../doctor/service'
import { craftService } from '../office/craft/service'
import { runtimesService } from '../runtimes/service'
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
  // Node.js y uv de la app (F8-B195): estado, instalación bajo demanda y quitar. Lo que instalan lo usan solo los conectores locales.
  handle('runtimes:status', () => runtimesService().snapshot())
  handle('runtimes:install', () => runtimesService().installNow())
  handle('runtimes:cancel', () => {
    runtimesService().cancel()
  })
  handle('runtimes:remove', () => runtimesService().remove())
  handle('doctor:run', () => runRealDoctor(ctx.computer))
  return {}
}
