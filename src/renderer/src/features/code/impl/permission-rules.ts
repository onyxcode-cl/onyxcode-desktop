import type { PermissionRuleset } from '@opencode-ai/sdk/v2/client'
import { effectiveModeFor, endsWithRuleset, rulesetForMode, type LinkedFolderRule, type PermissionRuleLike } from '@shared/permission-rules'
import type { ProjectScanResult } from '@shared/ipc-code'
import { useSettings } from '../../../stores/settings'
import { bgshellSessionRules } from '@shared/shell-bg-permissions'
import { documentsSessionRules } from '@shared/documents-permissions'
import type { PermissionMode } from './types'

/** ¿Dos rulesets son iguales (mismas reglas, mismo orden)? */
export function sameRuleset(a: PermissionRuleset | undefined, b: PermissionRuleset | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

// ── Conectores que trae la carpeta (W-A2) ──────────────────────────────────────────────────────────────────────

/**
 * Lo que el último escaneo (lectura de disco, antes de abrir la carpeta) dice de sus conectores. Solo en memoria: se vuelve a llenar cada
 * vez que se abre o se restaura la carpeta (`trust.ts`). Sin registro = esa carpeta no se escaneó en esta ejecución: falla cerrado (`projectAskRules`).
 */
export interface FolderMcpState {
  /** Conectores de la carpeta: nombre, clave de permiso (`<servidor>_*`) y si redefinen uno que la app o la persona ya tienen. */
  servers: Array<{ name: string; trustName?: string; key: string; overrides: boolean }>
  /** Hay algo que no se pudo enumerar (archivo roto, enlace fuera, tope, escaneo fallido): la regla cubre CUALQUIER conector. */
  askAll: boolean
}

const folderMcp = new Map<string, FolderMcpState>()
const dirKey = (dir: string): string => (dir.length > 1 ? dir.replace(/[/\\]+$/, '') : dir)

/** Guarda el resultado del escaneo de `dir`; `null` = no se pudo escanear (falla cerrado: preguntan todos los conectores). */
export function setFolderMcp(dir: string, scan: Pick<ProjectScanResult, 'items' | 'complete'> | null): void {
  if (!scan) {
    folderMcp.set(dirKey(dir), { servers: [], askAll: true })
    return
  }
  const servers: FolderMcpState['servers'] = []
  for (const i of scan.items) {
    if (i.kind === 'mcp' && i.mcpKey) servers.push({ name: i.name, trustName: i.trustName, key: i.mcpKey, overrides: !!i.overrides })
  }
  folderMcp.set(dirKey(dir), { servers, askAll: !scan.complete })
}

/** Carpetas de confianza cuya verificación (escaneo y, si hace falta, re-pregunta) aún no termina: ninguna ruta les pasa el foco. */
const verifying = new Set<string>()
export function setVerifying(dir: string, on: boolean): void {
  if (on) verifying.add(dirKey(dir))
  else verifying.delete(dirKey(dir))
}
export function isVerifying(dir: string): boolean {
  return verifying.has(dirKey(dir))
}

export function clearFolderMcp(dir: string): void {
  folderMcp.delete(dirKey(dir))
}

export function folderMcpOf(dir: string): FolderMcpState | undefined {
  return folderMcp.get(dirKey(dir))
}

/**
 * Reglas `ask` de los conectores de la carpeta, para ir DELANTE del bloque del modo (después de las de `bgshell`/`documentos`: si la carpeta
 * redefine uno de ésos, su `ask` debe ganar). Una regla por conector, con la clave que usa el motor (`mcpServerPermissionKey`); NO `*_*` general,
 * porque casaría también con permisos internos con guion bajo (`external_directory`, `doom_loop`, `plan_exit`…) y con los conectores de confianza.
 * Se excluyen los que la persona marcó de confianza en Code, SALVO los que esta carpeta redefine (mismo nombre que uno conocido): ésos preguntan
 * siempre. El bloque de «Todo sin preguntar» no trae reglas que casen con estas claves, así que también preguntan ahí (decisión D4).
 * Si el escaneo no pudo enumerarlo todo (`askAll`) se añade `*_*: ask` como red de seguridad: todo conector pregunta en esa carpeta.
 * Orden estable (por clave) para que `sessionHasRuleset` no reenvíe sin motivo.
 */
export function projectAskRules(state: FolderMcpState | undefined, trusted: readonly string[]): PermissionRuleLike[] {
  // Carpeta que no se escaneó en esta ejecución (restaurada al arrancar, abierta desde la barra…): falla cerrado, todo conector pregunta.
  if (!state) return [{ permission: '*_*', pattern: '*', action: 'ask' }]
  const trustedNames = new Set(trusted)
  const keys = new Set<string>()
  for (const s of state.servers) {
    // La confianza se decide con el nombre CRUDO (`trustName`); `name` está saneado solo para mostrar y no sirve para esto.
    if (!s.overrides && s.trustName !== undefined && trustedNames.has(s.trustName)) continue
    keys.add(s.key)
  }
  const rules: PermissionRuleLike[] = [...keys].sort().map((k) => ({ permission: k, pattern: '*', action: 'ask' as const }))
  if (state.askAll) rules.unshift({ permission: '*_*', pattern: '*', action: 'ask' })
  return rules
}

/** Reglas de conectores de la carpeta `dir` con la lista de confianza actual de Ajustes. Nunca lanza. */
export function projectAskOf(dir: string): PermissionRuleLike[] {
  let trusted: readonly string[] = []
  try {
    trusted = useSettings.getState().settings.codeTrustedMcp ?? []
  } catch {
    trusted = []
  }
  return projectAskRules(folderMcpOf(dir), trusted)
}

/**
 * Traduce un `PermissionMode` al bloque de reglas que se manda a `session.update` / `session.create`. Siempre devuelve el bloque
 * completo y autosuficiente (la lógica y el porqué viven en `@shared/permission-rules`); «plan» también lleva reglas, porque tiene que
 * anular lo que dejó el modo anterior en la misma sesión.
 * Delante van (en este orden) las de `bgshell` (F8-B204: `bgshell_start` igual que `bash`, el resto pasa) y las de `documentos` (`documentos_crear` igual
 * que `write`, `documentos_renderizar` pasa): ANTES del bloque del modo, para que la
 * sesión siga TERMINANDO con él (`endsWithRuleset`/`approvalKindOf` reconocen el modo así).
 */
export function rulesetFor(
  mode: PermissionMode,
  linked?: readonly LinkedFolderRule[],
  projectAsk: readonly PermissionRuleLike[] = []
): PermissionRuleset {
  return [
    ...bgshellSessionRules(mode),
    ...documentsSessionRules(mode),
    ...projectAsk,
    ...rulesetForMode(mode, { linked })
  ] as PermissionRuleset
}

/** Reglas que debe tener la sesión según el modo elegido y el agente activo. */
export function rulesetForState(
  mode: PermissionMode,
  agent: string | undefined,
  linked?: readonly LinkedFolderRule[],
  projectAsk?: readonly PermissionRuleLike[]
): PermissionRuleset {
  return rulesetFor(effectiveModeFor(mode, agent), linked, projectAsk)
}

/** ¿La sesión ya termina con el bloque pedido? (idempotencia: no se reenvía ni crece la lista). */
export function sessionHasRuleset(session: PermissionRuleset | undefined, wanted: PermissionRuleset): boolean {
  return endsWithRuleset(session, wanted)
}
