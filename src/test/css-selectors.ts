// Utilidades de las guardias de CSS (desktop-unchanged.test.tsx y app/desktop/desktop-scope.test.ts).

/** Selectores de las reglas de un CSS (fuera de `@keyframes` y de los bloques de cuerpo), sin comentarios. */
export function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  let depth = 0
  let buf = ''
  const stack: boolean[] = [] // true = bloque transparente (@media/@supports/@layer), false = cuerpo o keyframes
  for (const ch of text) {
    if (ch === '{') {
      const head = buf.trim()
      buf = ''
      const parentOpaque = stack.some((t) => !t)
      if (!parentOpaque && !head.startsWith('@')) out.push(head)
      stack.push(head.startsWith('@') && !/^@(keyframes|font-face)/.test(head))
      depth++
    } else if (ch === '}') {
      stack.pop()
      depth--
      buf = ''
    } else if (ch === ';' && depth === 0) buf = ''
    else buf += ch
  }
  return out.flatMap(splitTop)
}

/** Separa por comas de primer nivel (las de dentro de `:is(…)`/`:not(…)` no cuentan). */
export function splitTop(head: string): string[] {
  const parts: string[] = []
  let d = 0
  let cur = ''
  for (const ch of head) {
    if (ch === '(') d++
    if (ch === ')') d--
    if (ch === ',' && d === 0) {
      parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  parts.push(cur.trim())
  return parts.filter(Boolean)
}
