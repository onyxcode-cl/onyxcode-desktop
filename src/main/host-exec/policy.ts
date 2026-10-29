/**
 * Reglas de la herramienta `equipo_ejecutar` (nivel 2: un comando EXACTO que corre en el equipo, fuera del aislamiento de las Tareas, tras tu OK).
 *
 * La defensa principal es que la persona VE el comando completo y lo aprueba (como en Codex con los permisos escalados y en Claude Code con el
 * reintento sin aislamiento). Esta lista es la segunda capa: rechaza lo que NUNCA debería ejecutarse desde aquí, por más que se apruebe a la
 * carrera (privilegios de administrador, borrado de raíces, lectura de secretos, persistencia, descargar-y-ejecutar, salir a internet esquivando
 * la lista de sitios permitidos). No intenta ser exhaustiva: un intérprete (`python3 x.py`) siempre puede más de lo que ve esta lista.
 * Módulo PURO: sin Electron ni fs. Los mensajes van en español y le llegan al agente para que cambie de camino.
 */

export type HostCommandRejection =
  | 'empty'
  | 'too-long'
  | 'control-chars'
  | 'hidden-chars'
  | 'privilege'
  | 'destructive'
  | 'secrets'
  | 'persistence'
  | 'security-tools'
  | 'download-exec'
  | 'network'

export type HostCommandVerdict = { ok: true } | { ok: false; code: HostCommandRejection; message: string }

export const MAX_COMMAND_CHARS = 2000
export const MAX_COMMAND_LINES = 20

const reject = (code: HostCommandRejection, message: string): HostCommandVerdict => ({ ok: false, code, message })

// Caracteres de control (salvo tabulador, salto de línea y retorno) y los invisibles que esconden texto en la tarjeta.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const HIDDEN = /[​-‏‪-‮⁠-⁤﻿]/

/** Inicio de un comando dentro de una línea: al principio, o tras `;`, `&`, `|`, `(`, `{`, comillas de sustitución o espacio. */
const BEFORE = String.raw`(?:^|[;&|(){}\x60\s])`

const PRIVILEGE = new RegExp(
  `${BEFORE}(?:sudo|su|doas|pkexec|runas|gsudo)\\b|administrator privileges|-Verb\\s+RunAs|Start-Process[^\\n]*-Verb\\s+runas`,
  'i'
)

/** Objetivos que borrar de forma recursiva no tiene vuelta: raíces, carpeta personal, carpetas del sistema o unidades enteras. */
const DANGEROUS_TARGET = String.raw`(?:["']\$HOME["']/?\*?|["']~["']/?\*?|["']/["']|/|/\*|~|~/|~/\*|\$HOME/?\*?|\$\{HOME\}/?\*?|/(?:Users|System|Library|Applications|usr|etc|var|bin|sbin|opt|private|Volumes)(?:/\*?)?|/Users/[^/\s]+/?\*?|%USERPROFILE%\\?\*?|\$env:USERPROFILE\\?\*?|[A-Za-z]:\\?\*?|[A-Za-z]:\\(?:Windows|Users|Program Files)[^\s]*)`
const RM_RECURSIVE = new RegExp(
  `${BEFORE}(?:rm|rmdir|unlink|srm|trash)\\b[^;&|\\n]*\\s-[a-zA-Z]*[rRfF][a-zA-Z]*[^;&|\\n]*\\s${DANGEROUS_TARGET}(?=[\\s;&|)]|$)`,
  'i'
)
const WIN_RECURSIVE_DELETE = new RegExp(
  `${BEFORE}(?:Remove-Item|ri|rd|rmdir|del|erase)\\b[^;&|\\n]*(?:-Recurse|\\s/s\\b)[^;&|\\n]*?${DANGEROUS_TARGET}(?=[\\s;&|)'"]|$)`,
  'i'
)
const DISK_DESTRUCTIVE =
  /(?:^|[;&|\s])(?:mkfs[.\w]*|fdisk|parted|diskutil\s+(?:erase|partition|apfs\s+delete|secureErase|zeroDisk)|format\s+[A-Za-z]:|Format-Volume|Clear-Disk|dd\b[^;&|\n]*\bof=\/dev\/)/i
const FIND_DELETE = /\bfind\s+(?:\/|~|\$HOME)(?:\s|\/)[^;&|\n]*-delete\b/i

