/**
 * Reglas de permisos de la sesión del motor para cada modo de Code (y de Comparar). Una sola fuente de verdad.
 *
 * Cómo se comporta el motor (OpenCode 1.19.0, verificado con el motor real, `docs/estudio-competencia/permisos-arreglo.md`):
 * - `session.update({ permission })` AÑADE las reglas al final de las que la sesión ya tenía; no las reemplaza.
 * - Gana la ÚLTIMA regla que coincide (permiso y patrón, ambos con comodines).
 * - En una orden compuesta (`ls && ls > f`, `ls | ls > f`) el motor evalúa cada subcomando POR SEPARADO y SIN su redirección: una regla
 *   `allow` para `ls` deja pasar `ls > f`. Por eso los comandos de solo lectura NO se permiten con reglas del motor: el motor
 *   pregunta y la app aprueba sola solo si ella misma comprueba el comando completo (`isAutoApprovableCommand`).
 * Cada bloque es AUTOSUFICIENTE: empieza fijando, para cada permiso que la app gestiona, un valor explícito con patrón `*`
 * (anula lo que dejaran bloques anteriores) y recién después añade las excepciones. El resultado para esos permisos solo depende del
 * ÚLTIMO bloque enviado: una sesión creada en «Preguntar siempre» y cambiada a «Automático» se comporta igual que una creada en «Automático».
 * Lo que la app no gestiona (`doom_loop`, `question`, las herramientas MCP…) queda como lo dejan el agente y la configuración del usuario.
 */

export type RuleAction = 'allow' | 'ask' | 'deny'
export interface PermissionRuleLike {
  permission: string
  pattern: string
  action: RuleAction
}
export type PermissionModeId = 'manual' | 'acceptEdits' | 'plan' | 'auto' | 'bypass'

const rule = (permission: string, pattern: string, action: RuleAction): PermissionRuleLike => ({ permission, pattern, action })

/**
 * Comandos de SOLO LECTURA que «Automático» y «Solo explorar» aprueban solos (equivalentes de PowerShell incluidos). Se comparan
 * contra el comando completo: el comando solo o seguido de un espacio y argumentos (`ls` sí, `lsof` no).
 * Deliberadamente NO están `cat`/`type`/`Get-Content` (saltarían la pregunta de los archivos `.env`), `find`, `curl`, `npm install`…
 */
const READ_ONLY_COMMANDS = [
  'ls',
  'dir',
  'pwd',
  'git branch',
  'git show',
  'git rev-parse',
  'git status',
  'git diff',
  'git log',
  'Get-ChildItem',
  'Get-Location'
]
/** Solo «Automático»: pruebas y scripts del proyecto (ya estaban en la lista conservadora anterior). */
const PROJECT_COMMANDS = ['npm run', 'npm test']
/** La lista de «Automático» de antes (prefijos con comodín), que Comparar sigue pidiendo al motor. */
const LEGACY_AUTO_ALLOW = ['git status*', 'git diff*', 'git log*', 'npm run*', 'npm test*']
/** `git branch` solo se aprueba para LISTAR: con otros argumentos crea, borra o renombra ramas. */
const GIT_BRANCH_LIST = /^git branch(?:\s+(?:-a|-r|-v|-vv|--show-current|--list(?:\s+\S+)*))*\s*$/

type ApprovalKind = 'auto' | 'plan'

const withBoundary = (c: string): RegExp => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?:\\s|$)`)
const READ_ONLY_RES = READ_ONLY_COMMANDS.map(withBoundary)
const PROJECT_RES = PROJECT_COMMANDS.map(withBoundary)
/** Cualquier cosa que encadene, redirija, sustituya o cambie de línea: el comando deja de ser «uno solo y simple». */
const SHELL_META = /[><|;&`$\\()\n\r]|--output|--exec/

/**
 * ¿La app puede aprobar sola este comando completo? Solo si es UN comando simple de la lista de solo lectura (y, en «Automático», de
 * pruebas del proyecto), sin redirecciones, tuberías, encadenado, sustituciones ni salidas a archivo. Si no, queda la pregunta del motor.
 */
