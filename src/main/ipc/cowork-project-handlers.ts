/**
 * Handlers de AGENTS.md, MCP del usuario en Cowork y permisos recordados
 * (`cowork:agentsMd:*`, `cowork:mcp:*`, `cowork:rules:*`).
 *
 * - AGENTS.md: la carpeta se valida con `assertInsideApproved` y solo se toca `<carpeta>/AGENTS.md`.
 * - MCP: marcas propias de Cowork en `cowork-mcp.json` (nunca se escribe `opencode.json`).
 * - Reglas: "siempre permitir" por carpeta; se aplican al abrir de nuevo la carpeta.
 */
import { coworkMcpPrefs } from '../cowork/mcp-cowork'
import { getAgentsMd, saveAgentsMd } from '../cowork/projects'
import { coworkRules } from '../cowork/rules'
import type { CoworkIpcContext, CoworkSubmodule } from './cowork-handle'

export function registerCoworkProjectHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, cowork } = ctx

  handle('cowork:agentsMd:get', ({ folder }) => getAgentsMd(cowork.assertInsideApproved(folder)))
  handle('cowork:agentsMd:save', ({ folder, content }) => saveAgentsMd(cowork.assertInsideApproved(folder), content))

  handle('cowork:mcp:list', () => coworkMcpPrefs.list())
  handle('cowork:mcp:set', ({ name, cowork: inCowork, askEachTool }) =>
    coworkMcpPrefs.set(name, { cowork: inCowork, askEachTool })
  )

  handle('cowork:rules:list', ({ folder }) => coworkRules.list(folder ? cowork.assertInsideApproved(folder) : undefined))
  handle('cowork:rules:add', ({ folder, permission, patterns }) =>
    coworkRules.add(cowork.assertInsideApproved(folder), permission, patterns)
  )
  handle('cowork:rules:remove', ({ id }) => coworkRules.remove(id))

  return {}
}
