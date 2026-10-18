/**
 * Utilidades PURAS sobre diffs unificados para el flujo de PR: qué líneas del lado nuevo existen (para comentar «en línea»),
 * estadística por archivo y recorte por archivos completos.
 */

/** Líneas del lado NUEVO (contexto y añadidas) de cada archivo del diff: dónde GitHub admite un comentario en línea. */
export function rightSideLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  let file: string | null = null
  let next = 0
  // Líneas que le faltan al bloque `@@` actual (viejas y nuevas): así una línea vacía final no se toma por contexto.
  let oldRem = 0
  let newRem = 0
  for (const line of diff.split('\n')) {
    const inHunk = oldRem > 0 || newRem > 0
    if (!inHunk) {
      if (line.startsWith('diff --git ')) {
        file = null
        continue
      }
      if (line.startsWith('+++ ')) {
        const m = /^\+\+\+ b\/(.+)$/.exec(line)
        file = m ? m[1] : null
        if (file && !out.has(file)) out.set(file, new Set())
        continue
      }
      const h = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (h) {
        oldRem = h[1] === undefined ? 1 : Number(h[1])
        next = Number(h[2])
        newRem = h[3] === undefined ? 1 : Number(h[3])
      }
      continue
    }
    if (!file) continue
    if (line.startsWith('+')) {
      out.get(file)?.add(next++)
      newRem--
    } else if (line.startsWith('-')) {
      oldRem--
    } else if (line.startsWith('\\')) {
      // «\ No newline at end of file»: no avanza nada
    } else {
      // contexto (con espacio inicial, o vacío si un editor recortó el espacio)
      out.get(file)?.add(next++)
      newRem--
      oldRem--
    }
  }
  return out
}

export interface FileStat {
  file: string
  added: number
  removed: number
}

/** Estadística `+/−` por archivo calculada del propio diff (así nunca lista un archivo que ya se quitó por sensible). */
export function statFromDiff(diff: string): FileStat[] {
  const stats: FileStat[] = []
  let cur: FileStat | null = null
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(line)
      cur = { file: m ? m[1] : '?', added: 0, removed: 0 }
      stats.push(cur)
      inHunk = false
      continue
    }
    if (!cur) continue
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) cur.added++
    else if (line.startsWith('-')) cur.removed++
  }
  return stats
}

export function formatStat(stats: FileStat[]): string {
  return stats.map((s) => `${s.file} | +${s.added} -${s.removed}`).join('\n')
}

/** Cuenta los archivos (bloques `diff `) de un diff. */
export function countFiles(diff: string): number {
  let n = 0
  for (const l of diff.split('\n')) if (l.startsWith('diff --git ')) n++
  return n
}

/**
 * Recorta un diff a `max` caracteres cortando entre archivos (o entre bloques `@@` si un solo archivo no cabe).
 * Devuelve el texto y si se perdió algo.
 */
export function clipDiff(diff: string, max: number): { text: string; truncated: boolean } {
  if (diff.length <= max) return { text: diff, truncated: false }
  const cut = diff.lastIndexOf('\ndiff --git ', max)
  if (cut > 0) return { text: diff.slice(0, cut + 1), truncated: true }
  const hunk = diff.lastIndexOf('\n@@', max)
  return { text: diff.slice(0, hunk > 0 ? hunk + 1 : max), truncated: true }
}
