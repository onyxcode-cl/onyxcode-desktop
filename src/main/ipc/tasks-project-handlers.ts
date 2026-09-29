/**
 * Handlers de AGENTS.md, MCP del usuario en Cowork y permisos recordados
 * (`tasks:agentsMd:*`, `tasks:mcp:*`, `tasks:rules:*`).
 *
 * - AGENTS.md: la carpeta se valida con `assertInsideApproved` y solo se toca `<carpeta>/AGENTS.md`.
 * - MCP: marcas propias de Cowork en `tasks-mcp.json` (nunca se escribe `opencode.json`).
 * - Reglas: "siempre permitir" por carpeta; se aplican al abrir de nuevo la carpeta.
 */
import { coworkMcpPrefs } from '../tasks/mcp-tasks'
import { getAgentsMd, saveAgentsMd } from '../tasks/projects'
import { coworkRules } from '../tasks/rules'
import type { CoworkIpcContext, CoworkSubmodule } from './tasks-handle'

export function registerCoworkProjectHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, cowork } = ctx

  handle('tasks:agentsMd:get', ({ folder }) => getAgentsMd(cowork.assertInsideApproved(folder)))
  handle('tasks:agentsMd:save', ({ folder, content }) => saveAgentsMd(cowork.assertInsideApproved(folder), content))

  handle('tasks:mcp:list', () => coworkMcpPrefs.list())
  handle('tasks:mcp:set', ({ name, tasks: inTasks, askEachTool }) => coworkMcpPrefs.set(name, { tasks: inTasks, askEachTool }))

  handle('tasks:rules:list', ({ folder }) => coworkRules.list(folder ? cowork.assertInsideApproved(folder) : undefined))
  handle('tasks:rules:add', ({ folder, permission, patterns }) =>
    coworkRules.add(cowork.assertInsideApproved(folder), permission, patterns)
  )
  handle('tasks:rules:remove', ({ id }) => coworkRules.remove(id))

  return {}
}
