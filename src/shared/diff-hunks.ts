/**
 * Trocea un diff unificado de UN archivo en cabecera + hunks (bloques `@@`). Lo comparten main (valida y
 * aplica el descarte por bloque) y el renderer (elige qué bloque se envía), así ambos cuentan igual.
 */
export interface SplitDiff {
  /** Líneas previas al primer `@@` (diff --git, index, ---, +++), cada una terminada en `\n`. */
  header: string
  /** Texto exacto de cada hunk, desde su `@@` hasta antes del siguiente, terminado en `\n`. */
  hunks: string[]
}

export function splitDiffHunks(patch: string): SplitDiff {
  const lines = patch.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  let header = ''
  const hunks: string[] = []
  let cur: string[] | null = null
  for (const line of lines) {
    if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)) {
      if (cur) hunks.push(cur.join('\n') + '\n')
      cur = [line]
    } else if (cur) cur.push(line)
    else header += line + '\n'
  }
  if (cur) hunks.push(cur.join('\n') + '\n')
  return { header, hunks }
}

/** El diff trae un solo archivo (una sola cabecera `diff --git`)? Solo así se ofrece descartar por bloque. */
export function isSingleFileDiff(patch: string): boolean {
  let n = 0
  for (const line of patch.split('\n')) if (line.startsWith('diff --git ')) n++
  return n === 1
}
