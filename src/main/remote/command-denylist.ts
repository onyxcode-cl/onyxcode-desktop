/**
 * Lista de denegación para aprobar `bash` / `edit` «una vez» DESDE EL CELULAR (hallazgo 2 de la auditoría del remoto).
 *
 * Solo se consulta cuando el dueño encendió «Aprobar comandos desde este celular» para ese dispositivo. Se evalúa en el Mac sobre
 * el texto REAL del permiso (el que el motor pidió, no lo que diga el celular). Devuelve `null` si el texto pasa o un código
 * corto del motivo si coincide con algo sensible: en ese caso SIEMPRE se trata como clase D (confirmación en el Mac).
 *
 * ES UNA HEURÍSTICA, NO UN LÍMITE DE SEGURIDAD. Un comando que la lista deja pasar (`npm run x`, `make`, `./script.sh`, `git
 * commit` con ganchos…) puede ejecutar lo que el proyecto defina. El límite real es la confirmación en el Mac, el ajuste apagado
 * por defecto, el tope de 20 aprobaciones por hora y el ámbito de carpetas. Ante cualquier duda (comillas partidas, `\`, variables,
 * `$()`, comillas inversas, llaves, sustituciones de procesos, caracteres de control, textos largos) el resultado es «denegar»
 * (D): se prefiere un falso positivo (el Mac pregunta) a un falso negativo.
 *
 * Puro: sin disco (el `realpath` se inyecta) ni red.
 */
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve, sep } from 'node:path'
import { isSensitivePath } from './path-guard'

export interface ApprovalEnv {
  /** Directorio de la sesión (ya con `realpath`): fuera de él, rutas y redirecciones se consideran peligrosas. */
  sessionDir: string
  home?: string
  /** `realpath` de una ruta (puede no existir); `null` = no se pudo resolver (se trata como fuera). Opcional. */
  realpath?: (p: string) => string | null
}

/** Texto más largo que esto no se analiza: duda → D (y el diálogo del Mac lo recortaría de todos modos). */
export const MAX_APPROVAL_TEXT = 2000

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash', 'busybox'])
/** Intérpretes: sin `-c/-e` y sin tubería a su entrada ejecutan un archivo del proyecto (como `npm run`), con ellas código arbitrario. */
const INTERPRETERS = /^(python[0-9.]*|perl[0-9.]*|ruby|node|nodejs|php|deno|bun|lua|osascript|swift|java|tclsh|wish|expect)$/
const INTERP_EVAL_FLAGS = new Set(['-c', '-e', '-p', '-r', '--eval', '--print', '-E', '-x'])

const DENY_COMMANDS = new Set([
  'sudo',
  'su',
  'doas',
  'ssh',
  'scp',
  'sftp',
  'ssh-add',
  'ssh-agent',
  'ssh-keygen',
  'ssh-keyscan',
  'nc',
  'ncat',
  'netcat',
  'socat',
  'telnet',
  'ftp',
  'security',
  'osascript',
  'launchctl',
  'diskutil',
  'dd',
  'crontab',
  'at',
  'batch',
  'eval',
  'source',
  '.',
  'open',
  'hdiutil',
  'mount',
  'umount',
  'tmutil',
  'networksetup',
  'systemsetup',
  'sysadminctl',
  'spctl',
  'csrutil',
  'pmset',
  'shutdown',
  'reboot',
  'halt',
  'passwd',
  'visudo',
  'dscl',
  'dseditgroup',
  'kmutil',
  'killall',
  'pkill',
  'chflags',
  'shred'
])

/** Envoltorios que ejecutan lo que sigue: se evalúa el resto como otro comando. */
const WRAPPERS = new Set([
  'env',
  'command',
  'builtin',
  'nohup',
  'time',
  'exec',
  'nice',
  'ionice',
  'stdbuf',
  'xargs',
  'watch',
  'timeout',
  'caffeinate',
  'then',
  'do',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
  'coproc',
  'unbuffer'
])

