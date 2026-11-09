/**
 * Reglas de permisos de la sesión del motor para cada modo de Code (y de Comparar). Una sola fuente de verdad.
 *
 * Cómo se comporta el motor (OpenCode 1.19.0, verificado con el motor real, `docs/estudio-competencia/permisos-arreglo.md`):
 * - `session.update({ permission })` AÑADE las reglas al final de las que la sesión ya tenía; no las reemplaza.
 * - Gana la ÚLTIMA regla que coincide (permiso y patrón, ambos con comodines).
 * - En una orden compuesta (`ls && ls > f`, `ls | ls > f`) el motor evalúa cada subcomando POR SEPARADO (una regla `allow` para `ls`
 *   dejó pasar `ls > f` en la prueba original; en el motor 1.19.0 el patrón de una sentencia con redirección incluye la redirección, y un
 *   comodín final como `git log*` la casa: tampoco sirve). Por eso los comandos de solo lectura NO se permiten con reglas del motor: el motor
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
/**
 * `git branch` solo se aprueba en sus formas de listado SIN argumentos libres. Ya no vale `--list <patrón>` (RI4 de W-A1): `--list --no-list
 * -D x` borra ramas, y un comodín mete nombres de archivo como opciones.
 */
const GIT_BRANCH_LIST = /^git branch(?:\s+(?:-a|-r|-v|-vv|--show-current))*\s*$/

type ApprovalKind = 'auto' | 'plan'

