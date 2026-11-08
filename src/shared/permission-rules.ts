/**
 * Reglas de permisos de la sesión del motor para cada modo de Code (y de Comparar). Una sola fuente de verdad.
 *
 * Cómo se comporta el motor (OpenCode 1.19.0, verificado con el motor real, `docs/estudio-competencia/permisos-arreglo.md`):
 * - `session.update({ permission })` AÑADE las reglas al final de las que la sesión ya tenía; no las reemplaza.
 * - Gana la ÚLTIMA regla que coincide (permiso y patrón, ambos con comodines).
 * - En una orden compuesta (`ls && ls > f`, `ls | ls > f`) el motor evalúa cada subcomando POR SEPARADO (una regla `allow` para `ls`
 *   dejó pasar `ls > f` en la prueba original; en el motor 1.19.0 el patrón de una sentencia con redirección incluye la redirección, y un
 *   comodín final como `git log*` la casa: tampoco sirve) Por eso los comandos de solo lectura NO se permiten con reglas del motor: el motor
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
/** `git branch` solo se aprueba para LISTAR: con otros argumentos crea, borra o renombra ramas. */
const GIT_BRANCH_LIST = /^git branch(?:\s+(?:-a|-r|-v|-vv|--show-current|--list(?:\s+\S+)*))*\s*$/

type ApprovalKind = 'auto' | 'plan'

const withBoundary = (c: string): RegExp => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?:\\s|$)`)
const READ_ONLY_RES = READ_ONLY_COMMANDS.map(withBoundary)
/** Cualquier cosa que encadene, redirija, sustituya o cambie de línea: el comando deja de ser «uno solo y simple». */
const SHELL_META = /[><|;&`$\\(){}'"\n\r]|--output|--exec/
/**
 * Opciones de `git` que escriben archivos, ejecutan programas o cambian dónde/con qué configuración trabaja (1.8.12, RI de W-A1):
 * `--output=<archivo>` (git acepta abreviaturas: `--out…`), `--ext-diff`, `--textconv`, `-c clave=valor`, `-C <dir>`, `--git-dir`,
 * `--work-tree`, `--exec-path`, `--config-env`, `--namespace`. Con ellas un `git log`/`git diff` «de lectura» puede escribir `.git/config` u `opencode.json`.
 */
const GIT_RISKY_LONG = /^--(?:out|ext|text|git-dir|work-tree|exec-path|config-env|namespace)/
const hasRiskyGitOption = (cmd: string): boolean =>
  cmd.startsWith('git') && cmd.split(/\s+/).some((t) => GIT_RISKY_LONG.test(t) || /^-[cCo]/.test(t))

/**
 * ¿La app puede aprobar sola este comando completo? Solo si es UN comando simple de la lista de solo lectura, sin redirecciones, tuberías,
 * encadenado, sustituciones ni salidas a archivo. Si no, queda la pregunta del motor. `npm test`/`npm run` NUNCA se aprueban solos
 * (1.8.12, R1): ejecutan código del proyecto que «Automático» deja editar. `kind` se conserva por compatibilidad con quien la llama.
 */
export function isAutoApprovableCommand(_kind: ApprovalKind, command: string | undefined): boolean {
  if (typeof command !== 'string') return false
  const cmd = command.trim()
  if (!cmd || cmd.length > 500 || SHELL_META.test(cmd)) return false
  if (hasRiskyGitOption(cmd)) return false
  if (cmd.startsWith('git branch')) return GIT_BRANCH_LIST.test(cmd)
  return READ_ONLY_RES.some((re) => re.test(cmd))
}

/**
 * Marcas del bloque: las mismas órdenes en forma de regla `ask` (redundantes con `bash * ask`). Sirven para que la app reconozca por las
 * reglas de la SESIÓN con qué bloque está (los de «Automático» y «Editar sin preguntar» serían idénticos sin ellas).
 */
function approvalMarks(): PermissionRuleLike[] {
  return READ_ONLY_COMMANDS.map((c) => rule('bash', `${c} *`, 'ask'))
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
const GIT_CONFIG_PATTERNS = ['.git', '*/.git', '.git/*', '*/.git/*', '.gitattributes', '*/.gitattributes', '.gitmodules', '*/.gitmodules']
const GIT_CONFIG_ASK: PermissionRuleLike[] = GIT_CONFIG_PATTERNS.flatMap((p) => [rule('edit', p, 'ask'), rule('write', p, 'ask')])

/**
 * Configuración que el motor CARGA y ejecuta (1.8.12, R1 añadido C): `opencode.json`/`opencode.jsonc` del proyecto y de sus carpetas
 * superiores pueden declarar un conector MCP con `command` que se arranca la próxima vez que se carga el proyecto. Si la IA pudiera
 * escribirlos sin preguntar (modos «Editar sin preguntar» y «Automático»), sería ejecución de comandos sin tarjeta. Igual que `GIT_CONFIG_ASK`.
 */
const EXEC_CONFIG_PATTERNS = ['opencode.json', '*/opencode.json', 'opencode.jsonc', '*/opencode.jsonc']
const EXEC_CONFIG_ASK: PermissionRuleLike[] = EXEC_CONFIG_PATTERNS.flatMap((p) => [rule('edit', p, 'ask'), rule('write', p, 'ask')])

/** Carpetas fuera del proyecto: preguntan en todos los modos menos «Todo sin preguntar». */
const EXTERNAL_ASK = rule('external_directory', '*', 'ask')

/** Carpeta añadida a un proyecto (Ficha del proyecto): la IA entra sin preguntar; `ro` además no puede editar ni escribir en ella. */
export interface LinkedFolderRule {
  path: string
  mode: 'rw' | 'ro'
}

const trimSep = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)

