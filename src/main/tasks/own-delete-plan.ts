/** Subconjunto cerrado de shell: borrados antes de lecturas, salvo guardias de existencia verificadas por main. */
import { posix } from 'node:path'
import { parseOwnDelete, type DeleteCommand } from './own-delete'

export interface OwnDeletePlan {
  command: DeleteCommand
  directories: string[]
  guards: Array<{ path: string; kind: '-e' | '-f' | '-d' }>
  segments: string[]
  replacement: string
  replacementSegments: string[]
}

export function planOwnDelete(source: string, cwd: string): OwnDeletePlan | null {
  // Sin expansiones, escapes, redirecciones, comentarios, procesos ni sintaxis de control.
  if (!source || source.length > 16000 || /[\x00-\x08\x0b-\x1f\x7f`$<>\\*?{}~#()]/.test(source) || !cwd.startsWith('/')) return null
  const fold = (path: string): string => path.normalize('NFD').toLowerCase()
  const parts: Array<{ text: string; separator: string }> = []
  let quote = ''
  let start = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (!';\n&|'.includes(c)) continue
    let separator = c
    if (c === '&' || c === '|') {
      if (source[i + 1] !== c) return null
      separator += source[++i]
    }
    const text = source.slice(start, i + 1 - separator.length).trim()
    // Rechaza también &&/|| seguidos de salto de línea (subconjunto deliberadamente pequeño).
    if (!text) return null
    parts.push({ text, separator })
    start = i + 1
  }
  if (quote) return null
  const tail = source.slice(start).trim()
  if (tail) parts.push({ text: tail, separator: '' })
  else if (!parts.length || ![';', '\n'].includes(parts.at(-1)!.separator)) return null
  if (parts.length > 100) return null
  let current = cwd
  const directories = [cwd]
  const guards: OwnDeletePlan['guards'] = []
  let command: DeleteCommand | null = null
  let reading = false
  let conditional = false
  const replacement: string[] = []
  const replacementSegments: string[] = []
  for (const [index, { text, separator }] of parts.entries()) {
    const tokens: string[] = []
    const re = /"([^"\n]*)"|'([^'\n]*)'|([^\s"']+)/gy
    let at = 0
    while (at < text.length) {
      while (/\s/.test(text[at] ?? '') && at < text.length) at++
      if (at === text.length) break
      re.lastIndex = at
      const match = re.exec(text)
      if (!match) return null
      at = re.lastIndex
      if (at < text.length && !/\s/.test(text[at])) return null
      tokens.push(match[1] ?? match[2] ?? match[3])
    }
    const verb = tokens[0]
    const deletion = parseOwnDelete(text)
    let next = text
    if (deletion) {
      if (reading || conditional) return null
      if (
        command &&
        (command.recursive !== deletion.recursive || command.directory !== deletion.directory || command.force !== deletion.force)
      )
        return null
      command ??= { ...deletion, paths: [] }
      for (const p of deletion.paths) {
        const absolute = posix.resolve(current, p)
        // No duplicados ni padres/hijos: cada rm sustituido debe haber podido terminar bien.
        const key = fold(absolute)
        if (command.paths.some((old) => fold(old) === key || fold(old).startsWith(key + '/') || key.startsWith(fold(old) + '/')))
          return null
        command.paths.push(absolute)
      }
      if (command.paths.length > 100) return null
      next = ':'
    } else if (verb === 'cd') {
      if (
        command ||
        conditional ||
        tokens.length !== 2 ||
        !tokens[1] ||
        /[\[\]]/.test(tokens[1]) ||
        tokens[1].startsWith('-') ||
        tokens[1].split('/').includes('..')
      )
        return null
      current = posix.resolve(current, tokens[1])
      directories.push(current)
      // Absoluto evita CDPATH; main comprueba existencia y ausencia de enlaces.
      next = 'cd -- ' + "'" + current.replace(/'/g, "'\\''") + "'"
    } else {
      if (!['test', '[', 'echo', 'printf', 'ls', 'cat', 'true', ':'].includes(verb)) return null
      // [ y ] solo como delimitadores del builtin; nada de globbing.
      if (tokens.some((t, i) => /[\[\]]/.test(t) && !(verb === '[' && ((i === 0 && t === '[') || (i === tokens.length - 1 && t === ']')))))
        return null
      if (verb === '[' && tokens.at(-1) !== ']') return null
      if (verb === 'true' && tokens.length !== 1) return null
      const guard = (verb === 'test' && tokens.length === 3) || (verb === '[' && tokens.length === 4)
      const following = guard && separator === '&&' ? parseOwnDelete(parts[index + 1]?.text ?? '') : null
      if (
        !reading &&
        !conditional &&
        guard &&
        ['-e', '-f', '-d'].includes(tokens[1]) &&
        tokens[2] &&
        !tokens[2].endsWith('/') &&
        !tokens[2].endsWith('/.') &&
        !tokens[2].split('/').includes('..') &&
        following?.paths.length === 1 &&
        !following.paths[0].endsWith('/.') &&
        posix.resolve(current, tokens[2]) === posix.resolve(current, following.paths[0])
      ) {
        guards.push({ path: posix.resolve(current, tokens[2]), kind: tokens[1] as '-e' | '-f' | '-d' })
        // Solo se usa si main confirma existencia/tipo antes de borrar el lote.
        next = ':'
      } else if (!['true', ':'].includes(verb)) {
        // Solo cd/true/: o la guardia anterior antes del lote. Cualquier otra comprobación o salida posterior
        // cierra el lote: no adelantar otro rm a través de una condición o lectura.
        if (!command) return null
        reading = true
      }
    }
    replacementSegments.push(next)
    replacement.push(next + separator)
    if (separator === '||') conditional = true
    // && después de cd/true/: o de un borrado validado es seguro; tras lecturas no habrá más borrados.
  }
  if (command?.paths.some((p) => directories.some((d) => fold(d) === fold(p) || fold(d).startsWith(fold(p) + '/')))) return null
  return command
    ? { command, directories, guards, segments: parts.map((p) => p.text), replacement: replacement.join(' '), replacementSegments }
    : null
}
