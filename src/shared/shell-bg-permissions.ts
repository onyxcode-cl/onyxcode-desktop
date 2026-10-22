/**
 * Nombres y permisos de `bgshell` (shell en segundo plano supervisado): parte PURA, sin Node ni Electron, para que la usen tanto
 * `main` (`shell-bg-mcp.ts`, config del motor) como el renderer de Code (bloque de modo de la sesión). Movido aquí desde
 * `src/main/opencode/shell-bg-mcp.ts` (F8-B204), que lo re-exporta tal cual.
 */
import { effectiveModeFor, rulesetForMode, type PermissionModeId, type PermissionRuleLike, type RuleAction } from './permission-rules'

/** Clave del servidor en el bloque `mcp` del motor (y prefijo de las herramientas). */
export const SHELL_BG_SERVER = 'bgshell'
export const SHELL_BG_TOOLS = ['start', 'status', 'read', 'stop', 'list'] as const
export type ShellBgTool = (typeof SHELL_BG_TOOLS)[number]
/** Nombre final de la herramienta tal como lo ve el modelo y como lo nombran las reglas de permiso. */
export const shellBgToolId = (tool: ShellBgTool): string => `${SHELL_BG_SERVER}_${tool}`

// ── Permisos ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Acción del motor para `bgshell_start` en un modo/agente: LA MISMA que la regla efectiva de `bash` con patrón `*`
 * (`rulesetForMode(effectiveModeFor(modo, agente))`, de `src/shared/permission-rules.ts`, la misma fuente que usa el bloque de modo de
 * Code al hacer `session.update({ permission })`):
 *   Preguntar siempre / Editar sin preguntar / Solo explorar / Automático → `ask`;  Todo sin preguntar → `allow`.
 * `bgshell_start` no hereda la aprobación automática de comandos de solo lectura de «Automático» (la hace la app mirando el comando de
 * `bash`): un trabajo en segundo plano siempre pregunta salvo en «Todo sin preguntar». Si no hubiera regla de `bash *` se devuelve `ask`.
 */
export function bgshellToolAction(mode: PermissionModeId, agent?: string): RuleAction {
  const block = rulesetForMode(effectiveModeFor(mode, agent))
  for (let i = block.length - 1; i >= 0; i--) {
    const r = block[i]!
    if (r.permission === 'bash' && r.pattern === '*') return r.action
  }
  return 'ask'
}

/**
 * Reglas de sesión para las cinco herramientas, para enviar JUNTO al bloque de modo (`session.update({ permission })`):
 * `bgshell_start` igual que `bash`; `status|read|list|stop` en `allow` (solo miran o paran trabajos propios, no ejecutan nada).
 * Van ANTES del bloque del modo, no después: `endsWithRuleset`/`approvalKindOf` reconocen el modo porque la sesión TERMINA con su bloque.
 * Úsese como `[...bgshellSessionRules(modo, agente), ...rulesetForMode(...)]`.
 */
export function bgshellSessionRules(mode: PermissionModeId, agent?: string): PermissionRuleLike[] {
  return SHELL_BG_TOOLS.map((t) => ({
    permission: shellBgToolId(t),
    pattern: '*',
    action: t === 'start' ? bgshellToolAction(mode, agent) : ('allow' as const)
  }))
}

/**
 * Suelo de la configuración (bloque `permission` de la config inline, vale para TODOS los agentes y sesiones, también las hijas de
 * `task` y los motores donde no se envía bloque de modo): `bgshell_start` pregunta y el resto pasa. El bloque de sesión de
 * `bgshellSessionRules` lo sobrescribe después (p. ej. «Todo sin preguntar» → `allow`).
 */
export function bgshellConfigPermission(): Record<string, RuleAction> {
  return Object.fromEntries(SHELL_BG_TOOLS.map((t) => [shellBgToolId(t), t === 'start' ? 'ask' : 'allow'])) as Record<string, RuleAction>
}
