/**
 * `JSON.parse` con reparación de los tropiezos típicos de un modelo al escribir JSON largo (un bloque ```pptx/xlsx/docx):
 *  - una comilla de más pegada a un valor suelto: `"bold":true"}`  →  `"bold":true}`
 *  - una coma antes de `}` o `]`: `[1,2,]`
 * Solo se toca el carácter exacto donde el analizador dice que falla y solo si es uno de esos dos casos; si no, se relanza el error original.
 * Quien lo usa igual valida el resultado contra el esquema del documento, así que una reparación equivocada no puede colarse.
 */
const MAX_FIXES = 12

export function parseLenient(raw: string): unknown {
  let text = raw
  let firstError: unknown
  for (let i = 0; i <= MAX_FIXES; i++) {
    try {
      return JSON.parse(text)
    } catch (err) {
      firstError ??= err
      const pos = Number(/position (\d+)/.exec(err instanceof Error ? err.message : '')?.[1])
      // Con la coma colgando, Node no informa la posición («Unexpected token ']'»): se quitan fuera de las cadenas.
      const fixed = Number.isInteger(pos) && pos > 0 && pos < text.length ? fixAt(text, pos) : stripTrailingCommas(text)
      if (fixed === null || fixed === text) break
      text = fixed
    }
  }
  throw firstError
}

/** Quita las comas que van justo antes de `}` o `]`, sin tocar lo que está dentro de comillas. */
function stripTrailingCommas(text: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) continue
    out += c
  }
  return out
}

function fixAt(text: string, pos: number): string | null {
  const ch = text[pos]
  const before = text.slice(0, pos)
  const after = text.slice(pos + 1)
  // Comilla de más justo después de true / false / null / un número, antes de `,` `}` o `]`.
  if (ch === '"' && /(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(before) && /^\s*[,}\]]/.test(after)) return before + after
  // Coma colgando antes de `}` o `]`.
  if ((ch === '}' || ch === ']') && /,\s*$/.test(before)) return before.replace(/,\s*$/, '') + text.slice(pos)
  return null
}
