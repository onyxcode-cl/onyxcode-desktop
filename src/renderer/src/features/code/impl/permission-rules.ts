import type { PermissionRuleset } from '@opencode-ai/sdk/v2/client'
import {
  hasModeMark,
  effectiveModeFor,
  endsWithRuleset,
  rulesetForMode,
  sessionConfigRules,
  wildcardMatch,
  type ConfigRule,
  type LinkedFolderRule,
  type PermissionRuleLike
} from '@shared/permission-rules'
import type { ProjectScanResult } from '@shared/ipc-code'
import { useSettings } from '../../../stores/settings'
import { nativeCode } from './client'
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
  /** Reglas de permiso del `opencode.json` de la carpeta (las globales y las de la app van aparte: `globalConfigRules`). */
  config?: ConfigRule[]
}

/**
 * Reglas de permiso de la config global del usuario y del archivo de conectores de la app. No dependen de la carpeta: se refrescan al escanear y antes de
 * enviar (`refreshGlobalConfigRules`, store). Sin ninguna lectura previa queda vacío (ese caso no se puede cerrar desde aquí; ver SEGURIDAD.md).
 */
let globalConfigRules: ConfigRule[] = []
/**
 * Vuelve a leer (barato, solo disco, sin escanear la carpeta) las reglas globales y de la app antes de calcular las reglas de una sesión: Ajustes puede
 * haberlas cambiado desde el último escaneo, y si el escaneo venció o falló no las trajo. Si no se puede, queda lo último que se supo (un `deny` nuevo
 * tardaría hasta la próxima lectura: documentado en SEGURIDAD.md).
 */
export function refreshGlobalConfigRules(): Promise<void> | undefined {
  const native = nativeCode()
  if (!native) return undefined
  const guard = new Promise<null>((res) => setTimeout(() => res(null), 1500))
  return Promise.race([native.project.scan('/', true).catch(() => null), guard]).then(
    (r) => {
      if (r) setGlobalConfigRules(r.globalConfigRules)
    },
    () => undefined
  )
}
export function setGlobalConfigRules(rules: readonly ConfigRule[] | undefined): void {
  if (rules) globalConfigRules = rules.map((r) => ({ ...r }))
}

const folderMcp = new Map<string, FolderMcpState>()
const dirKey = (dir: string): string => (dir.length > 1 ? dir.replace(/[/\\]+$/, '') : dir)

