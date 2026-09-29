/**
 * Construcción PURA del config inline de OpenCode (`OPENCODE_CONFIG_CONTENT`) de un servidor de
 * Tareas. Extraída de `TasksManager.inlineConfig` sin cambiar el resultado (fijado por
 * `inline-config.test.ts`). Las claves `agent.<id>.permission` son SEGURIDAD: deniegan MCP,
 * aplican `external_directory` y las reglas recordadas.
 */
import { COMPUTER_AGENT_ID, TASKS_AGENT_ID } from '@shared/agents'
import { deepMerge } from './config-merge'

export interface InlineConfigInput {
  fullAccess: boolean
  /** Carpetas adicionales del espacio (solo sandbox). */
  extras: Array<{ path: string }>
  /** Config del MCP del navegador integrado (o null si no está disponible). */
  browserMcp: Record<string, unknown> | null
  /** Config del MCP `computer` (solo Control total; o null). */
  computerMcp: Record<string, unknown> | null
  /** Aportación de los MCP del usuario (`tasksMcpContribution`). */
  mcpContribution: { mcp: Record<string, unknown>; permission: Record<string, unknown> }
  /** Permisos «siempre permitir» recordados (`rulesPermissionConfig`). */
  rulesPermission: Record<string, unknown>
  /** Bloque de skills (`skillsInlineConfig()`). */
  skills: Record<string, unknown>
}

export function buildInlineConfig(i: InlineConfigInput): Record<string, unknown> {
  let base: Record<string, unknown>
  if (!i.fullAccess) {
    const externalDirectory: Record<string, 'ask' | 'allow'> = { '*': 'ask' }
    for (const e of i.extras) {
      externalDirectory[e.path] = 'allow'
      externalDirectory[`${e.path}/*`] = 'allow'
    }
    base = {
      autoupdate: false,
      ...(i.browserMcp ? { mcp: { browser: i.browserMcp } } : {}),
      agent: {
        [COMPUTER_AGENT_ID]: { disable: true },
        ...(i.extras.length ? { [TASKS_AGENT_ID]: { permission: { external_directory: externalDirectory } } } : {})
      }
    }
  } else {
    const mcpBlock: Record<string, unknown> = {}
    if (i.computerMcp) mcpBlock.computer = i.computerMcp
    if (i.browserMcp) mcpBlock.browser = i.browserMcp
    base = {
      autoupdate: false,
      ...(Object.keys(mcpBlock).length ? { mcp: mcpBlock } : {}),
      agent: {
        [TASKS_AGENT_ID]: {
          permission: {
            'computer_*': 'deny',
            ...(i.browserMcp ? { 'browser_*': 'deny' } : {})
          }
        }
      }
    }
  }
  const hasPerm = Object.keys(i.mcpContribution.permission).length > 0
  const mcpBlock: Record<string, unknown> = {
    ...(Object.keys(i.mcpContribution.mcp).length ? { mcp: i.mcpContribution.mcp } : {}),
    ...(hasPerm
      ? {
          agent: {
            [TASKS_AGENT_ID]: { permission: i.mcpContribution.permission },
            [COMPUTER_AGENT_ID]: { permission: i.mcpContribution.permission }
          }
        }
      : {})
  }
  const rulesBlock: Record<string, unknown> = Object.keys(i.rulesPermission).length
    ? { agent: { [TASKS_AGENT_ID]: { permission: i.rulesPermission }, [COMPUTER_AGENT_ID]: { permission: i.rulesPermission } } }
    : {}
  return deepMerge(base, mcpBlock, rulesBlock, i.skills)
}