const XARGS_DESTRUCTIVE = /^(rm|rmdir|unlink|chmod|chown|chgrp|mv|cp|ln|tee|dd|shred|truncate|sed|perl|tar)$/

const SYSTEM_BIN = /^\/(?:usr\/)?(?:local\/)?(?:s?bin)\/|^\/opt\/homebrew\/s?bin\/|^\/usr\/bin\//

/** Rutas sensibles o de persistencia en cualquier parte del texto (aunque estén dentro del directorio de la sesión). */
const SENSITIVE_TEXT_RE = new RegExp(
  [
    String.raw`(?:^|[/\s=~'"])\.(?:ssh|aws|gnupg|kube|azure|docker|gcloud|password-store)(?:[/\s'"]|$)`,
    String.raw`keychains?\b`,
    String.raw`\bid_(?:rsa|dsa|ecdsa|ed25519|xmss)\b`,
    String.raw`\.(?:netrc|npmrc|pypirc|git-credentials|pgpass)\b`,
    String.raw`\bauthorized_keys\b`,
    String.raw`Launch(?:Agents|Daemons)`,
    String.raw`\.(?:zshrc|zprofile|zshenv|zlogin|bashrc|bash_profile|bash_login|profile)\b`,
    String.raw`/etc/(?:passwd|shadow|sudoers|hosts|ssh|pam\.d)`,
    String.raw`\.git/(?:hooks|config)`,
    String.raw`/Library/(?:Keychains|Cookies)`,
    String.raw`\.local/share/opencode`
  ].join('|'),
  'i'
)

const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/

function expandHome(p: string, home: string): string {
  if (p === '~') return home
  if (p.startsWith('~/')) return resolve(home, p.slice(2))
  return p
}

/** ¿`p` queda ESTRICTAMENTE dentro del directorio de la sesión (no es el propio directorio) por ruta léxica y real? */
function strictlyInside(p: string, env: ApprovalEnv, home: string): boolean {
  if (p.includes('\0')) return false
  const dir = resolve(env.sessionDir)
  const abs = resolve(dir, expandHome(p, home))
  const inside = (base: string, x: string): boolean => x !== base && x.startsWith(base.endsWith(sep) ? base : base + sep)
  if (!inside(dir, abs)) return false
  if (env.realpath) {
    const realDir = env.realpath(dir)
    const real = env.realpath(abs)
    if (realDir === null || real === null || !inside(resolve(realDir), resolve(real))) return false
  }
  return true
}

