/**
 * Lógica pura del botón «Ejecutar en la terminal» de los bloques de código de Code (escritorio).
 *
 * - `shellFamilyOf`: ¿el lenguaje de la valla es de shell y corresponde a esta plataforma?
 * - `prepareTerminalCommand`: limpia el bloque (prompts `$ `/`> `, comentarios, salida) y lo deja listo para escribir.
 * - `dangerousCommandReason`: heurística de comandos que SIEMPRE piden confirmación antes de escribirse.
 *
 * Es una HEURÍSTICA, no un límite de seguridad: el límite real es que nada se ejecuta sin un clic explícito y, si el comando parece
 * delicado, sin una confirmación que muestra el comando completo. No reutiliza `src/main/remote/command-denylist.ts` porque aquel
 * análisis depende de `node:os`/`fs` y de una carpeta de sesión (aprobación remota); aquí solo hace falta reconocer la intención
 * (borrar, elevar privilegios, descargar y ejecutar…), que es lo que la persona debe ver antes de pulsar «Aceptar».
 */

export type ShellFamily = 'posix' | 'windows'

/** Lenguajes que Mac/Linux puede ejecutar y los de Windows. */
const POSIX_LANGS = new Set(['bash', 'sh', 'zsh', 'shell', 'console', 'sh-session', 'shellsession', 'shell-session'])
const WINDOWS_LANGS = new Set(['powershell', 'ps1', 'pwsh', 'cmd', 'bat', 'batch'])
/** Lenguajes donde las líneas SIN prompt son salida (transcripciones). */
const TRANSCRIPT_LANGS = new Set(['console', 'sh-session', 'shellsession', 'shell-session'])

export const MAX_TERMINAL_COMMAND_CHARS = 4000
export const MAX_TERMINAL_COMMAND_LINES = 40

