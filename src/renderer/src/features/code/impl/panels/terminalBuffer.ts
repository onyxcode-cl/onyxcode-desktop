/** Lo mínimo del búfer de xterm que hace falta (así se prueba con el `Terminal` real y con uno simulado). */
export interface BufferLike {
  readonly length: number
  getLine(y: number): { readonly isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined
}

/**
 * Texto que MUESTRA el terminal desde la fila `startRow` hasta el final: las filas que el ancho partió se unen en una sola línea
 * (sin perder el espacio del corte) y se descartan las filas vacías del final. Es lo que ve la persona, sea cual sea el ancho del
 * panel, el prompt o los redibujados del shell.
 */
export function bufferTextFrom(buf: BufferLike, startRow: number): string {
  const lines: string[] = []
  for (let y = Math.max(0, startRow); y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    const next = buf.getLine(y + 1)
    const text = line.translateToString(!next?.isWrapped)
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text
    else lines.push(text)
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.map((l) => l.replace(/\s+$/, '')).join('\n')
}