export function isAutoApprovableCommand(kind: ApprovalKind, command: string | undefined): boolean {
  if (typeof command !== 'string') return false
  const cmd = command.trim()
  if (!cmd || cmd.length > 500 || SHELL_META.test(cmd)) return false
  if (cmd.startsWith('git branch')) return GIT_BRANCH_LIST.test(cmd)
  if (READ_ONLY_RES.some((re) => re.test(cmd))) return true
  return kind === 'auto' && PROJECT_RES.some((re) => re.test(cmd))
}

/**
 * Marcas del bloque: las mismas órdenes en forma de regla `ask` (redundantes con `bash * ask`). Sirven para que la app reconozca por las
 * reglas de la SESIÓN con qué bloque está (los de «Automático» y «Editar sin preguntar» serían idénticos sin ellas).
 */
function approvalMarks(kind: ApprovalKind): PermissionRuleLike[] {
  const list = kind === 'auto' ? [...READ_ONLY_COMMANDS, ...PROJECT_COMMANDS] : READ_ONLY_COMMANDS
  return list.map((c) => rule('bash', `${c} *`, 'ask'))
}

/** Lectura: permitida, pero los `.env` siguen preguntando (política del motor; «Todo sin preguntar» la levanta como hasta ahora). */
function readRules(protectEnv: boolean): PermissionRuleLike[] {
  const out = [rule('read', '*', 'allow')]
  if (protectEnv) out.push(rule('read', '*.env', 'ask'), rule('read', '*.env.*', 'ask'), rule('read', '*.env.example', 'allow'))
  // Las herramientas de RECURSOS de un conector MCP (`list_mcp_resources`, `read_mcp_resource`…) piden permiso `read` con patrón
  // `mcp:<servidor>:*` (no `<servidor>_*`): sin esta regla el `read: * allow` las dejaría pasar sin tarjeta y un conector no confiado se leería
  // sin preguntar. Verificado en el binario del motor 1.19. «Todo sin preguntar» (bypass) no usa `readRules` y lo levanta como siempre.
  if (protectEnv) out.push(rule('read', 'mcp:*', 'ask'))
  return out
}

/**
 * Editar la configuración de git del proyecto SIEMPRE pregunta en los modos que dejan editar sin preguntar. Motivo (medido con git 2.54):
 * `core.fsmonitor` en `.git/config` hace que un `git status` EJECUTE ese comando, y `git status/diff/log/show` los aprueba sola la app
 * como «solo lectura» en «Automático»: editar `.git/config` + un `git status` aprobado sería ejecución de comandos sin ninguna pregunta.
 * Mismo riesgo con los hooks (`.git/hooks/*`), `.gitattributes` (filtros/textconv) y `.gitmodules`. Rutas relativas al proyecto; `*` casa
 * también con «/». No afecta a `.gitignore` ni a `.github/`.
 */
const GIT_CONFIG_PATTERNS = ['.git/*', '*/.git/*', '.gitattributes', '*/.gitattributes', '.gitmodules', '*/.gitmodules']
const GIT_CONFIG_ASK: PermissionRuleLike[] = GIT_CONFIG_PATTERNS.flatMap((p) => [rule('edit', p, 'ask'), rule('write', p, 'ask')])

/** Carpetas fuera del proyecto: preguntan en todos los modos menos «Todo sin preguntar». */
const EXTERNAL_ASK = rule('external_directory', '*', 'ask')

