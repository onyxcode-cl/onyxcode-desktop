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
import { modelFallbackInline, normalizeModelFallback } from '@shared/model-fallback'

/** Servicio gratuito propio: su host (`opencode.ai`) ya está siempre permitido en la red del sandbox. */
const SANDBOX_FREE_PROVIDER = 'opencode'

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
  /**
   * «Modelo de respaldo» de los ajustes (`Settings.modelFallback`), igual que en el motor principal. Ausente o sin modelos = no se escribe nada.
   * En el sandbox solo quedan los modelos que se pueden alcanzar desde ahí: los gratuitos del servicio propio (`opencode`) y los servicios de
   * la tabla fija con clave guardada (`credentialProviderIds`); los demás se omiten sin romper nada.
   */
  modelFallback?: unknown
  /** Ids (nunca claves) de servicios con credencial utilizable en el sandbox. Solo se usa con `modelFallback` y sin Control total. */
  credentialProviderIds?: readonly string[]
  /**
   * H5: texto de la carpeta que se sigue dando al motor con jaula, que corre con `OPENCODE_DISABLE_PROJECT_CONFIG=1` (`project-code.ts`).
   * Solo sandbox. Ausente = igual que siempre.
   */
  projectText?: {
    instructionFile: string
    skillDirs: string[]
    /** Ayudantes del proyecto ya saneados por main (`project-helpers.ts`): solo texto, sin permisos ni herramientas ni modelo. */
    agents?: Record<string, unknown>
    /** Comandos del proyecto ya saneados por main: solo plantillas de texto. */
    commands?: Record<string, unknown>
  }
}

/** H5: instrucciones y skills de la carpeta por ruta absoluta, y LSP/formateadores apagados (solo sandbox). */
function projectTextBlock(i: InlineConfigInput, instr: string[]): Record<string, unknown> {
  if (i.fullAccess || !i.projectText) return instr.length ? { instructions: instr } : {}
  const map = (p: string): string => (i.toSandbox ? i.toSandbox(p) : p)
  const prevSkills = (i.skills as { skills?: { paths?: unknown } }).skills?.paths
  const prevPaths = Array.isArray(prevSkills) ? prevSkills.filter((p): p is string => typeof p === 'string') : []
  return {
    instructions: [map(i.projectText.instructionFile), ...instr],
    skills: { paths: [...prevPaths, ...i.projectText.skillDirs.map(map)] },
    lsp: false,
    formatter: false,
    ...(i.projectText.agents && Object.keys(i.projectText.agents).length ? { agent: i.projectText.agents } : {}),
    ...(i.projectText.commands && Object.keys(i.projectText.commands).length ? { command: i.projectText.commands } : {})
  }
}

/** Bloque `respaldo` de Tareas, o `{}` si no hay nada que escribir. */
function fallbackBlock(i: InlineConfigInput): Record<string, unknown> {
  const n = normalizeModelFallback(i.modelFallback)
  const models = i.fullAccess
    ? n.models
    : n.models.filter((m) => {
        const id = m.slice(0, m.indexOf('/'))
        return id === SANDBOX_FREE_PROVIDER || (i.credentialProviderIds ?? []).includes(id)
      })
  const block = modelFallbackInline({ models, otherProvider: n.otherProvider })
  return block ? { respaldo: block } : {}
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
                  // Comandos fuera del aislamiento: la aprobación la pide y decide MAIN (`host-exec/approvals.ts`), con el comando entero, cada vez.
                  // La pregunta del motor no protegía nada (el motor vive en la jaula con los programas de la tarea) y duplicaba la tarjeta.
                  ...(i.hostMcp ? { [`${HOST_ROUTE_NAME}_*`]: 'allow' } : {})
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
  return deepMerge(base, mcpBlock, rulesBlock, i.skills, projectTextBlock(i, instr), fallbackBlock(i))
}