const SECRETS =
  /(?:\.ssh(?![\w.-])|\.aws(?![\w.-])|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.docker[\\/]config\.json|\.kube[\\/]config|\.config[\\/](?:gcloud|gh|op)\b|Library[\\/]Keychains|Library[\\/]Cookies|Login Data|Local State|Cookies\.binarycookies|id_(?:rsa|ed25519|ecdsa|dsa)\b|\.git-credentials|credentials\.json|AppData[\\/](?:Local|Roaming)[\\/][^\s'"]*(?:Login Data|Cookies|Credentials))/i
const KEYCHAIN_TOOLS = new RegExp(
  `${BEFORE}(?:security\\s+(?:find|dump|export|import|add|delete|set|unlock|list|create|default)|cmdkey|vaultcmd)\\b`,
  'i'
)

const PERSISTENCE = new RegExp(
  `(?:LaunchAgents|LaunchDaemons)|${BEFORE}(?:launchctl\\s+(?:load|bootstrap|submit|enable|kickstart)|crontab\\s+[^\\n]*[^-\\s]|schtasks\\s+/create|sc(?:\\.exe)?\\s+create|New-Service|Register-ScheduledTask|reg(?:\\.exe)?\\s+add|New-ItemProperty|Set-ItemProperty[^\\n]*\\\\Run\\b|at\\s+\\d)`,
  'i'
)
const PROFILE_WRITE =
  /(?:>>?|\btee\b|\bsed\s+-i|Add-Content|Set-Content|Out-File)[^;&|\n]*(?:\.zshrc|\.zprofile|\.zshenv|\.bashrc|\.bash_profile|\.profile|Microsoft\.PowerShell_profile|\.config[\\/]fish)/i

const SECURITY_TOOLS = new RegExp(
  `${BEFORE}(?:spctl|csrutil|tccutil|nvram|systemsetup|pmset\\s+[^\\n]*-a|defaults\\s+write\\s+(?:/Library|com\\.apple\\.(?:security|alf|loginwindow|LaunchServices))|Set-ExecutionPolicy|Set-MpPreference|Add-MpPreference|netsh\\s+advfirewall|bcdedit|xattr\\s+[^\\n]*quarantine)\\b`,
  'i'
)

const DOWNLOAD_EXEC = new RegExp(
  `(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|fetch)\\b[^\\n|;&]*\\|\\s*(?:sudo\\s+)?(?:sh|bash|zsh|fish|dash|ksh|python\\d?|perl|ruby|node|php|osascript|iex|Invoke-Expression|powershell|pwsh)\\b|${BEFORE}(?:iex|Invoke-Expression)\\b|-(?:enc|EncodedCommand|e)\\s+[A-Za-z0-9+/=]{20,}|base64\\s+(?:-d|--decode)[^\\n]*\\|\\s*(?:sh|bash|zsh|python\\d?|iex)`,
  'i'
)

const NET_TOOLS_ALWAYS = new RegExp(
  `${BEFORE}(?:nc|ncat|netcat|socat|telnet|ssh|scp|sftp|ftp|tftp|rsync\\s+[^\\n]*[\\w.-]+:|Test-NetConnection|New-Object\\s+Net\\.Sockets)\\b`,
  'i'
)
const NET_FETCH = new RegExp(`${BEFORE}(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|aria2c)\\b`, 'i')
const URL_HOST = /\b(?:https?|ftp):\/\/(?:[^@\s/]*@)?(\[[0-9a-fA-F:]+\]|[^\s/:?#'"]+)/gi
const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i

/** `curl` y parecidos solo hacia esta misma máquina (probar un servidor local); a internet va por la búsqueda web de la app, que respeta la lista de sitios. */
function fetchesNonLocal(command: string): boolean {
  if (!NET_FETCH.test(command)) return false
  const hosts = [...command.matchAll(URL_HOST)].map((m) => (m[1] ?? '').toLowerCase())
  if (hosts.length === 0) return true // `curl example.com`: sin URL completa no se sabe a dónde va
  if (hosts.some((h) => !LOCAL_HOST.test(h))) return true
  // Con una URL local y otro argumento que parece un dominio suelto (`curl localhost:8000 example.com`) tampoco.
  const bare = command
    .replace(URL_HOST, ' ')
    .match(/(?:^|\s)(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|xyz|cl|es|ai|co|me|info|edu|gov)(?:[/\s:]|$)/i)
  return !!bare
}

/** Revisa un comando antes de ejecutarlo. Pura y determinista; nunca lanza. */
export function checkHostCommand(raw: unknown): HostCommandVerdict {
  if (typeof raw !== 'string' || raw.trim() === '') return reject('empty', 'El comando está vacío.')
  const command = raw
  if (command.length > MAX_COMMAND_CHARS)
    return reject('too-long', `El comando es demasiado largo (máximo ${MAX_COMMAND_CHARS} caracteres): divídelo en pasos.`)
  if (command.split('\n').length > MAX_COMMAND_LINES)
    return reject('too-long', `El comando tiene demasiadas líneas (máximo ${MAX_COMMAND_LINES}): ejecuta un paso a la vez.`)
  if (CONTROL.test(command)) return reject('control-chars', 'El comando tiene caracteres de control: escríbelo en texto normal.')
  if (HIDDEN.test(command)) return reject('hidden-chars', 'El comando tiene caracteres invisibles: escríbelo en texto normal.')
  if (PRIVILEGE.test(command)) return reject('privilege', 'No se ejecutan comandos con privilegios de administrador (sudo, runas…).')
  if (RM_RECURSIVE.test(command) || WIN_RECURSIVE_DELETE.test(command) || DISK_DESTRUCTIVE.test(command) || FIND_DELETE.test(command)) {
    return reject(
      'destructive',
      'Ese comando borra o formatea carpetas enteras del equipo; no se ejecuta. Borra solo lo concreto que te pidieron.'
    )
  }
  if (SECRETS.test(command) || KEYCHAIN_TOOLS.test(command)) {
    return reject('secrets', 'No se leen claves, llaves ni credenciales del equipo (SSH, llavero, navegadores, nube…).')
  }
  if (PERSISTENCE.test(command) || PROFILE_WRITE.test(command)) {
    return reject('persistence', 'No se instalan tareas programadas, servicios ni cambios al arranque o al perfil de la terminal.')
  }
  if (SECURITY_TOOLS.test(command)) return reject('security-tools', 'No se tocan los ajustes de seguridad del sistema.')
  if (DOWNLOAD_EXEC.test(command))
    return reject('download-exec', 'No se descargan y ejecutan programas en el mismo paso; descarga, revisa y luego ejecuta por separado.')
  if (NET_TOOLS_ALWAYS.test(command) || fetchesNonLocal(command)) {
    return reject(
      'network',
      'Los comandos no salen a internet (así se respeta la lista de sitios permitidos): usa la búsqueda web, o `curl` solo a localhost.'
    )
  }
  return { ok: true }
}
