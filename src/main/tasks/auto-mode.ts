/**
 * Modo auto: clasificador PURO de permisos y peticiones de acceso a apps.
 *
 * Sin Electron, sin `node:fs`, sin red: solo texto y regex, para poder probarlo sin la app (ver el
 * arnés del paquete C3). La allowlist de aquí es la FRONTERA de seguridad real, no el motor
 * (`auto-approver.ts`): ante la duda, todo lo que sigue devuelve 'ask'. Nunca se amplía esta lista
 * sin repetir la verificación completa del plan (`docs/COWORK-LOTE-C-PLAN.md`, B.9).
 *
 * Decisión del usuario (2026-09-28): Modo auto es SOLO motor de reglas, sin clasificador por modelo.
 */
import type { AppTier, AutoRuleId } from '@shared/ipc-tasks'

export type AutoVerdict = { decision: 'allow'; rule: AutoRuleId; summary: string } | { decision: 'ask'; reason: string }

function allow(rule: AutoRuleId, summary: string): AutoVerdict {
  return { decision: 'allow', rule, summary }
}

function ask(reason: string): AutoVerdict {
  return { decision: 'ask', reason }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// ───────────────────────────── Inyección ─────────────────────────────

/**
 * Frases que delatan un intento de inyección (en el texto de un permiso, sus metadatos, el motivo
 * de una tarjeta de acceso o el nombre de una app). Es/en, insensible a mayúsculas. Ante cualquier
 * coincidencia se pregunta SIEMPRE: el modo auto nunca es el que decide sobre texto sospechoso.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|the\s+)?(previous|prior)\s+instructions/i,
  /ignora\s+(las\s+)?instrucciones/i,
  /auto-?approv/i,
  /aprobaci[oó]n\s+autom/i,
  /bypass/i,
  /salt(ar|ate)\s+(la\s+)?(aprobaci|permiso)/i,
  /(disable|desactiva\w*)\s+(the\s+|el\s+|la\s+)?(approval|permission|sandbox|gate|modo|permiso|aprobaci)/i,
  /onyxcode_session/i,
  /plan-gate/i,
  /killswitch/i,
  /OPENCODE_(SERVER|AUTH|CONFIG)/,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
  /eres\s+ahora/i,
  /developer\s+mode/i,
  /<\|im_start\|>/i
]

export function looksLikeInjection(text: string): boolean {
  if (!text) return false
  return INJECTION_PATTERNS.some((re) => re.test(text))
}

/** JSON literal de los metadatos, o '' si no hay nada que mostrar. Nunca lanza. */
function metadataToText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) return ''
  try {
    return JSON.stringify(metadata)
  } catch {
    return String(metadata)
  }
}

// ───────────────────────────── bash de solo lectura ─────────────────────────────

/** Igual que `DELETE_RE` de `cowork/rules.ts`: mantener sincronizadas si una de las dos cambia. */
const DELETE_RE = /(^|[;&|]\s*)(rm|rmdir|unlink|trash|srm)\b|\s-delete\b/