/** Quita comillas y barras invertidas (`c"u"rl`, `s\udo` → `curl`, `sudo`): se analiza lo que el shell terminaría ejecutando. */
function flatten(raw: string): string {
  return raw.replace(/\\\r?\n/g, '').replace(/['"\\]/g, '')
}

const isFlag = (t: string): boolean => t.startsWith('-') && t.length > 1
const recursiveFlag = (t: string): boolean => /^-[A-Za-z]*[rR][A-Za-z]*$/.test(t) || t === '--recursive'

interface Seg {
  tokens: string[]
  piped: boolean
}

/** Divide por `; & | ( ) { }` y saltos de línea. `piped` = el segmento recibe la salida de una tubería (`|`, no `||`). */
function segments(flat: string): Seg[] {
  const out: Seg[] = []
  const parts = flat.split(/(\|\||&&|\||&|;|\n|\(|\)|\{|\})/)
  let piped = false
  for (const part of parts) {
    if (part === '|') {
      piped = true
      continue
    }
    if (
      part === '||' ||
      part === '&&' ||
      part === '&' ||
      part === ';' ||
      part === '\n' ||
      part === '(' ||
      part === ')' ||
      part === '{' ||
      part === '}'
    ) {
      piped = false
      continue
    }
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length > 0) out.push({ tokens, piped })
    piped = false
  }
  return out
}

/** Evalúa un comando simple (ya sin separadores). Devuelve un motivo o `null`. */
function checkCommand(tokens: string[], piped: boolean, env: ApprovalEnv, home: string, depth = 0): string | null {
  if (depth > 6) return 'nested'
  let i = 0
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i] as string)) i++
  const first = tokens[i]
  if (first === undefined) return null
  const rest = tokens.slice(i + 1)
  const lower = first.toLowerCase()
  const name = basename(lower)
  // Nombre de comando con comodines o llaves: no se sabe qué ejecuta.
  if (/[*?[\]]/.test(first)) return 'glob-command'
  // Comando por ruta fuera de la sesión y fuera de los directorios de herramientas del sistema.
  if ((isAbsolute(first) || first.startsWith('~') || first.includes('..')) && !SYSTEM_BIN.test(first) && !strictlyInside(first, env, home))
    return 'command-outside'
  if (SHELLS.has(name)) return 'shell'
  if (DENY_COMMANDS.has(name) || /^mkfs(\.|$)|^newfs|^fdisk$|^ssh-/.test(name)) return `cmd:${name}`
  if (INTERPRETERS.test(name)) {
    if (piped) return 'pipe-to-interpreter'
    if (rest.some((t) => INTERP_EVAL_FLAGS.has(t) || /^-[A-Za-z]*[ce]$/.test(t))) return 'interpreter-eval'
  }
  if (piped && (name === 'eval' || name === 'source' || name === '.')) return 'pipe-to-shell'
  if (WRAPPERS.has(name)) {
    // `timeout 5 cmd`, `nice -n 5 cmd`, `env -i VAR=x cmd`: se saltan opciones y su valor numérico.
    let j = 0
    while (j < rest.length && (isFlag(rest[j] as string) || /^\d+(\.\d+)?[smhd]?$/.test(rest[j] as string))) j++
    // `xargs` aplica el comando a una lista que no se ve aquí: con algo que borra, mueve o cambia permisos, siempre D.
    if (name === 'xargs' && XARGS_DESTRUCTIVE.test(basename((rest[j] ?? '').toLowerCase()))) return 'xargs-destructive'
    return checkCommand(rest.slice(j), piped, env, home, depth + 1)
  }
  switch (name) {
    case 'rm':
    case 'rmdir':
    case 'unlink': {
      if (rest.includes('--no-preserve-root')) return 'rm-root'
      const targets = rest.filter((t) => !isFlag(t))
      if (rest.some(recursiveFlag) || name === 'rmdir') {
        if (targets.length === 0) return 'rm-no-target'
        if (targets.some((t) => !strictlyInside(t, env, home))) return 'rm-outside'
      }
      return null
    }
    case 'chmod':
    case 'chown':
    case 'chgrp':
      return rest.some(recursiveFlag) ? `${name}-recursive` : null
    case 'defaults':
      return rest.some((t) => /^(write|delete|import|rename|remove)$/i.test(t)) ? 'defaults-write' : null
    case 'git':
      if (rest.some((t) => t === 'push')) return 'git-push'
      if (rest.includes('config') && rest.some((t) => t === '--global' || t === '--system')) return 'git-config-global'
      return null
    case 'rsync':
      return rest.some((t) => /^[^/\s-][^/\s]*:/.test(t) || t.includes('@') || /^(-e|--rsh)/.test(t)) ? 'rsync-remote' : null
    case 'curl':
    case 'wget':
      return rest.some((t) => /^(-d|-F|-T|--data|--form|--upload|--post|-X|--request|--json)/.test(t) || t.includes('@'))
        ? 'net-upload'
        : null
    case 'find':
      return rest.some((t) => /^-(exec|execdir|ok|okdir|delete)$/.test(t)) ? 'find-exec' : null
    case 'tee': {
      const t = rest.filter((x) => !isFlag(x))
      return t.some((x) => x !== '/dev/null' && !strictlyInside(x, env, home)) ? 'tee-outside' : null
    }
    default:
      return null
  }
}