/** Familia de shell que ofrece el botón para este lenguaje en esta plataforma, o `null` si no se ofrece. */
export function shellFamilyOf(lang: string | null | undefined, platform: string): ShellFamily | null {
  const l = (lang ?? '').toLowerCase()
  if (platform === 'win32') return WINDOWS_LANGS.has(l) ? 'windows' : null
  if (platform === 'darwin' || platform === 'linux') return POSIX_LANGS.has(l) ? 'posix' : null
  return null
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
/** Prompt al inicio de una línea: `$ cmd`, `% cmd`, `> cmd`, `PS C:\x> cmd`, `C:\x> cmd`, `user@host:~$ cmd`. */
const PROMPT_RES: RegExp[] = [
  /^\s*PS [^>\n]*>\s+/,
  /^\s*[A-Za-z]:\\[^>\n]*>\s*/,
  /^\s*[\w.-]+@[\w.-]+[:\s][^$#%>\n]*[$%]\s+/,
  /^\s*[$%]\s+/,
  /^\s*>\s+/
]

function stripPrompt(line: string): { text: string; had: boolean } {
  for (const re of PROMPT_RES) {
    const m = re.exec(line)
    if (m) return { text: line.slice(m[0].length), had: true }
  }
  return { text: line, had: false }
}

/** Líneas que casi seguro son salida de un programa y no un comando. */
const OUTPUT_LINE_RES: RegExp[] = [
  /^\s*(?:total \d+|[d-][rwx-]{9}[@+.]?\s)/,
  /^\s*(?:npm (?:ERR|WARN|notice)|error[: ]|warning[: ]|fatal: |Traceback \(|at \S+ \(.*:\d+:\d+\)|Error: |added \d+ packages|up to date)/i,
  /^\s*[✓✔✗✘×•│├└┌┐┘─]/u,
  /^\s*\d+ (?:passed|failed|errors?|warnings?)\b/i
]
const looksLikeOutput = (line: string): boolean => OUTPUT_LINE_RES.some((re) => re.test(line))

export type PrepareResult =
  | { ok: true; command: string; lines: string[]; family: ShellFamily }
  | { ok: false; reason: 'empty' | 'output' | 'too-long' | 'control' | 'platform' }

/**
 * Deja el bloque listo para escribir en la terminal: sin prompts, sin comentarios ni líneas en blanco sobrantes. En transcripciones
 * (`console`, `sh-session`) o bloques mixtos solo se toman las líneas con prompt. Un bloque que parece salida no se ofrece.
 */
export function prepareTerminalCommand(code: string, lang: string | null | undefined, platform: string): PrepareResult {
  const family = shellFamilyOf(lang, platform)
  if (!family) return { ok: false, reason: 'platform' }
  const raw = code.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (CONTROL_RE.test(raw)) return { ok: false, reason: 'control' }
  const parsed = raw.split('\n').map((l) => stripPrompt(l.replace(/\s+$/, '')))
  const anyPrompt = parsed.some((p) => p.had)
  const transcript = TRANSCRIPT_LANGS.has((lang ?? '').toLowerCase())
  if (transcript && !anyPrompt) return { ok: false, reason: 'output' }
  const kept: string[] = []
  let prevContinues = false
  for (const p of parsed) {
    const keep = anyPrompt ? p.had || prevContinues : true
    const trimmed = p.text.trim()
    // Comentarios completos (`# …`, cmd `REM`/`::`) y líneas en blanco: no se escriben.
    if (!keep || trimmed === '' || trimmed.startsWith('#') || /^(?:rem\s|::)/i.test(trimmed)) {
      prevContinues = false
      continue
    }
    kept.push(p.text)
    prevContinues = family === 'posix' ? /\\$/.test(trimmed) : /[`^]$/.test(trimmed)
  }
  if (kept.length === 0) return { ok: false, reason: 'empty' }
  if (kept.every(looksLikeOutput)) return { ok: false, reason: 'output' }
  const command = kept.join('\n')
  if (command.length > MAX_TERMINAL_COMMAND_CHARS || kept.length > MAX_TERMINAL_COMMAND_LINES) return { ok: false, reason: 'too-long' }
  return { ok: true, command, lines: kept, family }
}

/** Texto que se escribe en el pty: cada línea con Enter (`\r`, igual que la tecla). */
export function terminalInputFor(lines: readonly string[]): string {
  return lines.join('\r') + '\r'
}

export type DangerCode = 'delete' | 'privilege' | 'remote-exec' | 'permissions' | 'disk' | 'system' | 'git' | 'process' | 'secrets'

/** Envoltorios y palabras que no cambian lo que se ejecuta de verdad. */
const WRAPPERS = new Set(['command', 'builtin', 'time', 'nohup', 'env', 'exec', 'nice', 'xargs', 'then', 'do', 'else'])

/** Parte el comando en segmentos (`;`, `&&`, `||`, `|`, `&`, saltos de línea) respetando comillas simples y dobles. */
function segmentsOf(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  for (const c of cmd) {
    if (q) {
      cur += c
      if (c === q) q = null
    } else if (c === '"' || c === "'") {
      q = c
      cur += c
    } else if (c === ';' || c === '|' || c === '&' || c === '\n') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function headWord(segment: string): { name: string; rest: string } {
  let words = segment.split(/\s+/)
  while (words.length > 1 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || WRAPPERS.has(words[0].toLowerCase()))) words = words.slice(1)
  const name = (words[0] ?? '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.(exe|cmd|bat|ps1)$/i, '')
    .toLowerCase()
  return { name, rest: words.slice(1).join(' ') }
}

const DELETE_CMDS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'del', 'erase', 'rd', 'remove-item', 'ri', 'rimraf', 'trash'])
const PRIVILEGE_CMDS = new Set(['sudo', 'su', 'doas', 'runas', 'pkexec'])
const DISK_CMDS = new Set(['mkfs', 'dd', 'diskutil', 'fdisk', 'parted', 'diskpart', 'format', 'format-volume', 'clear-disk', 'initialize-disk', 'wipefs', 'newfs'])
const SYSTEM_CMDS = new Set([
  'shutdown', 'reboot', 'halt', 'poweroff', 'restart-computer', 'stop-computer', 'launchctl', 'systemctl', 'csrutil', 'spctl', 'defaults',
  'crontab', 'reg', 'regedit', 'sc', 'schtasks', 'netsh', 'bcdedit', 'set-executionpolicy', 'new-service', 'security', 'pmset', 'networksetup',
  'systemsetup', 'sysadminctl', 'dscl', 'passwd', 'visudo', 'tmutil', 'mount', 'umount', 'setx'
])
const PROCESS_CMDS = new Set(['kill', 'killall', 'pkill', 'taskkill', 'stop-process'])
const READ_ONLY_SUB = /^(?:read|status|list|query|show|search|info|--version|-v)\b/i

/** ¿El comando parece delicado? Devuelve el motivo (código corto) o `null`. Revisa el bloque entero y cada segmento por separado. */
export function dangerousCommandReason(command: string): DangerCode | null {
  const flat = command.replace(/\\\n/g, ' ')
  // Descargar y ejecutar: `curl … | sh`, `iwr … | iex`, `$(curl …)`, `bash <(curl …)`, `iex`, `base64 -d | sh`.
  if (
    /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|python[0-9.]*|perl|ruby|node|iex|invoke-expression|powershell|pwsh)\b/i.test(
      flat
    ) ||
    /(?:\$\(|`|<\()\s*(?:curl|wget|iwr|irm)\b/i.test(flat) ||
    /\b(?:iex|invoke-expression)\b/i.test(flat) ||
    /\bbase64\s+(?:-d|--decode|-D)\b[^\n]*\|\s*(?:sh|bash|zsh|iex)\b/i.test(flat) ||
    /\bdownloadstring\b|\bnet\.webclient\b/i.test(flat)
  )
    return 'remote-exec'
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(flat)) return 'process'
  // Secretos y sistema por ruta.
  if (/\.ssh\b|\bid_(?:rsa|ed25519|ecdsa)\b|(?:^|[\s/\\])\.env(?:\.\w+)?\b|\.aws[\\/]credentials|\.npmrc\b|\bkeychain\b/i.test(flat)) return 'secrets'
  if (
    /(?:^|[\s=>"'])\/(?:etc|System|Library|usr\/(?:bin|sbin|lib)|bin|sbin|var\/db|private\/etc)\b|[A-Za-z]:\\Windows\b|\bHK(?:LM|CU|CR)\b[:\\]|>\s*\/dev\/(?!null\b)/i.test(
      flat
    )
  )
    return 'system'
  for (const seg of segmentsOf(flat)) {
    const { name, rest } = headWord(seg)
    if (DELETE_CMDS.has(name)) return 'delete'
    if (PRIVILEGE_CMDS.has(name)) return 'privilege'
    if (DISK_CMDS.has(name) || name.startsWith('mkfs.')) return 'disk'
    if (PROCESS_CMDS.has(name)) return 'process'
    if (SYSTEM_CMDS.has(name) && !READ_ONLY_SUB.test(rest)) return 'system'
    if (name === 'takeown' || name === 'icacls') return 'permissions'
    if (name === 'chmod' || name === 'chown' || name === 'chgrp' || name === 'attrib') {
      if (/(?:^|\s)-[A-Za-z]*R\b|--recursive|(?:^|\s)\/s\b|\b[0-7]?777\b|\ba\+[rwx]*w/i.test(rest)) return 'permissions'
    }
    if (name === 'find' && /-delete\b|-exec\s+rm\b/.test(rest)) return 'delete'
    if (name === 'git') {
      if (
        /\bpush\b[^\n]*(?:--force|\s-f\b|\s\+\S)/.test(rest) ||
        /\breset\b[^\n]*--hard/.test(rest) ||
        /\bclean\b[^\n]*\s-[a-z]*[fd]/.test(rest) ||
        /\b(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/.test(rest) ||
        /\bbranch\b[^\n]*\s-D\b/.test(rest)
      )
        return 'git'
    }
    if ((name === 'npm' || name === 'pnpm' || name === 'yarn') && /\bpublish\b|(?:^|\s)(?:-g|--global)\b/.test(rest)) return 'system'
    if (['brew', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'pip', 'pip3', 'winget', 'choco'].includes(name) && /\b(?:uninstall|remove|purge|autoremove)\b/.test(rest))
      return 'system'
    if (name === 'set-content' || name === 'clear-content' || name === 'truncate') return 'delete'
  }
  return null
}