const withBoundary = (c: string): RegExp => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?:\\s|$)`)
const READ_ONLY_RES = READ_ONLY_COMMANDS.map(withBoundary)
/**
 * LISTA BLANCA de caracteres (RI4 de W-A1): solo ASCII «aburrido» (letras, números, espacio, `. _ / : = , @ % ^ ~ + -`). Todo lo demás hace que
 * el comando deje de ser «uno solo y simple» y pregunte el motor: encadenado, redirecciones, sustituciones, comillas (también las tipográficas
 * U+2018-201E que PowerShell trata como comillas y recompone `--ou‘’tput`), llaves, comodines del shell (`*`, `?`, `[`, `]`: `git log *` se
 * expande a NOMBRES de archivo que la IA pudo crear, como `--output=opencode.json`), `!`, `#`, `\`, tabuladores, retornos de carro, caracteres
 * de control y de ancho completo. Costo: `ls *.ts` y las rutas con `\` de Windows piden tarjeta. `~` queda (`HEAD~1`), igual que `^` solo
 * detrás de letra o número (`HEAD^`): `^HEAD` es un comodín de zsh con `extendedglob` y `^` es el escape de cmd.exe.
 */
const SAFE_CHARS = /^[A-Za-z0-9 ._/:=,@%^~+-]+$/
const BAD_CARET = /(?:^|[^A-Za-z0-9])\^/
/**
 * `%` solo dentro de un token `--format=…`, `--pretty=…` o `--date=…` (RI5). Con cmd.exe como shell, `%VAR%`/`%VAR:~0,2%` se expanden ANTES
 * de que git vea el comando y podrían recomponer una opción prohibida partida en trozos. Este filtro solo REDUCE ese riesgo, no lo impide:
 * dentro del valor de `--format=`, `%VAR:~n,m%` aún puede reconstruir otra opción. PowerShell (el shell por defecto del motor en Windows:
 * pwsh → powershell → Git Bash → cmd) no expande `%VAR%`. Residual (no se puede saber desde esta capa): con cmd.exe configurado a mano la
 * aprobación automática NO protege del todo (además cmd busca `git.bat` en la carpeta actual antes que en el PATH).
 */
const BAD_PERCENT = (cmd: string): boolean => cmd.split(' ').some((t) => t.includes('%') && !/^--(?:format|pretty|date)=/.test(t))
/** Mismas búsquedas de siempre (`--output`, `--exec`), sobre el comando sin `^` (defensa en profundidad contra `--o^utput` de cmd). */
const WRITE_OPTS = /--output|--exec/
/**
 * Opciones de `git` que escriben archivos, ejecutan programas o cambian dónde/con qué configuración trabaja (1.8.12, RI de W-A1):
 * `--output=<archivo>` (git 2.54 rechaza las abreviaturas `--ou=`/`--outp=`, pero bloquear `--out…` es inocuo), `--ext-diff`, `--textconv`, `-c clave=valor`, `-C <dir>`, `--git-dir`,
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
  if (!cmd || cmd.length > 500 || !SAFE_CHARS.test(cmd) || BAD_CARET.test(cmd) || BAD_PERCENT(cmd)) return false
  // Defensa en profundidad: las comprobaciones de opciones miran el comando SIN `^` y sin nada fuera de ASCII (con la lista blanca ya no llegan).
  const plain = cmd.replace(/\^/g, '').replace(/[^\x20-\x7e]/g, '')
  if (WRITE_OPTS.test(plain) || hasRiskyGitOption(plain)) return false
  if (plain.startsWith('git branch')) return GIT_BRANCH_LIST.test(plain)
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
export const GIT_CONFIG_PATTERNS = [
  '.git',
  '*/.git',
  '.git/*',
  '*/.git/*',
  '.gitattributes',
  '*/.gitattributes',
  '.gitmodules',
  '*/.gitmodules'
]
const GIT_CONFIG_ASK: PermissionRuleLike[] = GIT_CONFIG_PATTERNS.flatMap((p) => [rule('edit', p, 'ask'), rule('write', p, 'ask')])

/**
 * Configuración que el motor CARGA y ejecuta (1.8.12, R1 añadido C): `opencode.json`/`opencode.jsonc` del proyecto y de sus carpetas
 * superiores pueden declarar un conector MCP con `command` que se arranca la próxima vez que se carga el proyecto. Si la IA pudiera
 * escribirlos sin preguntar (modos «Editar sin preguntar» y «Automático»), sería ejecución de comandos sin tarjeta. Igual que `GIT_CONFIG_ASK`.
 */
export const EXEC_CONFIG_PATTERNS = [
  'opencode.json',
  '*/opencode.json',
  'opencode.jsonc',
  '*/opencode.jsonc',
  // Todo `.opencode/`: el motor carga y EJECUTA `.opencode/plugin(s)/*.{ts,js}` y `.opencode/tool(s)/*`, además de agentes, comandos y skills.
  // La app escribe `.opencode/agents` (Ajustes › Ayudantes) y `.opencode/skills` (habilidades aprendidas) desde el proceso principal con
  // `fs`, NO por la IA, así que estas reglas no las afectan. «Solo explorar» conserva su `allow` de `.opencode/plans/*.md` (otro bloque).
  '.opencode/*',
  '*/.opencode/*'
]
/** ¿La ruta casa con la configuración de git o la que el motor carga y ejecuta? (mismas listas de arriba; `*` casa también con «/»). */
export function isExecOrGitConfigPath(path: string): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase()
  return [...GIT_CONFIG_PATTERNS, ...EXEC_CONFIG_PATTERNS].some((g) => {
    const re = new RegExp(
      `^${g
        .toLowerCase()
        .replace(/[.+?^${}()|[\]\\-]/g, '\\$&')
        .replace(/\*/g, '.*')}$`
    )
    return re.test(p)
  })
}

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
  opts: {
    /** SIN EFECTO desde la 1.8.12 (se conserva solo porque `src/main/compare/engine.ts` aún lo pasa y ese archivo no es de este paquete): Comparar usa el mismo bloque. */
    engineAllowReadOnly?: boolean
    linked?: readonly LinkedFolderRule[]
  } = {}
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
        // Comparar usa el MISMO bloque (`engineAllowReadOnly` ya no hace nada; antes el motor permitía `git status*`/`git diff*`/`git log*` con comodín,
        // que casa con redirecciones, `git difftool`, opciones entre comillas…; RI de W-A1). Todo comando pregunta; la columna de Comparar
        // muestra la tarjeta. Costo: `git status` también pide permiso allí.
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

/** Tope de reglas que se toman de CADA config (defensa ante un archivo inflado) y largo máximo de cada texto. */
const CONFIG_RULES_MAX = 200
const CONFIG_TEXT_MAX = 200

/** Regla de un bloque `permission` de una config del motor; `agent` = viene de `agent.<build|plan>.permission` (solo vale para ese agente). */
export interface ConfigRule extends PermissionRuleLike {
  agent?: 'build' | 'plan'
}

