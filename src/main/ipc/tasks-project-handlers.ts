/**
 * Handlers de AGENTS.md, MCP del usuario en Tareas y permisos recordados
 * (`tasks:agentsMd:*`, `tasks:mcp:*`, `tasks:rules:*`).
 *
 * - AGENTS.md: la carpeta se valida con `assertInsideApproved` y solo se toca `<carpeta>/AGENTS.md`.
 * - MCP: marcas propias de Tareas en `tasks-mcp.json` (nunca se escribe `opencode.json`).
 * - Reglas: "siempre permitir" por carpeta; se aplican al abrir de nuevo la carpeta.
 */
import { tasksMcpPrefs } from '../tasks/mcp-tasks'
import { getAgentsMd, saveAgentsMd } from '../tasks/projects'
import { tasksRules } from '../tasks/rules'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export function registerTasksProjectHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle, tasks } = ctx

  handle('tasks:agentsMd:get', ({ folder }) => getAgentsMd(tasks.assertInsideApproved(folder)))
  handle('tasks:agentsMd:save', ({ folder, content }) => saveAgentsMd(tasks.assertInsideApproved(folder), content))

  handle('tasks:mcp:list', () => tasksMcpPrefs.list())
  handle('tasks:mcp:set', ({ name, tasks: inTasks, askEachTool }) => tasksMcpPrefs.set(name, { tasks: inTasks, askEachTool }))

  handle('tasks:rules:list', ({ folder }) => tasksRules.list(folder ? tasks.assertInsideApproved(folder) : undefined))
  // El modo lo decide main por el servidor vivo de esa carpeta (no quien llama): lo dado en una Tarea aislada no vale en Control total.
  handle('tasks:rules:add', ({ folder, permission, patterns }) =>
    tasksRules.add(tasks.assertInsideApproved(folder), permission, patterns, { isolatedOnly: tasks.alwaysRuleIsolatedOnly(folder) })
  )
  handle('tasks:rules:remove', ({ id }) => tasksRules.remove(id))

  return {}
}
