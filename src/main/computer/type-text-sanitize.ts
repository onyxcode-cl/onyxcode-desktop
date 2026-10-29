/**
 * Saneado del FINAL de `type_text`: a veces el modelo deja colarse al cierre del texto etiquetas de protocolo de herramientas o tokens de
 * control (`</parameter>`, `</invoke>`, `<|im_end|>`…). Escribirlas ensucia el campo y puede enviar basura. Aquí se quitan SOLO del final,
 * sin tocar el resto, y se informa de lo quitado para que la respuesta lo diga.
 *
 * Reglas que protegen el texto legítimo:
 * - solo se mira el sufijo (etiquetas y espacios al final); nada en medio del texto cambia;
 * - una etiqueta de cierre con su apertura en el propio texto es contenido (XML/HTML escrito a propósito), no un resto;
 * - si el texto entero son etiquetas, se deja tal cual (la persona pudo pedir escribir justo eso);
 * - sin etiquetas sueltas al final, el texto vuelve idéntico (también los espacios y saltos de línea finales).
 *
 * Módulo puro: sin Electron, sin disco, sin red. No depende de la app ni de la plataforma de destino.
 */

/** Nombres de elemento de protocolo de herramientas (con o sin prefijo de espacio de nombres `x:`). */
const PROTOCOL_ELEMENTS = [
  'function_calls',
  'function_call',
  'function_results',
  'invoke',
  'parameter',
  'tool_calls',
  'tool_call',
  'tool_use',
  'tool_result',
  'tool_response',
  'arguments'
]

const ELEM = `(?:[a-z][a-z0-9_-]*:)?(${PROTOCOL_ELEMENTS.join('|')})`
/** Cierre `</x>` o apertura `<x ...>` de esos elementos. */
const ELEMENT_TAG = `<\\s*(/?)\\s*${ELEM}(?:\\s[^<>]*)?>`
/** Tokens de control de plantillas de chat y de fin de secuencia: `<|im_end|>`, `<|endoftext|>`, `</s>`, `<eos>`, `[/INST]`… */
const SPECIAL_TOKEN = `<\\|[a-z0-9_]+\\|>|<\\/?s>|<eos>|<end_of_turn>|\\[\\/?INST\\]`

const TAIL_TAG = new RegExp(`(?:${ELEMENT_TAG}|(${SPECIAL_TOKEN}))\\s*$`, 'i')

export interface SanitizedTypeText {
  text: string
  /** Etiquetas quitadas del final, en el orden en que estaban en el texto. */
  removed: string[]
}

export function sanitizeTypeText(input: string): SanitizedTypeText {
  let body = input
  const removed: string[] = []
  // Se pela una etiqueta por vuelta desde el final; tope por si un texto raro encadenara cientos.
  for (let guard = 0; guard < 32; guard++) {
    const m = TAIL_TAG.exec(body)
    if (!m) break
    const tag = m[0].trim()
    const isSpecial = m[3] !== undefined
    const isClose = !isSpecial && m[1] === '/'
    const name = (m[2] ?? '').toLowerCase()
    const before = body.slice(0, m.index)
    // Cierre con su apertura en el propio texto: es contenido escrito a propósito.
    if (isClose && new RegExp(`<\\s*(?:[a-z][a-z0-9_-]*:)?${name}[\\s>]`, 'i').test(before)) break
    removed.unshift(tag)
    body = before
  }
  if (!removed.length) return { text: input, removed: [] }
  // Todo el texto eran etiquetas: no se toca.
  if (!body.trim()) return { text: input, removed: [] }
  // Se quita también el espacio que quedó pegado al resto (era formato del protocolo, no del texto).
  return { text: body.replace(/\s+$/, ''), removed }
}

/** Frase para la respuesta de la herramienta cuando se quitó algo; cadena vacía si no. */
export function sanitizeNote(removed: readonly string[]): string {
  if (!removed.length) return ''
  const shown = removed.slice(0, 3).join(' ')
  const what = removed.length === 1 ? 'una etiqueta de protocolo' : `${removed.length} etiquetas de protocolo`
  return ` Aviso: se quitó del final del texto ${what} (${shown}${removed.length > 3 ? ' …' : ''}) que no formaba parte de lo que había que escribir.`
}
