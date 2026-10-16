/**
 * Emulación MÍNIMA de un terminal para limpiar lo que imprime un comando: `\r` vuelve al inicio de la línea y sobrescribe, `\b`
 * retrocede, el texto se parte al llegar al ancho (`cols`), y se entienden los borrados (`ESC[K`, `ESC[2K`, `ESC[J`) y los
 * movimientos de cursor más comunes (`ESC[nG`, `ESC[nC`, `ESC[nD`, `ESC[nA`, `ESC[nB`). El resto de secuencias (colores, modos como
 * `ESC[?2004h`, OSC, pegado entre corchetes `ESC[200~`) se descartan. Así el redibujado que hace zsh/bash al mostrar el comando
 * tecleado, la marca de fin de línea de zsh (`%` + relleno) y las barras de progreso con `\r` quedan como las vería una persona.
 */
interface Row {
  chars: string[]
  /** La fila continúa a la anterior porque el texto llegó al ancho (no hubo salto de línea real). */
  wrapped: boolean
}

export interface EmulateOptions {
  cols?: number
  /** Texto que ya estaba en la fila actual antes de empezar (el prompt): el cursor queda justo después. */
  seed?: string
}

export function emulateTerminal(raw: string, opts: EmulateOptions = {}): string {
  const cols = Math.max(10, opts.cols ?? 80)
  const rows: Row[] = [{ chars: [], wrapped: false }]
  let row = 0
  let col = 0
  const put = (ch: string): void => {
    if (col >= cols) {
      row++
      if (row >= rows.length) rows.push({ chars: [], wrapped: true })
      else rows[row].wrapped = true
      col = 0
    }
    const r = rows[row].chars
    while (r.length < col) r.push(' ')
    r[col] = ch
    col++
  }
  for (const ch of Array.from(opts.seed ?? '')) put(ch)
  const s = raw
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\u001b') {
      const n = s[i + 1]
      if (n === '[') {
        let j = i + 2
        while (j < s.length && /[0-?]/.test(s[j])) j++
        const params = s.slice(i + 2, j)
        while (j < s.length && /[ -/]/.test(s[j])) j++
        const fin = s[j] ?? ''
        i = j
        const num = (def: number): number => {
          const m = /^(\d+)/.exec(params)
          return m ? Math.max(0, Number(m[1])) : def
        }
        const line = rows[row].chars
        if (fin === 'K') {
          const mode = num(0)
          if (mode === 0) line.length = Math.min(line.length, col)
          else if (mode === 1) for (let k = 0; k < Math.min(col + 1, line.length); k++) line[k] = ' '
          else line.length = 0
        } else if (fin === 'J') {
          if (num(0) === 0) {
            line.length = Math.min(line.length, col)
            rows.length = row + 1
          } else if (num(0) >= 2) {
            rows.length = 1
            rows[0] = { chars: [], wrapped: false }
            row = 0
            col = 0
          }
        } else if (fin === 'G') col = Math.max(0, Math.min(cols - 1, num(1) - 1))
        else if (fin === 'C') col = Math.min(cols - 1, col + Math.max(1, num(1)))
        else if (fin === 'D') col = Math.max(0, col - Math.max(1, num(1)))
        else if (fin === 'A') row = Math.max(0, row - Math.max(1, num(1)))
        else if (fin === 'B') {
          row = Math.min(rows.length - 1, row + Math.max(1, num(1)))
        }
        continue
      }
      if (n === ']') {
        // OSC: hasta BEL o ESC \
        let j = i + 2
        while (j < s.length && s[j] !== '\u0007' && !(s[j] === '\u001b' && s[j + 1] === '\\')) j++
        i = s[j] === '\u001b' ? j + 1 : j
        continue
      }
      if (n !== undefined && /[PX^_]/.test(n)) {
        let j = i + 2
        while (j < s.length && !(s[j] === '\u001b' && s[j + 1] === '\\')) j++
        i = j + 1
        continue
      }
      i++ // escape de 2 bytes
      continue
    }
    if (c === '\r') col = 0
    else if (c === '\n') {
      row++
      if (row >= rows.length) rows.push({ chars: [], wrapped: false })
    } else if (c === '\b') col = Math.max(0, col - 1)
    else if (c === '\t') col = Math.min(cols - 1, (Math.floor(col / 8) + 1) * 8)
    else if (c < ' ' || c === '\u007f' || c === '\u0085') continue
    else put(c)
  }
  const out: string[] = []
  for (const r of rows) {
    const text = r.chars.join('')
    if (r.wrapped && out.length) out[out.length - 1] += text
    else out.push(text)
  }
  return out.map((l) => l.replace(/\s+$/, '')).join('\n')
}
