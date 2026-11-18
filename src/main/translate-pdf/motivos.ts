/**
 * Motivo real de un fallo al escribir la traducción, en español simple (para la tarjeta de la traducción). Los scripts de Python avisan
 * con líneas `DIFERENCIA:` (graves: se perdió o cambió contenido), `AVISO:` y `ERROR:`, y dejan `error: { nivel, motivos }` en
 * `informe.json`; aquí se convierten en frases que una persona entiende y se decide si el fallo es grave o solo un aviso.
 */
export interface ApplyFailure {
  level: 'grave' | 'aviso'
  /** Hasta 3 motivos, ya en español simple. */
  detail: string
}

const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^falta la parte (.+)$/, (m) => `Se perdió una parte del documento (${m[1]}).`],
  [/^sobra la parte (.+)$/, (m) => `Apareció una parte que no estaba en el original (${m[1]}).`],
  [/^cambió el tipo de contenido de la parte (.+)$/, (m) => `Cambió el tipo de una parte del documento (${m[1]}).`],
  [/^cambió la parte (.+?) \(no es de texto\)/, (m) => `Cambió algo que no es texto, como estilos, imágenes o configuración (${m[1]}).`],
  [/el elemento \d+ cambió/, () => 'Cambió la estructura de un párrafo, una tabla o una sección.'],
  [/cambió el número de elementos/, () => 'Cambió la cantidad de párrafos o tablas del documento.'],
  [/la celda (\S+) cambió/, (m) => `Cambió una celda del Excel (${m[1]}): su estilo, su tipo o su fórmula.`],
  [/cambió el número de celdas/, () => 'Cambió la cantidad de celdas de una hoja.'],
  [/cambió la estructura de la hoja/, () => 'Cambió la estructura de una hoja (columnas, combinaciones, filtros…).'],
  [/sharedStrings: cambió el número de textos/, () => 'Cambió la cantidad de textos del libro.'],
  [/cambió algo que no es texto del gráfico/, () => 'Cambió algo de un gráfico o cuadro que no es texto.'],
  [/cambió el número de páginas/, () => 'Cambió el número de páginas.'],
  [/cambió el número de (imágenes|dibujos|anotaciones)/, (m) => `Cambió la cantidad de ${m[1]} de una página.`],
  [/la parte «(.+)» del documento está dañada/, (m) => `El documento tiene una parte dañada (${m[1]}).`]
]

function simple(raw: string): string {
  const t = raw.replace(/^(?:DIFERENCIA|AVISO|ERROR):\s*/i, '').trim()
  for (const [re, f] of RULES) {
    const m = t.match(re)
    if (m) return f(m)
  }
  const one = t.replace(/\s+/g, ' ').slice(0, 220)
  return /[.!?]$/.test(one) ? one.charAt(0).toUpperCase() + one.slice(1) : `${one.charAt(0).toUpperCase()}${one.slice(1)}.`
}

/** Une hasta 3 motivos en una frase corta; el resto se cuenta. */
function join(motivos: string[]): string {
  const uniq = [...new Set(motivos.map(simple).filter(Boolean))]
  const shown = uniq.slice(0, 3).join(' ')
  return uniq.length > 3 ? `${shown} Y ${uniq.length - 3} motivos más.` : shown
}

/**
 * `informe` es el `informe.json` que dejó el script (puede faltar); `out` lo que imprimió (stdout + stderr) y `code` su código de salida.
 * Código 4 = el resultado se escribió pero no se pudo revisar: aviso, no grave.
 */
export function describeApplyFailure(informe: unknown, out: string, code: number): ApplyFailure {
  const err = (informe as { error?: { nivel?: unknown; motivos?: unknown } } | null)?.error
  if (err && Array.isArray(err.motivos) && err.motivos.length > 0) {
    return { level: err.nivel === 'aviso' ? 'aviso' : 'grave', detail: join(err.motivos.filter((x): x is string => typeof x === 'string')) }
  }
  const lines = out.split(/\r?\n/).map((l) => l.trim())
  const diffs = lines.filter((l) => l.startsWith('DIFERENCIA:'))
  if (diffs.length > 0) return { level: 'grave', detail: join(diffs) }
  const errors = lines.filter((l) => /^ERROR:/i.test(l))
  if (errors.length > 0) return { level: code === 4 ? 'aviso' : 'grave', detail: join(errors) }
  if (code === 4) return { level: 'aviso', detail: 'No se pudo revisar el resultado, pero el documento quedó escrito.' }
  return { level: 'grave', detail: 'El programa que escribe el documento se detuvo sin dar un motivo.' }
}

/** Avisos (no graves) que dejó el script en `informe.json` (`avisos`): metadatos, partes que no se usaban, etc. */
export function reportWarnings(informe: unknown): string[] {
  const a = (informe as { avisos?: unknown } | null)?.avisos
  return Array.isArray(a)
    ? a
        .filter((x): x is string => typeof x === 'string')
        .map(simple)
        .slice(0, 6)
    : []
}