/** Veredicto para un comando de `bash`: `null` = pasa; texto = motivo (siempre D). */
export function bashVerdict(command: string, env: ApprovalEnv): string | null {
  const home = env.home ?? homedir()
  if (typeof command !== 'string' || command.trim() === '') return 'empty'
  if (command.length > MAX_APPROVAL_TEXT) return 'too-long'
  if (CONTROL_RE.test(command)) return 'control-chars'
  // Expansiones y sustituciones: lo que se ejecuta no es lo que se lee.
  if (/`/.test(command)) return 'backtick'
  if (/\$(?=[^\s]|$)/.test(command.replace(/\$$/, ''))) return 'expansion'
  if (/[<>]\(/.test(command)) return 'process-substitution'
  if (/\{[^{}]*,[^{}]*\}|\{[^{}]*\.\.[^{}]*\}/.test(command)) return 'brace-expansion'
  const flat = flatten(command)
  if (SENSITIVE_TEXT_RE.test(flat) || SENSITIVE_TEXT_RE.test(command)) return 'sensitive-path'
  // Redirecciones: el destino debe quedar dentro del directorio de la sesión (o ser /dev/null).
  for (const m of flat.matchAll(/>>?\|?\s*([^\s;&|<>()]+)/g)) {
    const target = m[1] as string
    if (target === '/dev/null') continue
    if (!strictlyInside(target, env, home) || isSensitivePath(resolve(env.sessionDir, expandHome(target, home)))) return 'redirect-outside'
  }
  // Rutas absolutas, `~` y `..` fuera de la sesión (salvo /dev/null).
  for (const m of flat.matchAll(/(?:^|[\s=])((?:~[A-Za-z0-9_.-]*|\.\.|\/)[^\s;&|<>()]*)/g)) {
    const p = m[1] as string
    if (p === '/dev/null' || /^\/dev\/(?:stdin|stdout|stderr|tty)$/.test(p)) continue
    if (SYSTEM_BIN.test(p) && !p.slice(1).includes('..')) continue
    if (!strictlyInside(p, env, home)) return 'path-outside'
  }
  for (const seg of segments(flat)) {
    // Archivos sensibles por nombre (`.env`, claves…), también relativos al directorio de la sesión.
    for (const tok of seg.tokens.slice(1)) {
      if (!isFlag(tok) && isSensitivePath(resolve(env.sessionDir, expandHome(tok, home)))) return 'sensitive-file'
    }
    const why = checkCommand(seg.tokens, seg.piped, env, home)
    if (why) return why
  }
  return null
}

/** Veredicto para una edición («una vez» de `edit`): cada ruta debe quedar estrictamente dentro de la sesión y no ser sensible. */
export function editVerdict(paths: readonly string[], env: ApprovalEnv): string | null {
  const home = env.home ?? homedir()
  if (paths.length === 0) return 'empty'
  for (const p of paths) {
    if (typeof p !== 'string' || p.trim() === '') return 'empty'
    if (p.length > MAX_APPROVAL_TEXT) return 'too-long'
    if (CONTROL_RE.test(p)) return 'control-chars'
    if (/[*?[\]{}`$]/.test(p)) return 'glob-or-expansion'
    if (!strictlyInside(p, env, home)) return 'path-outside'
    const abs = resolve(env.sessionDir, expandHome(p, home))
    const real = env.realpath?.(abs) ?? null
    if (isSensitivePath(abs) || (real !== null && isSensitivePath(real)) || SENSITIVE_TEXT_RE.test(abs)) return 'sensitive-file'
  }
  return null
}

/** Permisos cuyo «una vez» puede aprobarse desde el celular (con el ajuste encendido y pasando la lista). */
export const PHONE_APPROVABLE_KINDS: ReadonlySet<string> = new Set(['bash', 'edit'])

/** `null` = el permiso `kind` con ese texto puede aprobarse desde el celular; si no, motivo (se pide confirmación en el Mac). */
export function approvalVerdict(kind: string, texts: readonly string[] | undefined, env: ApprovalEnv): string | null {
  if (!PHONE_APPROVABLE_KINDS.has(kind)) return 'kind'
  if (!texts || texts.length === 0) return 'unknown-text'
  if (kind === 'edit') return editVerdict(texts, env)
  for (const t of texts) {
    const why = bashVerdict(t, env)
    if (why) return why
  }
  return null
}