/** Variantes de una ruta para el motor: tal cual y, si lleva `\`, con `/` (Windows). Siempre ruta ABSOLUTA, nunca un comodín suelto. */
function pathVariants(p: string): string[] {
  const t = trimSep(p)
  const slash = t.replace(/\\/g, '/')
  return slash === t ? [t] : [t, slash]
}

/** Una ruta añadida solo vale si es absoluta (`/…` o `C:\…`) y no es una raíz: así una regla de carpeta nunca abre más de lo pedido. */
export function isSafeLinkedPath(p: string): boolean {
  const t = trimSep(p.trim())
  if (/[*?\[\]{}\u0000-\u001f]/.test(t)) return false
  if (t === '/' || /^[A-Za-z]:$/.test(t)) return false
  return t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t)
}

/**
 * Reglas de las carpetas añadidas: `external_directory` permitido en la carpeta y debajo de ella; en «solo lectura», además `edit`/`write`
 * denegados (van DESPUÉS de los `allow` del modo, que son `*`: la última regla que casa manda).
 */
export function linkedFolderRules(linked: readonly LinkedFolderRule[] | undefined): PermissionRuleLike[] {
  const out: PermissionRuleLike[] = []
  for (const l of linked ?? []) {
    if (!isSafeLinkedPath(l.path)) continue
    for (const v of pathVariants(l.path)) {
      out.push(rule('external_directory', v, 'allow'), rule('external_directory', `${v}/*`, 'allow'))
      if (l.mode === 'ro') {
        for (const perm of ['edit', 'write']) out.push(rule(perm, v, 'deny'), rule(perm, `${v}/*`, 'deny'))
      }
    }
  }
  return out
}

/** ¿Es una regla de carpeta añadida? (ruta absoluta; las del modo usan `*` o rutas relativas). */
function isLinkedRule(r: PermissionRuleLike): boolean {
  const abs = /^(\/|[A-Za-z]:[\\/])/.test(r.pattern)
  if (r.permission === 'external_directory') return r.pattern !== '*'
  return abs && r.action === 'deny' && (r.permission === 'edit' || r.permission === 'write')
}
const withoutLinked = (rules: readonly PermissionRuleLike[]): PermissionRuleLike[] => rules.filter((r) => !isLinkedRule(r))

/** Bloque completo de un modo. Siempre una lista (nunca `undefined`): «Solo explorar» también tiene que anular lo que dejó el modo anterior. */
export function rulesetForMode(
  mode: PermissionModeId,
  opts: { engineAllowReadOnly?: boolean; linked?: readonly LinkedFolderRule[] } = {}
): PermissionRuleLike[] {
  const linked = linkedFolderRules(opts.linked)
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
        ...linked,
        // Los subagentes NO heredan los `ask` del padre; preguntar al lanzarlos es lo único que los cubre.
        rule('task', '*', 'ask')
      ]
    case 'acceptEdits':
      return [
        rule('edit', '*', 'allow'),
        rule('write', '*', 'allow'),
        ...GIT_CONFIG_ASK,
        ...EXEC_CONFIG_ASK,
        ...readRules(true),
        rule('bash', '*', 'ask'),
        rule('webfetch', '*', 'ask'),
        rule('websearch', '*', 'ask'),
        EXTERNAL_ASK,
        ...linked,
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
        ...approvalMarks(),
        // 1.8.12 (R4): «Solo explorar» también pregunta por la web (una página puede traer instrucciones o recibir datos de la sesión).
        rule('webfetch', '*', 'ask'),
        rule('websearch', '*', 'ask'),
        EXTERNAL_ASK,
        ...linked,
        rule('task', '*', 'ask'),
        rule('task', 'general', 'deny')
      ]
    case 'auto':
      return [
        rule('edit', '*', 'allow'),
        rule('write', '*', 'allow'),
        ...GIT_CONFIG_ASK,
        ...EXEC_CONFIG_ASK,
        ...readRules(true),
        rule('bash', '*', 'ask'),
        // Comparar no tiene quién apruebe en la interfaz: allí solo las tres órdenes de lectura de git las permite el propio motor.
        // Comparar (`engineAllowReadOnly`) usa el MISMO bloque: antes dejaba que el motor permitiera `git status*`/`git diff*`/`git log*` con
        // comodín, y ese patrón casa con redirecciones (`git log > f`), `git difftool`, opciones entre comillas, etc. (RI de W-A1). Ahora todo
        // comando pregunta y la columna de Comparar muestra la tarjeta; el costo es que `git status` también pide permiso allí.
        ...approvalMarks(),
        rule('webfetch', '*', 'ask'),
        rule('websearch', '*', 'ask'),
        EXTERNAL_ASK,
        ...linked,
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

/**
 * ¿La sesión termina con el bloque del modo, SIN contar las carpetas añadidas? Sirve para RECONOCER el modo (qué puede aprobar sola la app);
 * la idempotencia al reenviar usa `endsWithRuleset`, que sí las compara.
 */
export function endsWithModeBlock(sessionRules: readonly PermissionRuleLike[] | undefined, block: readonly PermissionRuleLike[]): boolean {
  return endsWithRuleset(withoutLinked(sessionRules ?? []), withoutLinked(block))
}

/** ¿Con qué bloque de aprobación termina la sesión? (para decidir si la app puede aprobar sola un comando de lectura). */
export function approvalKindOf(sessionRules: readonly PermissionRuleLike[] | undefined): ApprovalKind | null {
  if (endsWithModeBlock(sessionRules, rulesetForMode('auto'))) return 'auto'
  if (endsWithModeBlock(sessionRules, rulesetForMode('plan'))) return 'plan'
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
