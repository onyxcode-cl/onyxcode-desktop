/**
 * Lectura del formato `.env` que se pega en la Bóveda del proyecto. Módulo PURO.
 * Reglas: `NOMBRE=valor`, `export NOMBRE=valor`, comentarios con `#` al inicio, valores entre comillas simples o dobles (las dobles pueden
 * ocupar varias líneas y entienden `\n`), sin expansión de variables ni de comandos (`$(…)` y `${…}` se guardan tal cual). Nunca lanza.
 */
export const MAX_VARS_PER_PROJECT = 50
export const MAX_VALUE_CHARS = 8000
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** Nombres que cambian cómo arranca o resuelve un programa: no se aceptan (la Bóveda es para datos, no para alterar el entorno). */
const FORBIDDEN_EXACT = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'PWD',
  'IFS',
  'BASH_ENV',
  'ENV',
  'ZDOTDIR',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  'RUBYOPT',
  'RUBYLIB',
  'PERL5OPT',
  'PERL5LIB',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'PROMPT_COMMAND',
  'PSModulePath',
  'COMSPEC',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'APPDATA',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'TMPDIR'
])
const FORBIDDEN_PREFIX = ['LD_', 'DYLD_', 'LAZUNOX_', 'ELECTRON_', 'OPENCODE_']

export function isForbiddenName(name: string): boolean {
  const up = name.toUpperCase()
  if (FORBIDDEN_EXACT.has(name) || FORBIDDEN_EXACT.has(up)) return true
  return FORBIDDEN_PREFIX.some((p) => up.startsWith(p))
}

export interface ParsedEnv {
  vars: Record<string, string>
  /** Líneas que no se pudieron leer o nombres rechazados (sin los valores). */
  problems: string[]
}

export function parseEnv(text: string): ParsedEnv {
  const vars: Record<string, string> = {}
  const problems: string[] = []
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([^\s=]+)\s*=\s*(.*)$/.exec(line)
    if (!m) {
      problems.push(`Línea ${i + 1}: no tiene la forma NOMBRE=valor.`)
      continue
    }
    const name = m[1]
    let rest = m[2]
    let value: string
    if (rest.startsWith('"')) {
      // Comillas dobles: puede seguir en las líneas siguientes hasta la comilla de cierre.
      let acc = rest.slice(1)
      let closed = false
      let j = i
      for (;;) {
        const close = findClosingQuote(acc)
        if (close >= 0) {
          acc = acc.slice(0, close)
          closed = true
          break
        }
        j++
        if (j >= lines.length) break
        acc += '\n' + lines[j]
      }
      if (!closed) {
        problems.push(`Línea ${i + 1}: falta cerrar las comillas de ${name}.`)
        continue
      }
      i = j
      value = acc.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1)
      if (end < 0) {
        problems.push(`Línea ${i + 1}: falta cerrar las comillas de ${name}.`)
        continue
      }
      value = rest.slice(1, end)
    } else {
      rest = rest.replace(/\s+#.*$/, '')
      value = rest.trim()
    }
    if (!NAME_RE.test(name)) {
      problems.push(`Línea ${i + 1}: «${name.slice(0, 40)}» no es un nombre válido (letras, números y _).`)
      continue
    }
    if (isForbiddenName(name)) {
      problems.push(`«${name}» no se acepta: cambia cómo arrancan los programas.`)
      continue
    }
    if (value.length > MAX_VALUE_CHARS) {
      problems.push(`«${name}» es demasiado largo (máximo ${MAX_VALUE_CHARS} caracteres).`)
      continue
    }
    vars[name] = value
  }
  return { vars, problems }
}

function findClosingQuote(s: string): number {
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\') {
      k++
      continue
    }
    if (s[k] === '"') return k
  }
  return -1
}