const isAct = (v: unknown): v is RuleAction => v === 'allow' || v === 'ask' || v === 'deny'

/** Reglas de UN bloque `permission` (texto suelto = clave `*`; texto por clave; o mapa por patrón), en el mismo orden. */
function rulesOfBlock(p: unknown, agent: ConfigRule['agent'], out: ConfigRule[]): void {
  const push = (permission: string, pattern: string, action: RuleAction): void => {
    if (
      out.length >= CONFIG_RULES_MAX ||
      !permission ||
      permission.length > CONFIG_TEXT_MAX ||
      !pattern ||
      pattern.length > CONFIG_TEXT_MAX
    )
      return
    out.push(agent ? { permission, pattern, action, agent } : { permission, pattern, action })
  }
  if (isAct(p)) return push('*', '*', p)
  if (!p || typeof p !== 'object' || Array.isArray(p)) return
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (isAct(v)) push(k, '*', v)
    else if (v && typeof v === 'object' && !Array.isArray(v))
      for (const [pat, a] of Object.entries(v as Record<string, unknown>)) if (isAct(a)) push(k, pat, a)
  }
}

/**
 * Reglas de permiso de UNA config del motor ya leída (`permission` y `agent.build|plan.permission`), con todas las acciones y en su orden, con la
 * sintaxis `permission: "deny"` normalizada a `*: deny`. Dato no confiable: topes de cantidad y de largo; nunca lanza.
 */
export function configRulesOf(config: unknown): ConfigRule[] {
  const out: ConfigRule[] = []
  if (!config || typeof config !== 'object' || Array.isArray(config)) return out
  const o = config as Record<string, unknown>
  rulesOfBlock(o.permission, undefined, out)
  const agents = o.agent
  if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
    for (const a of ['build', 'plan'] as const) {
      const e = (agents as Record<string, unknown>)[a]
      if (e && typeof e === 'object' && !Array.isArray(e)) rulesOfBlock((e as Record<string, unknown>).permission, a, out)
    }
  }
  return out
}

/**
 * Lo que hay que mandar en la SESIÓN, DESPUÉS de las reglas `ask` de conector (W-A2): TODOS los `deny` de TODAS las fuentes de config (global, archivo de la
 * app, `opencode.json` de la carpeta y de las carpetas superiores, `agent.<agente>.permission`), tal cual (con la clave `*` y `permission: "deny"` ya
 * normalizado a `*: deny`) y sin repetir duplicados. DECISIÓN DE DISEÑO (falla cerrado): no se intenta imitar cómo el motor fusiona las configs (por clave,
 * «gana la última») ni se re-emite ningún `allow`/`ask` posterior a un `deny`; cualquier `deny` presente en cualquier fuente gana sobre todo lo demás.
 * Consecuencia aceptada: «negar todo menos X» (y todo caso en que el motor respetaría un `allow` posterior) pasa a negar también X: más estricto que el
 * motor, nunca más laxo. Nunca devuelve `allow` ni `ask`. Agente `build` → solo las de `agent.build`; `plan` → solo las de `agent.plan`; cualquier otro
 * (agentes propios) → las de ambos (no se sabe en cuál se basan).
 */
export function sessionConfigRules(rules: readonly ConfigRule[], agent?: string): PermissionRuleLike[] {
  const applies = (r: ConfigRule): boolean =>
    !r.agent || (agent === 'build' ? r.agent === 'build' : agent === 'plan' ? r.agent === 'plan' : true)
  const out: PermissionRuleLike[] = []
  const seen = new Set<string>()
  for (const r of rules) {
    if (r.action !== 'deny' || !applies(r)) continue
    const k = `${r.permission}\u0000${r.pattern}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(rule(r.permission, r.pattern, 'deny'))
  }
  return out
}

/** Mismo comparador que el motor (`Wildcard.match`): `*` cualquier cosa, `?` un carácter, y un « *» final es opcional. */
export function wildcardMatch(str: string, pattern: string): boolean {
  const s = str.replaceAll('\\', '/')
  let p = pattern
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  if (p.endsWith(' .*')) p = p.slice(0, -3) + '( .*)?'
  return new RegExp('^' + p + '$', 's').test(s)
}