/** Guarda el resultado del escaneo de `dir`; `null` = no se pudo escanear (falla cerrado: preguntan todos los conectores). */
export function setFolderMcp(
  dir: string,
  scan: Pick<ProjectScanResult, 'items' | 'complete' | 'configRules' | 'globalConfigRules'> | null
): void {
  if (!scan) {
    folderMcp.set(dirKey(dir), { servers: [], askAll: true })
    return
  }
  setGlobalConfigRules(scan.globalConfigRules)
  const servers: FolderMcpState['servers'] = []
  for (const i of scan.items) {
    if (i.kind === 'mcp' && i.mcpKey) servers.push({ name: i.name, trustName: i.trustName, key: i.mcpKey, overrides: !!i.overrides })
  }
  folderMcp.set(dirKey(dir), {
    servers,
    askAll: !scan.complete,
    config: (scan.configRules ?? []).map((r) => ({ ...r }))
  })
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
export function projectAskRules(state: FolderMcpState | undefined, trusted: readonly string[], agent?: string): PermissionRuleLike[] {
  // Carpeta que no se escaneó en esta ejecución (restaurada al arrancar, abierta desde la barra…): falla cerrado, todo conector pregunta.
  if (!state) return [{ permission: '*_*', pattern: '*', action: 'ask' }, ...sessionConfigRules(globalConfigRules, agent)]
  const trustedNames = new Set(trusted)
  const keys = new Set<string>()
  for (const s of state.servers) {
    // La confianza se decide con el nombre CRUDO (`trustName`); `name` está saneado solo para mostrar y no sirve para esto.
    if (!s.overrides && s.trustName !== undefined && trustedNames.has(s.trustName)) continue
    keys.add(s.key)
  }
  const rules: PermissionRuleLike[] = [...keys].sort().map((k) => ({ permission: k, pattern: '*', action: 'ask' as const }))
  if (state.askAll) rules.unshift({ permission: '*_*', pattern: '*', action: 'ask' })
  // Lo que la config NIEGA va DESPUÉS de los `ask`: gana la última regla que coincide, y las de sesión van después de las de la config, así que un
  // `ask` de conector taparía un `deny` (`prueba_start: deny`, `*: deny`, `agent.build.permission`…) y lo dejaría en «preguntar». Ver `sessionConfigRules`.
  return [...rules, ...sessionConfigRules([...globalConfigRules, ...(state.config ?? [])], agent)]
}

/** Reglas de conectores de la carpeta `dir` con la lista de confianza actual de Ajustes. Nunca lanza. */
export function projectAskOf(dir: string, agent?: string): PermissionRuleLike[] {
  let trusted: readonly string[] = []
  try {
    trusted = useSettings.getState().settings.codeTrustedMcp ?? []
  } catch {
    trusted = []
  }
  return projectAskRules(folderMcpOf(dir), trusted, agent)
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
  const app = [...bgshellSessionRules(mode), ...documentsSessionRules(mode)]
  // Si la config NIEGA algo, esos `deny` van tras los `ask` y un patrón amplio (`*_*`, `*start*`, `*`) alcanzaría también a las herramientas propias de la app
  // (`bgshell_*`, `documentos_*`), que antes (1.8.11, y 1.8.12 sin los deny) volvían a abrir sus reglas de sesión. Se repiten tras los `deny` y, donde los `ask`
  // de conector las cubrían (carpeta sin enumerar o que redefine `bgshell`/`documentos`), se repite su `ask`: mismo resultado que antes, sin aflojar nada.
  const hasDeny = projectAsk.some((r) => r.action === 'deny')
  const tail: PermissionRuleLike[] = []
  if (hasDeny) {
    tail.push(...app)
    for (const p of new Set(app.map((r) => r.permission)))
      if (projectAsk.some((r) => r.action === 'ask' && r.pattern === '*' && wildcardMatch(p, r.permission)))
        tail.push({ permission: p, pattern: '*', action: 'ask' })
  }
  return [...app, ...projectAsk, ...tail, ...rulesetForMode(mode, { linked })] as PermissionRuleset
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

/** Sesiones a las que esta ejecución ya les mandó el bloque con `permissionMode: "replace"` (para no repetirlo con un motor que no pone marca). */
const replacedSessions = new Set<string>()
const MAX_REPLACED = 2000

/**
 * ¿La sesión ya tiene el bloque del modo AL DÍA con el contrato de `lazunox.16`? Termina con el bloque pedido Y, además, ya fue reemplazada: o el
 * motor la marcó (`lazunox_modo_inicio`) o esta ejecución ya lo envió con `replace`. Una sesión de la 1.8.12 que termina con el bloque pero
 * arrastra los anteriores (p. ej. un «Solo explorar» viejo) NO está al día: se reenvía una vez con `replace` y el motor la deja limpia, que es lo
 * que arregla a los ayudantes. Con un motor anterior (sin marca) se reenvía una sola vez por sesión y ejecución, no en cada mensaje.
 */
export function sessionRulesUpToDate(sessionID: string, session: PermissionRuleset | undefined, wanted: PermissionRuleset): boolean {
  if (!endsWithRuleset(session, wanted)) return false
  return hasModeMark(session) || replacedSessions.has(sessionID)
}

/** Se mandó el bloque con `replace` a esta sesión (llamar tras un `session.update` o `session.create` bien hecho). */
export function noteRulesReplaced(sessionID: string): void {
  if (replacedSessions.size >= MAX_REPLACED) replacedSessions.clear()
  replacedSessions.add(sessionID)
}
