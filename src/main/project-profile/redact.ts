/**
 * Tapa los valores de la Bóveda en un texto (la salida de un comando que vuelve a la IA, un registro, un diagnóstico). Módulo PURO.
 * Cada valor se reemplaza por `«NOMBRE»`. Los valores de menos de 4 caracteres no se tapan (taparían texto común); la pantalla de la Bóveda lo avisa.
 * También tapa las variantes que un programa suele imprimir: entre comillas, con `\n` escapado y codificado como URL o base64.
 */
export const MIN_REDACT_CHARS = 4

function variants(value: string): string[] {
  const out = new Set<string>([value])
  try {
    out.add(encodeURIComponent(value))
  } catch {
    // valor con sustitutos sueltos: no hay variante URL
  }
  out.add(Buffer.from(value, 'utf8').toString('base64'))
  out.add(Buffer.from(value, 'utf8').toString('base64').replace(/=+$/, ''))
  out.add(value.replace(/\n/g, '\\n'))
  out.add(JSON.stringify(value).slice(1, -1))
  return [...out].filter((v) => v.length >= MIN_REDACT_CHARS)
}

export function redactSecrets(text: string, vars: Record<string, string>): string {
  if (!text) return text
  const pairs: Array<[string, string]> = []
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string' || value.length < MIN_REDACT_CHARS) continue
    for (const v of variants(value)) pairs.push([v, name])
  }
  // Primero los más largos: así un valor contenido en otro no deja un resto a la vista.
  pairs.sort((a, b) => b[0].length - a[0].length)
  let out = text
  for (const [needle, name] of pairs) out = out.split(needle).join(`«${name}»`)
  return out
}