/** Bloque completo de un modo. Siempre una lista (nunca `undefined`): «Solo explorar» también tiene que anular lo que dejó el modo anterior. */
export function rulesetForMode(mode: PermissionModeId, opts: { engineAllowReadOnly?: boolean } = {}): PermissionRuleLike[] {
  switch (mode) {
    case 'manual':
      return [
        rule('edit', '*', 'ask'),
        rule('write', '*', 'ask'),
        ...readRules(true),
        rule('bash', '*', 'ask'),
        rule('webfetch', '*', 'ask'),
        rule('websearch', '*', 'ask'),
        EXTERNAL_ASK,
        // Los subagentes NO heredan los `ask` del padre; preguntar al lanzarlos es lo único que los cubre.
        rule('task', '*', 'ask')
      ]
    case 'acceptEdits':
      return [
        rule('edit', '*', 'allow'),
        rule('write', '*', 'allow'),
        ...GIT_CONFIG_ASK,
        ...readRules(true),
        rule('bash', '*', 'ask'),
        rule('webfetch', '*', 'ask'),
        rule('websearch', '*', 'ask'),
        EXTERNAL_ASK,
        rule('task', '*', 'allow')
      ]
    case 'plan':
      return [
        // Refleja al agente `plan` del motor (que niega editar salvo los planes `.md`), porque estas reglas van DESPUÉS de las del agente.
        rule('edit', '*', 'deny'),
        rule('edit', '.opencode/plans/*.md', 'allow'),
        rule('write', '*', 'deny'),
        rule('write', '.opencode/plans/*.md', 'allow'),
        ...readRules(true),
        rule('bash', '*', 'ask'),
        ...approvalMarks('plan'),
        rule('webfetch', '*', 'allow'),
        rule('websearch', '*', 'allow'),
        EXTERNAL_ASK,
        rule('task', '*', 'ask'),
        rule('task', 'general', 'deny')
      ]
    case 'auto':
      return [
        rule('edit', '*', 'allow'),
        rule('write', '*', 'allow'),
        ...GIT_CONFIG_ASK,
        ...readRules(true),
        rule('bash', '*', 'ask'),
        // Comparar no tiene quién apruebe en la interfaz: allí las cinco órdenes de siempre las permite el propio motor.
        ...(opts.engineAllowReadOnly ? LEGACY_AUTO_ALLOW.map((p) => rule('bash', p, 'allow')) : approvalMarks('auto')),
        rule('webfetch', '*', 'ask'),
        rule('websearch', '*', 'ask'),
        EXTERNAL_ASK,
        rule('task', '*', 'allow')
      ]
    case 'bypass':
      return [
        rule('edit', '*', 'allow'),
        rule('write', '*', 'allow'),
        rule('read', '*', 'allow'),
        rule('bash', '*', 'allow'),
        rule('webfetch', '*', 'allow'),
        rule('websearch', '*', 'allow'),
        rule('external_directory', '*', 'allow'),
        rule('task', '*', 'allow')
      ]
  }
}

function sameRule(a: PermissionRuleLike, b: PermissionRuleLike): boolean {
  return a.permission === b.permission && a.pattern === b.pattern && a.action === b.action
}

/**
 * ¿La sesión ya termina con este bloque? Como el motor acumula, comparar la lista entera con el bloque no iguala nunca tras el primer
 * cambio; lo que importa es que el ÚLTIMO bloque sea el pedido (idempotencia: reenviar el mismo modo no hace crecer la lista).
 */
export function endsWithRuleset(sessionRules: readonly PermissionRuleLike[] | undefined, block: readonly PermissionRuleLike[]): boolean {
  const have = sessionRules ?? []
  if (block.length === 0) return true
  if (have.length < block.length) return false
  const off = have.length - block.length
  return block.every((r, i) => sameRule(have[off + i]!, r))
}

/** ¿Con qué bloque de aprobación termina la sesión? (para decidir si la app puede aprobar sola un comando de lectura). */
export function approvalKindOf(sessionRules: readonly PermissionRuleLike[] | undefined): ApprovalKind | null {
  if (endsWithRuleset(sessionRules, rulesetForMode('auto'))) return 'auto'
  if (endsWithRuleset(sessionRules, rulesetForMode('plan'))) return 'plan'
  return null
}

/**
 * Modo que decide las reglas: el agente `plan` manda sobre el modo elegido (si no, un modo con `edit: allow` anularía su «no editar»).
 * Con el modo «Solo explorar» pero el agente `build` (se cambió a mano con el chip de Build/Plan) valen las reglas de «Preguntar siempre».
 */
export function effectiveModeFor(mode: PermissionModeId, agent: 'build' | 'plan' | string | undefined): PermissionModeId {
  if (agent === 'plan') return 'plan'
  return mode === 'plan' ? 'manual' : mode
}
