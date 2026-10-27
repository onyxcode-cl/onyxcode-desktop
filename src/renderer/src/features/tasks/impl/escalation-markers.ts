/**
 * Los marcadores `[[LAZUNOX:NEEDS_FULL_CONTROL]]`, `[[LAZUNOX:OPEN_FOLDER]]` y `[[LAZUNOX:NEEDS_APP:<App>]]` son un contrato con el
 * agente (los lee `parseEscalation` sobre el texto crudo), no texto para leer. Se oculta SOLO el de la ÚLTIMA línea no vacía, que es
 * el único que `parseEscalation` lee: uno citado en medio de un párrafo, en un bloque de código o en `código en línea` se ve tal cual.
 * Solo mientras el mensaje se escribe (`streaming`) se recorta además un marcador a medio escribir al final. Puro.
 */
/** Exactamente lo que `parseEscalation` lee de la última línea: el marcador solo, con decoración markdown delante. */
const BARE_MARKER =
  /^[\s*_`>#-]*\[\[LAZUNOX:(?:NEEDS_FULL_CONTROL|OPEN_FOLDER)\]\]\s*$|^[\s*_`>#-]*\[\[LAZUNOX:NEEDS_APP:[^\]\n[]{1,60}\]\][\s*_`]*$/i
/** Marcador (o su arranque `[[LAZ…`) a medio escribir al final de la última línea. */
const PARTIAL_TAIL = /\[\[(?:LAZUNOX[^\]\n]{0,100}|L(?:A(?:Z(?:U(?:N(?:O(?:X)?)?)?)?)?)?)?$/i
const ONLY_DECORATION = /^[\s*_`>#-]*$/

export function stripEscalationMarkers(text: string, streaming = false): string {
  if (!text.includes('[')) return text
  const lines = text.split('\n')
  let idx = lines.length - 1
  while (idx >= 0 && lines[idx].trim() === '') idx--
  if (idx < 0) return text
  const line = lines[idx]
  let cleaned = line
  if (BARE_MARKER.test(line.trim())) cleaned = ''
  else if (streaming) cleaned = line.replace(PARTIAL_TAIL, '')
  if (cleaned === line) return text
  const out = lines.slice(0, idx)
  // Una línea que solo tenía el marcador desaparece entera.
  if (!ONLY_DECORATION.test(cleaned)) out.push(cleaned)
  return out.join('\n').trimEnd()
}
