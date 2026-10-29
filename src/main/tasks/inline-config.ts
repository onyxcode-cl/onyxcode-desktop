/**
 * Construcción PURA del config inline de OpenCode (`OPENCODE_CONFIG_CONTENT`) de un servidor de
 * Tareas. Extraída de `TasksManager.inlineConfig` sin cambiar el resultado (fijado por
 * `inline-config.test.ts`). Las claves `agent.<id>.permission` son SEGURIDAD: deniegan MCP,
 * aplican `external_directory` y las reglas recordadas.
 */
import { COMPUTER_AGENT_ID, TASKS_AGENT_ID } from '@shared/agents'
import { DOCUMENTS_ROUTE_NAME } from '../documents/names'
import { HOST_ROUTE_NAME } from '../host-exec/names'
import { deepMerge } from './config-merge'

export interface InlineConfigInput {
  fullAccess: boolean
  /** Carpetas adicionales del espacio (solo sandbox). */
  extras: Array<{ path: string }>
  /**
   * Carpetas de la propia app que el agente puede leer sin preguntar (solo sandbox): las skills de documentos
   * (`opencode-config/skills`) con sus scripts. Sin esto cada tarea de Word/Excel abría una tarjeta de «carpeta fuera del
   * espacio» sobre un directorio interno que además no se puede conceder.
   */
  allowDirs?: string[]
  /** Config del MCP del navegador integrado (o null si no está disponible). */
  browserMcp: Record<string, unknown> | null
  /** Config del MCP `computer` (solo Control total; o null). */
  computerMcp: Record<string, unknown> | null
  /** Ruta `computer` del puente de apps del modo unificado (ya apuntando al proxy; solo sandbox y solo con la bandera). Ausente = igual que siempre. */
  bridgeMcp?: Record<string, unknown> | null
  /**
   * MCP `documentos` (crear Word, Excel, PowerPoint y PDF con el motor del Chat; solo sandbox, ya apuntando a la ruta del proxy). Ausente o null
   * = igual que siempre. Al ser una herramienta de la propia app que solo crea archivos NUEVOS en la carpeta de la tarea, va en `allow`.
   */
  documentsMcp?: Record<string, unknown> | null
  /**
   * MCP `equipo` (un comando exacto que corre en el equipo fuera del aislamiento, con la aprobación de la persona; solo sandbox, ya apuntando a la
   * ruta del proxy). Siempre con permiso `ask`: la persona ve el comando completo antes de que corra. Ausente o null = igual que siempre.
   */
  hostMcp?: Record<string, unknown> | null
  /** Archivos de instrucciones extra del agente (ruta del anfitrión; solo sandbox y solo con el puente de apps). Ausente o vacío = igual que siempre. */
  instructions?: string[]
  /** Aportación de los MCP del usuario (`tasksMcpContribution`). */
  mcpContribution: { mcp: Record<string, unknown>; permission: Record<string, unknown> }
  /** Permisos «siempre permitir» recordados (`rulesPermissionConfig`). */
  rulesPermission: Record<string, unknown>
  /** Bloque de skills (`skillsInlineConfig()`). */
  skills: Record<string, unknown>
  /**
   * Ruta del anfitrión → ruta DENTRO del sandbox (Windows: `C:\x` → `/win/c/x`). Ausente = identidad (macOS: el resultado es
   * byte a byte el de siempre). OpenCode corre dentro de la distro y solo entiende sus rutas.
   */
  toSandbox?: (hostPath: string) => string
}

export function buildInlineConfig(i: InlineConfigInput): Record<string, unknown> {
  let base: Record<string, unknown>
  if (!i.fullAccess) {
    const externalDirectory: Record<string, 'ask' | 'allow'> = { '*': 'ask' }
    for (const e of i.extras) {
      const p = i.toSandbox ? i.toSandbox(e.path) : e.path
      externalDirectory[p] = 'allow'
      externalDirectory[`${p}/*`] = 'allow'
    }
    const allowDirs = i.allowDirs ?? []
    for (const d of allowDirs) {
      const p = i.toSandbox ? i.toSandbox(d) : d
      externalDirectory[p] = 'allow'
      externalDirectory[`${p}/*`] = 'allow'
    }
    base = {
      autoupdate: false,
      share: 'disabled',
      ...(i.browserMcp || i.bridgeMcp || i.documentsMcp || i.hostMcp
        ? {
            mcp: {
              ...(i.browserMcp ? { browser: i.browserMcp } : {}),
              ...(i.bridgeMcp ? { computer: i.bridgeMcp } : {}),
              ...(i.documentsMcp ? { [DOCUMENTS_ROUTE_NAME]: i.documentsMcp } : {}),
              ...(i.hostMcp ? { [HOST_ROUTE_NAME]: i.hostMcp } : {})
            }
          }
        : {}),
      agent: {
        [COMPUTER_AGENT_ID]: { disable: true },
        ...(i.extras.length || allowDirs.length || i.documentsMcp || i.hostMcp
          ? {
              [TASKS_AGENT_ID]: {
                permission: {
                  ...(i.extras.length || allowDirs.length ? { external_directory: externalDirectory } : {}),
                  ...(i.documentsMcp ? { [`${DOCUMENTS_ROUTE_NAME}_*`]: 'allow' } : {}),
                  // Comandos fuera del aislamiento: SIEMPRE preguntan (la persona ve el comando entero). Explícito, porque el agente trae `'*': allow`.
                  ...(i.hostMcp ? { [`${HOST_ROUTE_NAME}_*`]: 'ask' } : {})
                }
              }
            }
          : {})
      }
    }
  } else {
    const mcpBlock: Record<string, unknown> = {}
    if (i.computerMcp) mcpBlock.computer = i.computerMcp
    if (i.browserMcp) mcpBlock.browser = i.browserMcp
    base = {
      autoupdate: false,
      share: 'disabled',
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
  const instr = !i.fullAccess && i.instructions?.length ? i.instructions.map((p) => (i.toSandbox ? i.toSandbox(p) : p)) : []
  return deepMerge(base, mcpBlock, rulesBlock, i.skills, instr.length ? { instructions: instr } : {})
}