/** Cualquiera de estos caracteres permite encadenar comandos, sustituir o redirigir: se rechaza. */
const BASH_FORBIDDEN_CHARS_RE = /[;&|`$<>\n\r\\]/

/** Rutas que nunca deben aparecer en un comando de solo lectura auto-aprobado. */
const SENSITIVE_PATH_RE = /(onyxcode-killswitch|cu-helper|\.ssh|\.aws|\.gnupg|Keychains|\.netrc|auth\.json|opencode\.json|\.env)\b/

const BASH_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'ls',
  'pwd',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'stat',
  'du',
  'df',
  'which',
  'whoami',
  'date',
  'uname',
  'sw_vers',
  'echo',
  'grep',
  'egrep',
  'rg',
  'jq',
  'tree',
  'mdls',
  'mdfind',
  'basename',
  'dirname',
  'realpath',
  'cut',
  'uniq',
  'tr',
  'diff',
  'cmp',
  'shasum',
  'md5',
  'find',
  'sort',
  'git'
])

const FIND_FORBIDDEN_ARGS: ReadonlySet<string> = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls'
])

const GIT_ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'ls-files',
  'blame',
  'describe',
  'branch',
  'remote',
  'tag'
])

/** `branch` de solo lectura: sin nada que no sea listar (nunca crear, borrar o renombrar ramas). */
const GIT_BRANCH_SAFE_ARGS: ReadonlySet<string> = new Set(['-a', '-r', '-v', '-vv', '--list', '--all', '--remotes', '--show-current'])

/** true si `s` tiene un número par de comillas simples y de dobles (sin escapes: ya se rechazan `\`). */
function hasBalancedQuotes(s: string): boolean {
  let single = 0
  let double = 0
  for (const ch of s) {
    if (ch === "'") single++
    else if (ch === '"') double++
  }
  return single % 2 === 0 && double % 2 === 0
}

function isReadOnlyGit(args: string[]): boolean {
  if (
    args.some(
      (a) =>
        a === '-c' ||
        a === '--output' ||
        a.startsWith('--output=') ||
        a === '--ext-diff' ||
        a === '--exec' ||
        a.startsWith('--exec=') ||
        a === '--upload-pack' ||
        a.startsWith('--upload-pack=')
    )
  ) {
    return false
  }
  const sub = args.find((a) => !a.startsWith('-'))
  if (!sub || !GIT_ALLOWED_SUBCOMMANDS.has(sub)) return false
  if (sub === 'branch') {
    const rest = args.filter((a) => a !== 'branch')
    return rest.every((a) => GIT_BRANCH_SAFE_ARGS.has(a))
  }
  if (sub === 'remote') return args.length === 2 && args[0] === 'remote' && args[1] === '-v'
  if (sub === 'tag') return args.length === 2 && args[0] === 'tag' && args[1] === '-l'
  return true
}

/**
 * ¿`command` es un comando de bash de solo lectura, según la lista cerrada del plan (B.9)? Puro:
 * solo mira el texto. La sesión que lo ejecuta corre igualmente dentro del sandbox de Cowork.
 */
export function isReadOnlyBash(command: string): boolean {
  if (typeof command !== 'string') return false
  const trimmed = command.trim()
  if (!trimmed) return false
  if (DELETE_RE.test(trimmed)) return false
  if (BASH_FORBIDDEN_CHARS_RE.test(trimmed)) return false
  if (!hasBalancedQuotes(trimmed)) return false
  if (SENSITIVE_PATH_RE.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/)
  const cmd = tokens[0]
  if (!BASH_ALLOWED_COMMANDS.has(cmd)) return false
  const args = tokens.slice(1)
  switch (cmd) {
    case 'find':
      return !args.some((a) => FIND_FORBIDDEN_ARGS.has(a))
    case 'sort':
      return !args.some((a) => a === '-o' || a === '--output' || a.startsWith('--output='))
    case 'tree':
      return !args.includes('-o')
    case 'tail':
      return !args.some((a) => a === '-f' || a === '-F' || a === '--follow' || a.startsWith('--follow'))
    case 'rg':
      return !args.some((a) => a === '--pre' || a === '--pre-glob' || a.startsWith('--pre=') || a.startsWith('--pre-glob='))
    case 'uniq':
      return args.filter((a) => !a.startsWith('-')).length <= 1
    case 'git':
      return isReadOnlyGit(args)
    default:
      return true
  }
}

// ───────────────────────────── MCP de solo lectura ─────────────────────────────

/** Prefijos de verbo que delatan una herramienta de SOLO CONSULTA. */
const MCP_READONLY_PREFIX_RE = /^(get|list|search|read|find|query|describe|view|show|lookup|count|check)(_|$)/i

/** Cualquiera de estas subcadenas en el nombre de la herramienta la descarta (defensa en profundidad). */
const MCP_WRITE_WORDS: readonly string[] = [
  'delete',
  'remove',
  'destroy',
  'drop',
  'send',
  'post',
  'create',
  'update',
  'write',
  'edit',
  'put',
  'patch',
  'set',
  'insert',
  'upload',
  'move',
  'rename',
  'share',
  'invite',
  'pay',
  'purchase',
  'buy',
  'order',
  'transfer',
  'approve',
  'grant',
  'revoke',
  'exec',
  'run',
  'eval',
  'execute',
  'deploy',
  'publish',
  'merge',
  'close',
  'archive',
  'trash',
  'reply',
  'comment',
  'submit',
  'login',
  'token',
  'secret',
  'password',
  'credential',
  'key',
  'auth'
]

/**
 * ¿`tool` de `server` es de solo lectura por su nombre? `server` solo descarta `computer`/`browser`
 * (que nunca son MCP del usuario); el resto de la comprobación de servidor la hace `ctx.mcpServers`
 * en `classifyPermission`.
 */
export function isReadOnlyMcpTool(server: string, tool: string): boolean {
  if (server === 'computer' || server === 'browser') return false
  if (typeof tool !== 'string' || !tool.trim()) return false
  const t = tool.trim().toLowerCase()
  if (!MCP_READONLY_PREFIX_RE.test(t)) return false
  return !MCP_WRITE_WORDS.some((w) => t.includes(w))
}

/** Servidor MCP (de `servers`, marcados en Cowork) cuyo nombre es prefijo de `permission`, si hay uno. */
function findMcpServer(permission: string, servers: string[]): { server: string; tool: string } | null {
  let best: { server: string; tool: string } | null = null
  for (const s of servers) {
    if (!s || s === 'computer' || s === 'browser') continue
    const prefix = `${s}_`
    if (permission.startsWith(prefix) && permission.length > prefix.length) {
      if (!best || s.length > best.server.length) best = { server: s, tool: permission.slice(prefix.length) }
    }
  }
  return best
}

// ───────────────────────────── permisos que nunca se aprueban solos ─────────────────────────────

const NEVER_ALONE_PERMISSIONS: ReadonlySet<string> = new Set([
  'external_directory',
  'doom_loop',
  'edit',
  'write',
  'task',
  'webfetch',
  'websearch'
])

/**
 * Clasifica una petición de permiso (`GET /permission`) del servidor de OpenCode. Puro: solo
 * texto + la lista de MCP del usuario marcados en Cowork (nunca `computer`/`browser`).
 */
export function classifyPermission(
  p: { permission: string; patterns: string[]; metadata?: Record<string, unknown> },
  ctx: { mcpServers: string[] }
): AutoVerdict {
  const permission = typeof p.permission === 'string' ? p.permission : ''
  const patterns = Array.isArray(p.patterns) ? p.patterns.filter((x): x is string => typeof x === 'string') : []
  const metadata = p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata) ? p.metadata : undefined

  if (!permission) return ask('petición sin permiso')
  if (NEVER_ALONE_PERMISSIONS.has(permission) || permission.startsWith('computer_') || permission.startsWith('browser_')) {
    return ask(`"${permission}" nunca se aprueba en automático`)
  }

  const metaText = metadataToText(metadata)
  if (patterns.some(looksLikeInjection) || looksLikeInjection(metaText)) {
    return ask('el contenido de la petición puede contener instrucciones inyectadas')
  }

  if (permission === 'bash') {
    const cmdMeta = typeof metadata?.command === 'string' ? metadata.command : null
    const toCheck = cmdMeta ? [...patterns, cmdMeta] : patterns
    if (toCheck.length === 0) return ask('sin comando de bash que comprobar')
    if (!toCheck.every((c) => isReadOnlyBash(c))) return ask('el comando no está en la lista de bash de solo lectura')
    return allow('bash-readonly', `bash de solo lectura: ${truncate(toCheck[0], 140)}`)
  }

  const m = findMcpServer(permission, ctx.mcpServers)
  if (!m) return ask(`"${permission}" no es bash ni una herramienta MCP marcada en Tareas`)
  if (metaText.length > 4000) return ask('los metadatos de la petición son demasiado largos')
  if (!isReadOnlyMcpTool(m.server, m.tool)) return ask(`"${permission}" no parece de solo lectura por su nombre`)
  return allow('mcp-readonly', `MCP de solo lectura: ${permission}`)
}

// ───────────────────────────── acceso a apps ("Solo ver") ─────────────────────────────

/**
 * Lista inicial de apps que el modo auto puede "ver" sin preguntar (bundle id). Decisión del
 * usuario (2026-09-28): la propuesta del plan; editable luego en Ajustes.
 */
export const DEFAULT_AUTO_VIEW_APPS: string[] = [
  'com.apple.finder',
  'com.apple.Preview',
  'com.apple.TextEdit',
  'com.apple.calculator',
  'com.apple.Maps',
  'com.apple.weather',
  'com.apple.clock',
  'com.apple.iWork.Pages',
  'com.apple.iWork.Numbers',
  'com.apple.iWork.Keynote'
]

/**
 * Apps que NUNCA se conceden en automático, aunque el usuario las meta en `viewApps` a mano:
 * gestores de contraseñas y llaveros, Ajustes del sistema, Mensajes y Mail, terminales/IDE
 * (mismas categorías que `CLICK_ONLY_PATTERNS` de `computer/grants.ts`) y banca/trading/cripto
 * (mismas categorías que `VIEW_ONLY_PATTERNS` de `computer/grants.ts`). Mantener sincronizadas si
 * una de las dos listas cambia.
 */
export const NEVER_AUTO_VIEW: RegExp[] = [
  /^com\.apple\.keychainaccess/i,
  /^com\.apple\.systempreferences/i,
  /^com\.apple\.preferences/i,
  /^com\.apple\.passwords/i,
  /1password/i,
  /agilebits/i,
  /^com\.bitwarden/i,
  /^com\.apple\.mobilesms/i,
  /^com\.apple\.mail/i,
  // Terminales / IDE (CLICK_ONLY_PATTERNS de grants.ts)
  /^com\.apple\.terminal/i,
  /^com\.googlecode\.iterm2/i,
  /^dev\.warp\.warp-stable/i,
  /^com\.github\.wez\.wezterm/i,
  /^io\.alacritty/i,
  /^com\.microsoft\.vscode/i,
  /^com\.todesktop\.230313mzl4w4u92/i,
  /^com\.jetbrains\./i,
  /^com\.apple\.scripteditor2/i,
  /^com\.apple\.automator/i,
  /^com\.apple\.shortcuts/i,
  /^com\.apple\.dt\.xcode/i,
  // Banca / trading / cripto (VIEW_ONLY_PATTERNS de grants.ts)
  /banc|bank|trading|broker|invest|crypto|coinbase|binance|kraken|wallet|exchange/i
]

function isNeverAutoView(bundleId: string, name: string): boolean {
  return NEVER_AUTO_VIEW.some((re) => re.test(bundleId) || re.test(name))
}

/**
 * Clasifica una tarjeta de acceso (`request_access`) a mitad de tarea. Solo puede aprobarse en
 * automático "Solo ver" (`view`), sin plan, sin `takeover`, de 1 a 3 apps conocidas de la lista.
 */
export function classifyAccess(
  q: {
    apps: Array<{ bundleId: string; name: string; requested?: AppTier; denied?: boolean }>
    plan?: string[]
    kind?: 'access' | 'takeover'
    reason?: string
  },
  ctx: { viewApps: string[] }
): AutoVerdict {
  if (q.plan && q.plan.length > 0) return ask('la tarjeta incluye un plan de pasos')
  if (q.kind === 'takeover') return ask('pide tomar el control de la pantalla')
  if (q.reason && looksLikeInjection(q.reason)) return ask('el motivo puede contener instrucciones inyectadas')
  const apps = Array.isArray(q.apps) ? q.apps : []
  if (apps.length === 0 || apps.length > 3) return ask('número de apps fuera del rango automático (1 a 3)')
  for (const a of apps) {
    if (!a || typeof a.bundleId !== 'string' || typeof a.name !== 'string') return ask('app sin identificar')
    if (looksLikeInjection(a.name)) return ask('el nombre de una app puede contener instrucciones inyectadas')
    if (a.denied) return ask(`"${a.name}" está denegada`)
    if (a.requested !== 'view') return ask(`"${a.name}" pide un nivel distinto de "Solo ver"`)
    if (isNeverAutoView(a.bundleId, a.name)) return ask(`"${a.name}" nunca se concede en automático`)
    if (!ctx.viewApps.includes(a.bundleId)) return ask(`"${a.name}" no está en la lista de apps que el modo auto puede ver`)
  }
  return allow('computer-view', `Solo ver: ${apps.map((a) => a.name).join(', ')}`)
}
