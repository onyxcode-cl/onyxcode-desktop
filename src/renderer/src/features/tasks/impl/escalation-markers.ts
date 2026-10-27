/**
 * Los marcadores `[[LAZUNOX:NEEDS_FULL_CONTROL]]`, `[[LAZUNOX:OPEN_FOLDER]]` y `[[LAZUNOX:NEEDS_APP:<App>]]` son un contrato con el
 * agente (los lee `parseEscalation` sobre el texto crudo), no texto para leer: la conversación los oculta al pintar. Puro.
 */
const MARKER = /\[\[LAZUNOX:(?:NEEDS_FULL_CONTROL|OPEN_FOLDER|NEEDS_APP:[^\]\n[]{0,80})\]\]/gi
/** Marcador a medio escribir al final del texto (streaming): tampoco se muestra. */
const PARTIAL_TAIL = /\[\[LAZUNOX[^\]\n]{0,100}$/i
const ONLY_DECORATION = /^[\s*_`>#-]*$/

export function stripEscalationMarkers(text: string): string {
  if (!text.includes('[[')) return text
  const lines = text.replace(PARTIAL_TAIL, '').split('\n')
  const out: string[] = []
  for (const line of lines) {
    const cleaned = line.replace(MARKER, '')
    // Una línea que solo tenía el marcador (con su decoración markdown) desaparece entera.
    if (cleaned !== line && ONLY_DECORATION.test(cleaned)) continue
    out.push(cleaned)
  }
  return out.join('\n').trimEnd()
}
